# 🐾 PawDF

Chat with your PDFs — fully local, fully offline. Inspired by NotebookLM, but everything runs on your own machine.

PawDF is a desktop app (Windows + macOS) that lets you upload a PDF and ask questions about it. Answers come from a local LLM ([Gemma 4 E2B](https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF), ~3 GB) served by [llama.cpp](https://github.com/ggml-org/llama.cpp). **No cloud, no API keys, no data leaves your computer.**

![PawDF](docs/img/session.png)

📖 **[User Guide](docs/USER_GUIDE.md)** · 🚢 **[Release process](docs/RELEASING.md)** · 📝 **[Changelog](CHANGELOG.md)**

## Install

1. Download the installer for your OS from [Releases](../../releases) (`.msi`/`.exe` for Windows, `.dmg` for macOS).
2. Run it and launch PawDF.
   - **macOS:** builds are unsigned, so Gatekeeper may say the app "is damaged" or "can't be opened". Fix: `xattr -cr /Applications/PawDF.app` (or right-click the app → Open).
   - **Windows:** SmartScreen may warn about an unrecognized app. Click "More info" → "Run anyway".
3. On first launch PawDF downloads the AI model (~3 GB, one time — needs internet just that once). The llama.cpp runtime ships inside the installer. After that download, PawDF is fully offline.

## Use

See the **[User Guide](docs/USER_GUIDE.md)** for the full tour. In short:

- **Upload PDF** → creates a session (the PDF is copied into app storage, so the original can move or be deleted). New sessions open with an auto-generated summary and two clickable starter questions.
- Ask questions in the chat; the model answers only from the document, streams its reply (reasoning shown live, then folded), and cites pages as clickable chips that jump the preview to the source.
- The session view is three resizable panels: library sidebar · PDF preview (zoom, page navigator, find-with-highlights) · chat.
- Sessions auto-save after every exchange and reappear when you reopen the app.
- **Clear chat** wipes the conversation but keeps the PDF and its parsed text.
- **Delete session** removes the session, its chat, and the stored PDF copy.

Documents and chats live in the app data dir (`%APPDATA%/com.pawdf.app` on Windows, `~/Library/Application Support/com.pawdf.app` on macOS): `sessions/<id>/` (`doc.pdf`, `doc.txt`, `chat.json`, `meta.json`). The downloaded model also lives there (`models/`, ~3 GB); the llama.cpp runtime ships bundled in the installed app resources.

**Uninstalling removes the app and the bundled llama.cpp runtime, but deliberately keeps the app data dir** — so the ~3 GB model and your library survive and a reinstall is instant. Delete that folder manually to reclaim the space; see [Uninstalling PawDF](docs/USER_GUIDE.md#9-uninstalling-pawdf).

## Private by design

- **Works with Wi-Fi off.** The AI runs entirely on your computer. Your documents, questions, and answers are never sent anywhere — there is nothing to send them to.
- **No accounts, no telemetry.** PawDF doesn't ask you to sign in and doesn't collect usage data.
- **Answers come from your document.** The AI is instructed to answer only from the PDF and to cite the page, so every claim is one click away from being checked. (It can still make mistakes — verify anything important.)
- **No web access, even when you're online.** The AI engine has no browsing or search capability, and the app's window is locked down (content security policy + sanitized output) so nothing in a document or an answer can trigger a web request.
- **Self-contained AI.** PawDF installs and uses its *own* copy of llama.cpp and the Gemma 4 E2B model, even if you already have them (e.g. via Ollama or LM Studio). It never touches your existing setup, and uninstalling PawDF leaves other tools untouched — the trade-off is ~3–4 GB of disk for PawDF's own copy.

## How it works

- Tauri 2 app; the Rust backend spawns `llama-server` on a random localhost port at startup and kills it on exit. The UI is blocked by a loading screen until the model reports healthy.
- pdf.js renders the PDF (left pane) and extracts its text once per document.
- If the document fits the context budget it is sent whole (stable prompt prefix → llama.cpp prompt cache keeps follow-ups fast); otherwise the most relevant chunks for each question are selected by term overlap.
- The system prompt instructs the model to answer only from the document and to say so when the answer isn't there.

## Develop

Prereqs: Node 20+, Rust stable, and on Windows the [Tauri prerequisites](https://tauri.app/start/prerequisites/) (WebView2, MSVC build tools).

```sh
npm install
npm run tauri dev    # run the app
npm run tauri build  # produce installers in src-tauri/target/release/bundle/
```

To change the model or llama.cpp version, edit the constants at the top of `src-tauri/src/lib.rs`.

## Planned features (so far)

- Pick from multiple local models / bring your own GGUF
- BYOK support for cloud APIs (optional, off by default)
- Embedding-based retrieval for very large documents
