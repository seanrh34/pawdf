import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, ask } from "@tauri-apps/plugin-dialog";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./style.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const $ = (id) => document.getElementById(id);

const state = {
  sid: null, // current session id
  meta: null,
  doc: null, // pdfjs document
  text: "", // extracted full text
  chat: [], // [{role, content}]
  busy: false,
};
let streamEl = null; // assistant bubble currently receiving tokens

// ---------- boot ----------

async function boot() {
  $("overlay").hidden = false;
  $("overlay-retry").hidden = true;
  const msg = $("overlay-msg");
  const bar = $("overlay-bar");
  try {
    msg.textContent = "Checking setup…";
    const st = await invoke("setup_status");
    if (!st.model || !st.server) {
      msg.textContent =
        "First-time setup: downloading the local AI model.\nThis needs internet once (~3 GB). After this, PawDF is fully offline.";
      bar.hidden = false;
      await invoke("download_assets");
      bar.hidden = true;
    }
    msg.textContent = "Starting the local AI… (first load can take a minute)";
    await invoke("start_llm");
    $("overlay").hidden = true;
    await showLibrary();
  } catch (e) {
    msg.textContent = "Setup failed: " + e + "\nCheck your internet connection and retry.";
    bar.hidden = true;
    $("overlay-retry").hidden = false;
  }
}

listen("setup-progress", (e) => {
  const { label, got, total } = e.payload;
  const bar = $("overlay-bar");
  bar.hidden = false;
  if (total > 0) {
    bar.max = total;
    bar.value = got;
    $("overlay-msg").textContent =
      `Downloading ${label}… ${(got / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MB\n` +
      "This needs internet once. After this, PawDF is fully offline.";
  }
});

$("overlay-retry").addEventListener("click", boot);

// ---------- library ----------

async function showLibrary() {
  state.sid = null;
  $("session").hidden = true;
  $("library").hidden = false;
  const sessions = await invoke("list_sessions");
  const list = $("session-list");
  list.innerHTML = "";
  $("library-empty").hidden = sessions.length > 0;
  for (const s of sessions) {
    const card = document.createElement("div");
    card.className = "session-card";
    card.innerHTML = `<span>📄</span><div class="info"><div class="name"></div><div class="date"></div></div>`;
    card.querySelector(".name").textContent = s.name;
    card.querySelector(".date").textContent = new Date(s.created).toLocaleString();
    const del = document.createElement("button");
    del.className = "danger";
    del.textContent = "Delete";
    del.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      if (await ask(`Delete "${s.name}" and its chat? This cannot be undone.`, { title: "PawDF", kind: "warning" })) {
        await invoke("delete_session", { id: s.id });
        await showLibrary();
      }
    });
    card.appendChild(del);
    card.addEventListener("click", () => openSession(s.id));
    list.appendChild(card);
  }
}

$("btn-upload").addEventListener("click", async () => {
  const path = await open({ filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (!path) return;
  const meta = await invoke("create_session", { srcPath: path });
  await openSession(meta.id, true);
});

// ---------- session ----------

async function openSession(id, isNew = false) {
  const s = await invoke("get_session", { id });
  state.sid = id;
  state.meta = s.meta;
  state.chat = s.chat;
  state.text = s.text;
  $("library").hidden = true;
  $("session").hidden = false;
  $("session-title").textContent = s.meta.name;

  renderChat();

  const bytes = await invoke("read_pdf", { id });
  state.doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  await renderPdf(state.doc);

  // Parse once on first open; kept across "clear chat".
  if (isNew || !state.text) {
    addNotice("Reading document…");
    state.text = await extractText(state.doc);
    await invoke("save_extract", { id, text: state.text });
    removeNotices();
  }
  $("chat-input").focus();
}

async function extractText(doc) {
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    pages.push(`[Page ${i}]\n` + tc.items.map((it) => it.str).join(" "));
  }
  return pages.join("\n\n");
}

// Lazy page rendering: placeholders sized like page 1, rendered when scrolled into view.
async function renderPdf(doc) {
  const container = $("pdf-pages");
  container.innerHTML = "";
  const paneWidth = $("pdf-pane").clientWidth - 32;
  const first = await doc.getPage(1);
  const baseVp = first.getViewport({ scale: 1 });
  const scale = Math.min(paneWidth / baseVp.width, 1.5);
  const dpr = window.devicePixelRatio || 1;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const num = Number(entry.target.dataset.page);
        doc.getPage(num).then((page) => {
          const vp = page.getViewport({ scale });
          const canvas = entry.target;
          canvas.width = vp.width * dpr;
          canvas.height = vp.height * dpr;
          canvas.style.width = vp.width + "px";
          canvas.style.height = vp.height + "px";
          page.render({ canvasContext: canvas.getContext("2d"), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
        });
      }
    },
    { root: $("pdf-pane"), rootMargin: "600px" }
  );

  for (let i = 1; i <= doc.numPages; i++) {
    const canvas = document.createElement("canvas");
    canvas.className = "page";
    canvas.dataset.page = i;
    canvas.style.width = baseVp.width * scale + "px";
    canvas.style.height = baseVp.height * scale + "px";
    container.appendChild(canvas);
    observer.observe(canvas);
  }
}

// ---------- chat ----------

function addMsg(role, content) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  div.textContent = content;
  $("chat-log").appendChild(div);
  $("chat-log").scrollTop = $("chat-log").scrollHeight;
  return div;
}

function addNotice(text) {
  const div = addMsg("assistant", text);
  div.classList.add("notice");
  return div;
}
function removeNotices() {
  $("chat-log").querySelectorAll(".notice").forEach((n) => n.remove());
}

function renderChat() {
  $("chat-log").innerHTML = "";
  for (const m of state.chat) addMsg(m.role, m.content);
}

listen("token", (e) => {
  if (!streamEl) return;
  streamEl.textContent += e.payload;
  $("chat-log").scrollTop = $("chat-log").scrollHeight;
});

const SYS = (name, ctx) =>
  `You are PawDF, an assistant that answers questions about a PDF document. ` +
  `Answer ONLY using the document content below. If the answer is not in the document, ` +
  `say plainly that the document does not contain it — never guess or use outside knowledge. ` +
  `Be concise, objective, and quote or cite page numbers from the document where useful.\n\n` +
  `--- DOCUMENT: ${name} ---\n${ctx}\n--- END DOCUMENT ---`;

// ponytail: naive term-overlap retrieval over fixed chunks; swap in an embedding
// model if answers start missing relevant sections in long documents.
const CTX_BUDGET = 24000; // chars ≈ 6k tokens, fits the 8k context with room for chat
function pickContext(text, question) {
  if (text.length <= CTX_BUDGET) return text; // whole doc fits → stable prefix, prompt cache friendly
  const terms = [...new Set((question.toLowerCase().match(/[a-z0-9]{3,}/g) || []))];
  const chunks = [];
  for (let i = 0; i < text.length; i += 1500) chunks.push({ pos: i, str: text.slice(i, i + 1800) });
  for (const c of chunks) {
    const low = c.str.toLowerCase();
    c.score = terms.reduce((n, t) => n + (low.includes(t) ? 1 : 0), 0);
  }
  chunks.sort((a, b) => b.score - a.score);
  const picked = [];
  let used = 0;
  for (const c of chunks) {
    if (used + c.str.length > CTX_BUDGET) break;
    picked.push(c);
    used += c.str.length;
  }
  picked.sort((a, b) => a.pos - b.pos); // restore document order
  return picked.map((c) => c.str).join("\n[…]\n");
}

$("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("chat-input");
  const q = input.value.trim();
  if (!q || state.busy || !state.sid) return;
  state.busy = true;
  $("btn-send").disabled = true;
  input.value = "";
  addMsg("user", q);
  streamEl = addMsg("assistant", "");
  streamEl.classList.add("pending");
  try {
    const messages = [
      { role: "system", content: SYS(state.meta.name, pickContext(state.text, q)) },
      ...state.chat.slice(-10),
      { role: "user", content: q },
    ];
    const full = await invoke("ask", { messages });
    streamEl.textContent = full;
    state.chat.push({ role: "user", content: q }, { role: "assistant", content: full });
    await invoke("save_chat", { id: state.sid, chat: state.chat });
  } catch (err) {
    streamEl.textContent = "Error: " + err;
  }
  streamEl.classList.remove("pending");
  streamEl = null;
  state.busy = false;
  $("btn-send").disabled = false;
  input.focus();
});

$("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("chat-form").requestSubmit();
  }
});

$("btn-back").addEventListener("click", showLibrary);

$("btn-clear").addEventListener("click", async () => {
  if (state.busy) return;
  if (await ask("Clear this chat? The PDF and its parsed text are kept.", { title: "PawDF" })) {
    await invoke("clear_chat", { id: state.sid });
    state.chat = [];
    renderChat();
  }
});

$("btn-delete").addEventListener("click", async () => {
  if (state.busy) return;
  if (await ask(`Delete "${state.meta.name}" and its chat? This cannot be undone.`, { title: "PawDF", kind: "warning" })) {
    await invoke("delete_session", { id: state.sid });
    await showLibrary();
  }
});

boot();
