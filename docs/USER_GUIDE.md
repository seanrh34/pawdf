# PawDF User Guide

PawDF lets you chat with your PDFs — **fully local, fully offline**. A small AI model (Gemma 4 E2B) runs directly on your computer; your documents and questions never leave your machine.

![PawDF session view](img/session.png)

---

## 1. Installing PawDF

1. Download the installer for your OS from the [Releases page](../../../releases):
   - **Windows:** `.msi` or `.exe`
   - **macOS:** `.dmg` (Apple Silicon and Intel builds)
2. Run the installer and launch PawDF.

Because the builds are not code-signed yet, your OS will warn you on first launch:

- **Windows (SmartScreen):** click **More info → Run anyway**.
- **macOS (Gatekeeper):** if macOS says the app "is damaged" or "can't be opened", run `xattr -cr /Applications/PawDF.app` in Terminal, or right-click the app and choose **Open**.

**First launch downloads the AI model** — about 3 GB, one time. You need an internet connection for this one download; the loading screen shows its progress. The AI engine itself ships inside the installer, so only the model is fetched. Once it's downloaded, PawDF is fully offline forever after — no further internet is ever used.

**System requirements:** Windows 10+ or macOS, roughly 4 GB of free RAM while the app is open, about 4 GB of disk space, and an internet connection for the one-time model download on first launch.

## 2. Starting up

The very first time you open PawDF it downloads the AI model (~3 GB, one time) with a progress bar. After that, every launch just starts the local AI and shows a loading screen until the model is ready — a few seconds on a modern laptop. The loading screen streams the AI engine's own startup log, so you can see progress — it is never just a blank spinner.

If startup fails you'll get an error with a **Retry** button; see [Troubleshooting](#8-troubleshooting).

## 3. Home screen — your library

![Home screen](img/home.png)

The home screen lists every document you've added. Each card shows the PDF's name and when you added it.

- **+ Upload PDF** — choose a PDF to start a new session. The file is *copied* into PawDF's storage, so you can move or delete the original afterwards.
- Click a card to open that session.
- **Delete** removes the session, its chat history, and PawDF's copy of the PDF.

Every session is built around one PDF — uploading a document is what creates a session.

## 4. The session view

Opening a session shows three panels, left to right:

| Panel | What it does |
|---|---|
| **Library sidebar** | Switch to any other document, or start a new one, without leaving the view |
| **PDF preview** | The document itself, with zoom, page navigation, and search |
| **Chat sidebar** | Your conversation with the AI about this document |

Both sidebars can be **resized** — drag the thin divider on their inner edge. **Home** (top left) returns to the library.

### The PDF preview

The floating toolbar at the bottom center of the preview has everything:

- **− / +** — zoom out / in (40%–300%; 100% fits the page to the panel width). The page stays centered at any size.
- **Page number** — shows the current page as you scroll; click it, type a page number, and press Enter to jump there.
- **🔍** — find in the document (or press **Ctrl+F** / **Cmd+F**).

### Find in document

![Find with highlights](img/find.png)

Type in the find bar and matches are **highlighted in yellow on the page itself**, live as you type. The counter shows which page you're on, how many pages have matches, and the total count. **Enter** / **Shift+Enter** (or ↑ ↓) step between matching pages; **Esc** closes the bar and clears the highlights.

## 5. Chatting with your document

When you upload a new PDF, the AI automatically:

1. **Summarizes the document** for you, with page citations, and
2. Offers **two starter questions** as clickable blocks — click one and it's asked exactly as if you typed it.

Then ask anything. Responses:

- **Stream in live**, word by word, formatted (bold, lists, tables, code).
- Show the model's **thinking** in a collapsible block while it reasons; it folds away automatically when the answer starts. Click "Thought process" to reread it later.
- Include **clickable page citations** — chips like `p. 4` that jump the PDF preview straight to the page the answer came from.

The AI answers **only from the document**. If the answer isn't in the PDF, it says so rather than guessing. Conversations are saved automatically after every exchange and are there when you come back.

- **Clear chat** wipes the conversation but keeps the PDF (a fresh summary is generated next time you open the session).
- The reminder under the input box is worth repeating here: **AI can make mistakes** — verify important answers against the document itself. The citations make that a one-click check.

## 6. The local AI — what's running on your computer

The chat header shows what's running: **Gemma 4 E2B · Local AI**. Hover it for details. In plain terms:

- A small AI model (Google's Gemma 4 E2B, ~3 GB) runs **on your computer**, powered by [llama.cpp](https://github.com/ggml-org/llama.cpp).
- While PawDF is open it uses about **3 GB of RAM** and some CPU when generating answers.
- It starts when PawDF starts and **stops completely when you close the app** — nothing keeps running in the background.
- **No internet is used** for answering questions. Nothing you upload or ask leaves your device.
- **Already have llama.cpp or Gemma on your computer** (for example through Ollama or LM Studio)? PawDF still installs its own private copy and only ever uses that. It won't detect, reuse, or modify anything you have installed — the two live side by side, and removing one never affects the other. This costs some extra disk space (~3–4 GB) but keeps PawDF fully self-contained.

### Security, in plain words

- **Turn off Wi-Fi and everything still works** — that's the simplest proof nothing depends on the cloud. Your documents and conversations stay on your machine, full stop.
- **The AI cannot browse the web.** Even while your computer is online, the AI engine has no search or internet capability, and the app's display is locked down so nothing hidden in a PDF or an AI answer can secretly load anything from the internet (e.g. tracking images).
- **Answers are anchored to your document.** The AI is instructed to answer only from the PDF, admit when the answer isn't in it, and cite pages — the clickable `p. N` chips let you check any claim against the source in one click.
- **No accounts, no telemetry.** PawDF never asks who you are and sends no usage statistics.

## 7. Where your data lives

Everything is stored in PawDF's app-data folder:

- **Windows:** `%APPDATA%\com.pawdf.app`
- **macOS:** `~/Library/Application Support/com.pawdf.app`

Inside:

- `sessions/<id>/` — each session's `doc.pdf` (your copy), `doc.txt` (extracted text), `chat.json` (conversation), and `meta.json`
- `models/` — the downloaded Gemma 4 model (**~3 GB**)
- `bin/` — an extra copy of the AI engine, only if one was ever downloaded (normal installs use the copy bundled inside the app instead)
- `llama-server.log`, `health.log` — diagnostics

Deleting this folder resets PawDF completely — including the model, which it will re-download on next launch. Note this folder **survives uninstalling the app**; see [Uninstalling PawDF](#9-uninstalling-pawdf).

## 8. Troubleshooting

**The loading screen fails or hangs**
- Click **Retry** first.
- Check the logs in the app-data folder (paths above): `llama-server.log` is the AI engine's own output; `health.log` records why startup checks failed.
- On a development build, a failed first-run download usually means a network issue — Retry resumes it.

**"Setup failed: download of … failed"** — the one-time model download needs internet; check your connection and Retry. After that download, PawDF never needs internet again.

**Answers are slow** — the model reasons before it answers (you'll see the Thinking block streaming). Speed depends on your CPU; closing other heavy apps helps. Long documents also take longer on the first question than on follow-ups.

**The AI gave a wrong answer** — it can happen; that's why citations exist. Click the page chip and check the source. Rephrasing the question more specifically usually helps.

**Reset everything** — quit PawDF and delete the app-data folder listed in section 7.

## 9. Uninstalling PawDF

PawDF installs no background services — the AI runs only while the app is open — so uninstalling is straightforward. But **uninstalling does not remove the AI model**, and that is deliberate. Here's exactly what happens:

| | Removed by uninstalling? | Where it lives |
|---|---|---|
| The PawDF app | ✅ Yes | Program/app folder |
| llama.cpp AI engine (~45 MB) | ✅ Yes — it ships *inside* the app | App folder, under `resources/llama` |
| **Gemma 4 model (~3 GB)** | ❌ **No — kept on purpose** | Your app-data folder, under `models` |
| Your documents & chats | ❌ No — kept on purpose | Your app-data folder, under `sessions` |

**Why the model is kept:** it's a 3 GB download and it counts as your data, not program files. Leaving it means reinstalling or upgrading PawDF is instant instead of costing another 3 GB download — and you never lose your document library. This is why the app works immediately after a reinstall.

**The trade-off:** about **3 GB stays on your disk** after uninstalling. If you're removing PawDF to free space, do the optional cleanup step below — that's the part that actually reclaims the 3 GB.

### Windows

Don't delete the installation folder by hand — the installer registers PawDF with Windows, so use the normal uninstaller:

1. **Settings → Apps → Installed apps**, find **PawDF**, click **⋯ → Uninstall** (or "Add or remove programs"). This removes the app, the bundled llama.cpp engine, shortcuts, and registry entries.
2. **To also delete the 3 GB model and your data**, paste each of these into the File Explorer address bar and delete the folder if it exists:
   - `%APPDATA%\com.pawdf.app` — **the big one (~3 GB)**: the model (`models`), your documents and chats (`sessions`), logs, and an extra copy of the AI engine (`bin`) if one was ever downloaded
   - `%LOCALAPPDATA%\com.pawdf.app` — the embedded browser's cache (~50 MB)

### macOS

macOS apps have no registry, so deleting the app bundle is the correct uninstall:

1. Quit PawDF, then drag **PawDF** from **Applications** to the **Trash** and empty it. This removes the app and the bundled llama.cpp engine.
2. **To also delete the 3 GB model and your data**, open Finder, press **Cmd+Shift+G**, and delete these if they exist:
   - `~/Library/Application Support/com.pawdf.app` — **the big one (~3 GB)**: the model (`models`), your documents and chats (`sessions`), logs, and an extra copy of the AI engine (`bin`) if one was ever downloaded
   - `~/Library/Caches/com.pawdf.app` and `~/Library/WebKit/com.pawdf.app` — caches
   - `~/Library/Preferences/com.pawdf.app.plist` — window settings

After step 2 on either OS, no trace of PawDF, the AI model, or your documents remains.

### Just want the disk space back, but keep your documents?

Delete only the `models` folder inside the app-data folder above (`%APPDATA%\com.pawdf.app\models` on Windows, `~/Library/Application Support/com.pawdf.app/models` on macOS). Your documents and chats stay intact, and PawDF simply re-downloads the model next time you launch it.

## 10. FAQ

**Is it really offline?** Yes, after the one-time model download. The only time PawDF ever uses the internet is that first-launch download of the ~3 GB model. From then on nothing — your documents, questions, and answers stay entirely on your machine.

**Can I use a different model?** Not from the UI yet — it's on the roadmap (multiple models, bring-your-own GGUF, optional cloud APIs). Developers can change the pinned model constant in `src-tauri/src/lib.rs`.

**What PDFs work?** Text-based PDFs work best. Scanned/image-only PDFs render fine in the preview, but there is no OCR yet, so the AI can't read them.

**How big can the PDF be?** Any size renders. For very long documents the AI selects the most relevant sections per question, so pinpoint questions work better than "summarize everything" on a 500-page book.
