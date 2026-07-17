import { invoke } from "@tauri-apps/api/core";
import { listen, once } from "@tauri-apps/api/event";
import { open, ask } from "@tauri-apps/plugin-dialog";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { marked } from "marked";
import DOMPurify from "dompurify";
import "./style.css";

marked.setOptions({ breaks: true });
// sanitized: model output can echo untrusted PDF content
const md = (text) => DOMPurify.sanitize(marked.parse(text));

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const $ = (id) => document.getElementById(id);

const state = {
  sid: null, // current session id
  meta: null,
  doc: null, // pdfjs document
  text: "", // extracted full text
  chat: [], // [{role, content}]
  busy: false,
  zoom: 1, // user zoom on top of fit-to-width
  scale: 1, // effective pdf.js render scale (fit × zoom)
  hls: {}, // highlights: page → [{x,y,w,h,cls}] in scale-1 viewport coords
};
let streamEl = null; // assistant bubble currently receiving tokens
let streamText = ""; // raw markdown accumulated so far

// ---------- boot ----------

async function boot() {
  $("overlay").hidden = false;
  $("overlay-retry").hidden = true;
  $("overlay-log").hidden = true;
  $("overlay-log").textContent = "";
  const msg = $("overlay-msg");
  const bar = $("overlay-bar");
  const trace = (m) => invoke("boot_log", { msg: m }).catch(() => {});
  try {
    trace("boot started");
    msg.textContent = "Checking setup…";
    const st = await invoke("setup_status");
    trace("setup_status resolved");
    if (!st.model || !st.server) {
      msg.textContent =
        "First-time setup: downloading the local AI model.\nThis needs internet once (~3 GB). After this, PawDF is fully offline.";
      bar.hidden = false;
      await invoke("download_assets");
      bar.hidden = true;
    }
    msg.textContent = "Starting the local AI… (first load can take a minute)";
    // The invoke response can get dropped by WebView2 IPC, so readiness is
    // also signalled via the "llm-ready" event — proceed on whichever lands
    // first, and give up entirely only after the backend's own 5-min limit.
    let onReady;
    const ready = new Promise((resolve) => (onReady = resolve));
    const unlisten = await once("llm-ready", onReady);
    try {
      await Promise.race([
        invoke("start_llm"),
        ready,
        new Promise((_, reject) =>
          setTimeout(() => reject("the local AI did not start (see llama-server.log in the app data folder)"), 360_000)
        ),
      ]);
    } finally {
      unlisten();
    }
    trace("start_llm resolved");
    await showLibrary();
    $("overlay").hidden = true;
    trace("library shown");
  } catch (e) {
    trace("boot failed: " + e);
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

listen("llm-log", (e) => {
  const el = $("overlay-log");
  el.hidden = false;
  el.textContent = (el.textContent + e.payload).split("\n").slice(-8).join("\n");
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

async function uploadPdf() {
  const path = await open({ filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (!path) return;
  const meta = await invoke("create_session", { srcPath: path });
  await openSession(meta.id, true);
}
$("btn-upload").addEventListener("click", uploadPdf);
$("btn-new-session").addEventListener("click", uploadPdf);

// session list in the left sidebar (mirrors the home library)
async function renderLibList() {
  const sessions = await invoke("list_sessions");
  const list = $("lib-list");
  list.innerHTML = "";
  for (const s of sessions) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "lib-item" + (s.id === state.sid ? " active" : "");
    item.textContent = "📄 " + s.name;
    item.title = s.name;
    item.addEventListener("click", () => {
      if (s.id !== state.sid && !state.busy) openSession(s.id);
    });
    list.appendChild(item);
  }
}

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
  state.zoom = 1;
  state.hls = {};
  $("zoom-level").textContent = "100%";
  closeFind();
  renderLibList();

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
// Each page is a wrapper holding the canvas plus a highlight overlay layer.
async function renderPdf(doc) {
  const container = $("pdf-pages");
  container.innerHTML = "";
  const paneWidth = $("pdf-pane").clientWidth - 48;
  const first = await doc.getPage(1);
  const baseVp = first.getViewport({ scale: 1 });
  const scale = Math.min(paneWidth / baseVp.width, 1.5) * state.zoom;
  state.scale = scale;
  const dpr = window.devicePixelRatio || 1;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const num = Number(entry.target.dataset.page);
        doc.getPage(num).then((page) => {
          const vp = page.getViewport({ scale });
          const canvas = entry.target.querySelector("canvas");
          canvas.width = vp.width * dpr;
          canvas.height = vp.height * dpr;
          page.render({ canvasContext: canvas.getContext("2d"), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
        });
      }
    },
    { root: $("pdf-pane"), rootMargin: "600px" }
  );

  for (let i = 1; i <= doc.numPages; i++) {
    const wrap = document.createElement("div");
    wrap.className = "page-wrap";
    wrap.dataset.page = i;
    wrap.style.width = baseVp.width * scale + "px";
    wrap.style.height = baseVp.height * scale + "px";
    const canvas = document.createElement("canvas");
    const layer = document.createElement("div");
    layer.className = "hl-layer";
    wrap.append(canvas, layer);
    container.appendChild(wrap);
    observer.observe(wrap);
    applyHighlights(i);
  }

  // ponytail: assumes uniform page heights (true for nearly all PDFs); walk
  // wrapper offsets instead if mixed-size documents ever matter
  const pageH = baseVp.height * scale + 16;
  const pane = $("pdf-pane");
  $("page-total").textContent = `of ${doc.numPages}`;
  const updatePageInfo = () => {
    const n = Math.min(doc.numPages, Math.max(1, Math.round(pane.scrollTop / pageH) + 1));
    if (document.activeElement !== $("page-input")) $("page-input").value = n;
  };
  pane.onscroll = updatePageInfo;
  updatePageInfo();
}

// ---------- highlights ----------
// Highlights live in state.hls as scale-independent rects tagged with a css
// class ("search" today; e.g. "user" later for manual highlighting). Layers
// re-render from the store, so they survive zoom re-renders.

function applyHighlights(page) {
  const layer = document.querySelector(`.page-wrap[data-page="${page}"] .hl-layer`);
  if (!layer) return;
  layer.innerHTML = "";
  for (const h of state.hls[page] || []) {
    const d = document.createElement("div");
    d.className = "hl " + h.cls;
    d.style.left = h.x * state.scale + "px";
    d.style.top = h.y * state.scale + "px";
    d.style.width = h.w * state.scale + "px";
    d.style.height = h.h * state.scale + "px";
    layer.appendChild(d);
  }
}

function refreshHighlightLayers() {
  document.querySelectorAll(".page-wrap").forEach((w) => applyHighlights(Number(w.dataset.page)));
}

// rects (scale-1 viewport coords) of every occurrence of term on a page
// ponytail: matches within single pdf.js text items, substring position is
// proportional to character count; a text layer would be exact if this ever
// feels off on exotic fonts
async function searchRects(pageNum, term) {
  const page = await state.doc.getPage(pageNum);
  const vp1 = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const rects = [];
  for (const it of tc.items) {
    if (!it.str) continue;
    const low = it.str.toLowerCase();
    let i = low.indexOf(term);
    if (i === -1) continue;
    const tx = pdfjsLib.Util.transform(vp1.transform, it.transform);
    const fontH = Math.hypot(tx[2], tx[3]);
    while (i !== -1) {
      rects.push({
        x: tx[4] + (i / it.str.length) * it.width,
        y: tx[5] - fontH,
        w: (term.length / it.str.length) * it.width,
        h: fontH * 1.2,
        cls: "search",
      });
      i = low.indexOf(term, i + term.length);
    }
  }
  return rects;
}

// ---------- zoom ----------

async function setZoom(z) {
  if (!state.doc) return;
  state.zoom = Math.min(3, Math.max(0.4, z));
  $("zoom-level").textContent = Math.round(state.zoom * 100) + "%";
  const pane = $("pdf-pane");
  const frac = pane.scrollHeight ? pane.scrollTop / pane.scrollHeight : 0;
  await renderPdf(state.doc); // re-applies stored highlights at the new scale
  pane.scrollTop = frac * pane.scrollHeight;
}

$("zoom-in").addEventListener("click", () => setZoom(state.zoom * 1.25));
$("zoom-out").addEventListener("click", () => setZoom(state.zoom / 1.25));

// ---------- page navigator ----------

function gotoPage(n) {
  $("pdf-pages").children[n - 1]?.scrollIntoView({ block: "start" });
}

$("page-input").addEventListener("change", () => {
  if (!state.doc) return;
  const n = Math.min(state.doc.numPages, Math.max(1, Number($("page-input").value) || 1));
  $("page-input").value = n;
  gotoPage(n);
});
$("page-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    $("page-input").blur(); // fires change
  }
});

// ---------- chat ----------

function addMsg(role, content) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  if (role === "assistant") div.innerHTML = md(content);
  else div.textContent = content;
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
  if (!state.chat.length) {
    const hint = document.createElement("div");
    hint.className = "chat-hint notice";
    hint.textContent =
      "Ask anything about this document. Answers come from its contents only — nothing leaves your computer.";
    $("chat-log").appendChild(hint);
  }
  for (const m of state.chat) addMsg(m.role, m.content);
}

listen("token", (e) => {
  if (!streamEl) return;
  streamText += e.payload;
  const think = streamEl.querySelector(".thinking");
  if (think) think.open = false; // fold the reasoning once the answer starts
  streamEl.querySelector(".answer").innerHTML = md(streamText);
  $("chat-log").scrollTop = $("chat-log").scrollHeight;
});

// reasoning stream: shown live in a collapsible block, not saved to history
listen("rtoken", (e) => {
  if (!streamEl) return;
  let think = streamEl.querySelector(".thinking");
  if (!think) {
    think = document.createElement("details");
    think.className = "thinking";
    think.open = true;
    think.innerHTML = "<summary>Thinking…</summary><div class=\"think-text\"></div>";
    streamEl.prepend(think);
  }
  think.querySelector(".think-text").textContent += e.payload;
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
  input.style.height = "auto";
  removeNotices(); // clears the empty-chat hint
  addMsg("user", q);
  streamText = "";
  streamEl = addMsg("assistant", "");
  streamEl.innerHTML = '<div class="answer"></div>'; // reasoning (if any) is prepended beside it
  streamEl.classList.add("pending"); // shows pulsing "Generating response…" until the first token
  try {
    const messages = [
      { role: "system", content: SYS(state.meta.name, pickContext(state.text, q)) },
      ...state.chat.slice(-10),
      { role: "user", content: q },
    ];
    const full = await invoke("ask", { messages });
    streamEl.querySelector(".answer").innerHTML = md(full);
    const think = streamEl.querySelector(".thinking");
    if (think) {
      think.open = false;
      think.querySelector("summary").textContent = "Thought process";
    }
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

// grow the input with its content (capped by CSS max-height)
$("chat-input").addEventListener("input", () => {
  const el = $("chat-input");
  el.style.height = "auto";
  el.style.height = el.scrollHeight + 2 + "px";
});

$("btn-back").addEventListener("click", showLibrary);

// ---------- sidebar resizing ----------

document.querySelectorAll(".resizer").forEach((rz) => {
  rz.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    rz.classList.add("dragging");
    const pane = $(rz.dataset.pane);
    const startX = e.clientX;
    const startW = pane.offsetWidth;
    const sign = rz.dataset.edge === "left" ? 1 : -1; // which side of the pane the handle sits on
    const move = (ev) => (pane.style.width = startW + sign * (ev.clientX - startX) + "px"); // CSS min/max-width clamp it
    const up = () => {
      rz.classList.remove("dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
});

// ---------- find in document ----------

const find = { pages: [], idx: -1, seq: 0 }; // pages: [{page, count}] for the current term

async function runFind() {
  const term = $("find-input").value.trim().toLowerCase();
  const seq = ++find.seq; // typing fast: only the latest search may apply
  find.pages = [];
  find.idx = -1;
  clearSearchHighlights();
  if (term) {
    // state.text pages are "[Page N]…" blocks joined with \n\n (see extractText)
    // — a cheap pre-filter so we only fetch text items of pages that can match.
    // ponytail: a term spanning two pdf.js text items (line break, style change)
    // matches neither the rects nor, usually, the space-joined block; text layer
    // if that ever matters
    for (const block of state.text.split(/\n\n(?=\[Page \d+\])/)) {
      const page = Number(block.match(/^\[Page (\d+)\]/)?.[1]);
      if (!page || !block.toLowerCase().includes(term)) continue;
      const rects = await searchRects(page, term);
      if (seq !== find.seq) return;
      if (!rects.length) continue;
      (state.hls[page] ??= []).push(...rects);
      find.pages.push({ page, count: rects.length });
    }
  }
  refreshHighlightLayers();
  if (find.pages.length) gotoMatch(0);
  else $("find-count").textContent = term ? "No matches" : "";
}

function clearSearchHighlights() {
  let had = false;
  for (const p of Object.keys(state.hls)) {
    had = had || state.hls[p].some((h) => h.cls === "search");
    state.hls[p] = state.hls[p].filter((h) => h.cls !== "search");
  }
  return had;
}

function gotoMatch(idx) {
  const n = find.pages.length;
  find.idx = ((idx % n) + n) % n;
  const { page } = find.pages[find.idx];
  const total = find.pages.reduce((sum, p) => sum + p.count, 0);
  $("find-count").textContent = `Page ${page} · ${find.idx + 1}/${n} pages · ${total} matches`;
  const wrap = document.querySelector(`.page-wrap[data-page="${page}"]`);
  wrap?.scrollIntoView({ block: "start" });
  wrap?.classList.add("flash");
  setTimeout(() => wrap?.classList.remove("flash"), 1200);
}

function openFind() {
  $("find-bar").hidden = false;
  $("find-input").focus();
  $("find-input").select();
}
function closeFind() {
  $("find-bar").hidden = true;
  $("find-input").value = "";
  $("find-count").textContent = "";
  find.pages = [];
  if (clearSearchHighlights()) refreshHighlightLayers();
}

$("btn-find").addEventListener("click", openFind);
$("find-close").addEventListener("click", closeFind);
$("find-next").addEventListener("click", () => find.pages.length && gotoMatch(find.idx + 1));
$("find-prev").addEventListener("click", () => find.pages.length && gotoMatch(find.idx - 1));
$("find-input").addEventListener("input", runFind);
$("find-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    if (find.pages.length) gotoMatch(find.idx + (e.shiftKey ? -1 : 1));
  } else if (e.key === "Escape") {
    closeFind();
  }
});
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "f" && !$("session").hidden) {
    e.preventDefault();
    openFind();
  }
});

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
