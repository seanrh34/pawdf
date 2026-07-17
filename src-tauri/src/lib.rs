use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU16, Ordering},
        Mutex, OnceLock,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use futures_util::StreamExt;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

// ---- pinned downloads (bump these to upgrade) ----
const LLAMA_BASE: &str = "https://github.com/ggml-org/llama.cpp/releases/download/b9950/";
#[cfg(target_os = "windows")]
const LLAMA_ASSET: &str = "llama-b9950-bin-win-cpu-x64.zip";
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const LLAMA_ASSET: &str = "llama-b9950-bin-macos-arm64.tar.gz";
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
const LLAMA_ASSET: &str = "llama-b9950-bin-macos-x64.tar.gz";
const MODEL_URL: &str =
    "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf";
const MODEL_FILE: &str = "gemma-4-E2B-it-Q4_K_M.gguf";
const OLD_MODEL_FILES: &[&str] = &["gemma-3n-E2B-it-Q4_K_M.gguf"]; // reclaimed on upgrade
const SERVER_BIN: &str = if cfg!(windows) {
    "llama-server.exe"
} else {
    "llama-server"
};

#[derive(Default)]
struct Llm {
    // serializes start_llm: concurrent invocations (page reloads re-run boot())
    // otherwise spawn duplicate servers and overwrite each other's `child`,
    // leaving a poller stuck on a port nothing listens on
    starting: tokio::sync::Mutex<()>,
    child: Mutex<Option<Child>>,
    port: AtomicU16,
}

// ---- paths ----

fn data_dir(app: &AppHandle) -> PathBuf {
    let d = app.path().app_data_dir().expect("no app data dir");
    fs::create_dir_all(&d).ok();
    d
}

fn model_path(app: &AppHandle) -> PathBuf {
    let bundled = app
        .path()
        .resource_dir()
        .ok()
        .map(|d| d.join("resources").join(MODEL_FILE));
    bundled
        .filter(|p| p.exists())
        .unwrap_or_else(|| data_dir(app).join("models").join(MODEL_FILE))
}

fn find_server(app: &AppHandle) -> Option<PathBuf> {
    let mut stack = vec![data_dir(app).join("bin")];
    if let Ok(resources) = app.path().resource_dir() {
        stack.push(resources.join("resources").join("llama"));
    }
    while let Some(d) = stack.pop() {
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if p.file_name().is_some_and(|n| n == SERVER_BIN) {
                return Some(p);
            }
        }
    }
    None
}

fn session_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("bad session id".into());
    }
    Ok(data_dir(app).join("sessions").join(id))
}

// ---- setup / downloads ----

// lets the frontend leave a trace of how far boot() got (in health.log)
#[tauri::command]
fn boot_log(app: AppHandle, msg: String) {
    note_health(&app, &format!("js: {msg}"));
}

#[tauri::command]
fn setup_status(app: AppHandle) -> Value {
    json!({ "model": model_path(&app).exists(), "server": find_server(&app).is_some() })
}

async fn download(app: &AppHandle, url: &str, dest: &Path, label: &str) -> Result<(), String> {
    fs::create_dir_all(dest.parent().unwrap()).map_err(|e| e.to_string())?;
    let resp = reqwest::get(url)
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("download of {label} failed: {e}"))?;
    let total = resp.content_length().unwrap_or(0);
    let tmp = dest.with_extension("part");
    let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut got: u64 = 0;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download of {label} interrupted: {e}"))?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        got += chunk.len() as u64;
        app.emit(
            "setup-progress",
            json!({ "label": label, "got": got, "total": total }),
        )
        .ok();
    }
    drop(file);
    fs::rename(&tmp, dest).map_err(|e| e.to_string())
}

#[tauri::command]
async fn download_assets(app: AppHandle) -> Result<(), String> {
    if find_server(&app).is_none() {
        let bin_dir = data_dir(&app).join("bin");
        let archive = bin_dir.join(LLAMA_ASSET);
        download(
            &app,
            &format!("{LLAMA_BASE}{LLAMA_ASSET}"),
            &archive,
            "llama.cpp",
        )
        .await?;
        // bsdtar ships with both Windows 10+ and macOS and handles .zip and .tar.gz;
        // full path on Windows so a GNU tar earlier in PATH (e.g. Git Bash) can't shadow it
        let tar = if cfg!(windows) {
            r"C:\Windows\System32\tar.exe"
        } else {
            "tar"
        };
        let out = Command::new(tar)
            .args([
                "-xf",
                &archive.to_string_lossy(),
                "-C",
                &bin_dir.to_string_lossy(),
            ])
            .output()
            .map_err(|e| format!("tar failed to run: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "extract failed: {}",
                String::from_utf8_lossy(&out.stderr)
            ));
        }
        fs::remove_file(&archive).ok();
        find_server(&app).ok_or("llama-server missing from archive")?;
    }
    if !model_path(&app).exists() {
        download(&app, MODEL_URL, &model_path(&app), "Gemma model").await?;
    }
    // free the ~3 GB a superseded model would otherwise keep occupying
    for old in OLD_MODEL_FILES {
        fs::remove_file(data_dir(&app).join("models").join(old)).ok();
    }
    Ok(())
}

// ---- llm lifecycle ----

// Orphaned llama-servers pile up when the app is killed without RunEvent::Exit
// (Ctrl+C on `tauri dev`), each holding ~3 GB of RAM. Kill any whose executable
// is *our* installed binary before spawning a fresh one.
// ponytail: also kills the server of a second concurrently-running PawDF instance;
// per-instance PID files if that ever matters.
fn kill_stale_servers(server: &Path) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let path = server.to_string_lossy().replace('\'', "");
        Command::new("powershell")
            .args(["-NoProfile", "-Command", &format!(
                "Get-CimInstance Win32_Process -Filter \"Name='llama-server.exe'\" | Where-Object {{ $_.ExecutablePath -eq '{path}' }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force }}"
            )])
            .creation_flags(0x0800_0000)
            .output()
            .ok();
    }
    #[cfg(not(windows))]
    {
        Command::new("pkill")
            .args(["-f", &server.to_string_lossy()])
            .output()
            .ok();
    }
}

#[tauri::command]
async fn start_llm(app: AppHandle, state: State<'_, Llm>) -> Result<u16, String> {
    let _starting = state.starting.lock().await;
    let port = state.port.load(Ordering::SeqCst);
    if port != 0 && health(&app, port).await {
        app.emit("llm-ready", port).ok();
        return Ok(port);
    }
    let server = find_server(&app).ok_or("llama-server not installed")?;
    let model = model_path(&app);
    if !model.exists() {
        return Err("model not installed".into());
    }
    kill_stale_servers(&server);
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .map_err(|e| e.to_string())?;

    let log_path = data_dir(&app).join("llama-server.log");
    let log = fs::File::create(&log_path).map_err(|e| e.to_string())?;
    fs::write(data_dir(&app).join("health.log"), "").ok(); // fresh diagnostics per start
    let mut cmd = Command::new(&server);
    cmd.args([
        "-m",
        &model.to_string_lossy(),
        "--host",
        "127.0.0.1",
        "--port",
        &port.to_string(),
        "-c",
        "8192",
        "-ngl",
        "99",
        "--jinja",
    ])
    .stdout(log.try_clone().map_err(|e| e.to_string())?)
    .stderr(log)
    .stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let child = cmd
        .spawn()
        .map_err(|e| format!("failed to start llama-server: {e}"))?;
    *state.child.lock().unwrap() = Some(child);

    // wait for the model to load (health turns 200), streaming the server's
    // log to the boot overlay so startup isn't a black box
    let mut sent = 0;
    for _ in 0..600 {
        if let Ok(s) = fs::read_to_string(&log_path) {
            if s.len() > sent {
                app.emit("llm-log", &s[sent..]).ok();
                sent = s.len();
            }
        }
        if health(&app, port).await {
            note_health(&app, &format!("ready on port {port}"));
            state.port.store(port, Ordering::SeqCst);
            // the invoke response can get lost in WebView2 IPC; the event
            // channel is the reliable path, the return value is a fallback
            app.emit("llm-ready", port).ok();
            return Ok(port);
        }
        if let Some(status) = state
            .child
            .lock()
            .unwrap()
            .as_mut()
            .and_then(|c| c.try_wait().ok().flatten())
        {
            return Err(format!(
                "llama-server exited early ({status}); see llama-server.log in app data"
            ));
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    Err("llama-server did not become ready in time".into())
}

// Client for talking to the local llama-server. `no_proxy()` is load-bearing:
// reqwest's default system-proxy lookup must never intercept 127.0.0.1, and its
// macOS implementation can panic on odd network configs (e.g. phone hotspots),
// which silently kills the command task and leaves the UI stuck on the loading
// screen.
fn local_client() -> Result<&'static reqwest::Client, String> {
    static C: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .no_proxy()
            .build()
            .map_err(|e| format!("{e:?}"))
    })
    .as_ref()
    .map_err(|e| e.clone())
}

// health failures are silent by design (we just poll again), so record why they
// fail — a wedged startup with a healthy server is undebuggable otherwise
fn note_health(app: &AppHandle, msg: &str) {
    app.emit("llm-log", format!("[health] {msg}\n")).ok();
    if let Ok(mut f) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(data_dir(app).join("health.log"))
    {
        writeln!(f, "{msg}").ok();
    }
}

async fn health(app: &AppHandle, port: u16) -> bool {
    let client = match local_client() {
        Ok(c) => c,
        Err(e) => {
            note_health(app, &format!("client build failed: {e}"));
            return false;
        }
    };
    let req = client
        .get(format!("http://127.0.0.1:{port}/health"))
        .timeout(Duration::from_secs(2))
        .send();
    match req.await {
        Ok(r) if r.status().is_success() => true,
        Ok(r) => {
            note_health(app, &format!("HTTP {}", r.status()));
            false
        }
        Err(e) => {
            note_health(app, &format!("{e:?}"));
            false
        }
    }
}

#[tauri::command]
async fn ask(
    app: AppHandle,
    state: State<'_, Llm>,
    messages: Vec<Value>,
) -> Result<String, String> {
    let port = state.port.load(Ordering::SeqCst);
    if port == 0 {
        return Err("model is not running".into());
    }
    let resp = local_client()?
        .post(format!("http://127.0.0.1:{port}/v1/chat/completions"))
        .json(&json!({
            "messages": messages,
            "stream": true,
            "temperature": 0.2,
            "cache_prompt": true,
        }))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?;

    let mut full = String::new();
    let mut buf = String::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        buf.push_str(&String::from_utf8_lossy(&chunk.map_err(|e| e.to_string())?));
        while let Some(nl) = buf.find('\n') {
            let line = buf[..nl].trim().to_string();
            buf.drain(..=nl);
            let Some(data) = line.strip_prefix("data: ") else {
                continue;
            };
            if data == "[DONE]" {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<Value>(data) {
                // Gemma 4 is a reasoning model: --jinja llama-server splits its
                // thinking into reasoning_content. Streamed for display only —
                // never fed back into chat history.
                if let Some(tok) = v["choices"][0]["delta"]["reasoning_content"].as_str() {
                    app.emit("rtoken", tok).ok();
                }
                if let Some(tok) = v["choices"][0]["delta"]["content"].as_str() {
                    full.push_str(tok);
                    app.emit("token", tok).ok();
                }
            }
        }
    }
    Ok(full)
}

// ---- sessions ----

#[tauri::command]
fn list_sessions(app: AppHandle) -> Vec<Value> {
    let mut out = vec![];
    if let Ok(rd) = fs::read_dir(data_dir(&app).join("sessions")) {
        for e in rd.flatten() {
            if let Ok(s) = fs::read_to_string(e.path().join("meta.json")) {
                if let Ok(v) = serde_json::from_str::<Value>(&s) {
                    out.push(v);
                }
            }
        }
    }
    out.sort_by_key(|v| std::cmp::Reverse(v["created"].as_u64().unwrap_or(0)));
    out
}

#[tauri::command]
fn create_session(app: AppHandle, src_path: String) -> Result<Value, String> {
    let src = PathBuf::from(&src_path);
    let name = src
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or("Document".into());
    let id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis()
        .to_string();
    let dir = session_dir(&app, &id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::copy(&src, dir.join("doc.pdf")).map_err(|e| format!("could not copy PDF: {e}"))?;
    let meta = json!({ "id": id, "name": name, "created": SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64 });
    fs::write(dir.join("meta.json"), meta.to_string()).map_err(|e| e.to_string())?;
    fs::write(dir.join("chat.json"), "[]").map_err(|e| e.to_string())?;
    Ok(meta)
}

#[tauri::command]
fn get_session(app: AppHandle, id: String) -> Result<Value, String> {
    let dir = session_dir(&app, &id)?;
    let meta: Value = serde_json::from_str(
        &fs::read_to_string(dir.join("meta.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let chat: Value =
        serde_json::from_str(&fs::read_to_string(dir.join("chat.json")).unwrap_or("[]".into()))
            .unwrap_or_else(|_| json!([]));
    let text = fs::read_to_string(dir.join("doc.txt")).unwrap_or_default();
    Ok(json!({ "meta": meta, "chat": chat, "text": text }))
}

#[tauri::command]
fn read_pdf(app: AppHandle, id: String) -> Result<tauri::ipc::Response, String> {
    let bytes = fs::read(session_dir(&app, &id)?.join("doc.pdf")).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn save_extract(app: AppHandle, id: String, text: String) -> Result<(), String> {
    fs::write(session_dir(&app, &id)?.join("doc.txt"), text).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_chat(app: AppHandle, id: String, chat: Value) -> Result<(), String> {
    fs::write(session_dir(&app, &id)?.join("chat.json"), chat.to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_chat(app: AppHandle, id: String) -> Result<(), String> {
    fs::write(session_dir(&app, &id)?.join("chat.json"), "[]").map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_session(app: AppHandle, id: String) -> Result<(), String> {
    fs::remove_dir_all(session_dir(&app, &id)?).map_err(|e| e.to_string())
}

// ---- app ----

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Llm::default())
        .invoke_handler(tauri::generate_handler![
            boot_log,
            setup_status,
            download_assets,
            start_llm,
            ask,
            list_sessions,
            create_session,
            get_session,
            read_pdf,
            save_extract,
            save_chat,
            clear_chat,
            delete_session
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // graceful-enough shutdown: llama-server holds no state worth flushing
                if let Some(mut c) = app.state::<Llm>().child.lock().unwrap().take() {
                    c.kill().ok();
                }
            }
        });
}
