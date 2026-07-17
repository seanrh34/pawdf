# 🐾 PawDF

Chat with your PDFs — fully local, fully offline. Like NotebookLM, but everything runs on your own machine.

PawDF is a desktop app (Windows + macOS) that lets you upload a PDF and ask questions about it. Answers come from a local LLM ([Gemma 4 E2B](https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF), ~3 GB) served by [llama.cpp](https://github.com/ggml-org/llama.cpp). **No cloud, no API keys, no data leaves your computer.**

## Install

1. Download the installer for your OS from [Releases](../../releases) (`.msi`/`.exe` for Windows, `.dmg` for macOS).
2. Run it and launch PawDF.
   - **macOS:** builds are unsigned, so Gatekeeper may say the app "is damaged" or "can't be opened". Fix: `xattr -cr /Applications/PawDF.app` (or right-click the app → Open).
   - **Windows:** SmartScreen may warn about an unrecognized app. Click "More info" → "Run anyway".
3. The installer includes llama.cpp and the Gemma model, so the installed app works offline from its first launch.

## Use

- **Upload PDF** → creates a session (the PDF is copied into app storage, so the original can move or be deleted).
- Ask questions in the chat; the model answers only from the document and streams its reply.
- Sessions auto-save after every exchange and reappear when you reopen the app.
- **Clear chat** wipes the conversation but keeps the PDF and its parsed text.
- **Delete session** removes the session, its chat, and the stored PDF copy.

Documents and chats live in the app data dir (`%APPDATA%/com.pawdf.app` on Windows, `~/Library/Application Support/com.pawdf.app` on macOS): `sessions/<id>/` (`doc.pdf`, `doc.txt`, `chat.json`, `meta.json`). The packaged model and llama.cpp runtime live in the installed app resources.

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

Releases are built by CI: push a tag like `v0.1.0` and the workflow uploads Windows + macOS (arm64 and Intel) installers to a draft GitHub release. Before tagging, bump the version in all three of `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.

To change the model or llama.cpp version, edit the constants at the top of `src-tauri/src/lib.rs`.

## Roadmap

- Pick from multiple local models / bring your own GGUF
- BYOK support for cloud APIs (optional, off by default)
- Embedding-based retrieval for very large documents
