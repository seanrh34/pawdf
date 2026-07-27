# Changelog

## 1.0.1 — 2026-07-23

### Features

- **AI generation now runs in the background**, decoupled from the visible session. Summaries and answers stream into a per-session buffer, so you can switch to another PDF while one is still generating — the job keeps running and saves to its own session. A single generation slot (llama-server allows one) is enforced with a small queue; navigation is never blocked.
- **Free scrolling while streaming**: auto-scroll now only follows when you're already at the bottom, so you can read earlier messages while tokens arrive.
- **Warns before closing** the app while the AI is still generating.

### Fixes

- Uninstall documentation corrected: the Windows `.exe` uninstaller offers a "Delete the application data" checkbox that removes the ~3 GB model and your library; the `.msi` and macOS leave them in place for manual deletion.
- Release notes and docs no longer claim the model ships inside the installer — it downloads on first launch.
- Dropped the macOS Intel (`macos-13`) build: GitHub is retiring those runners and the job hung waiting for one. Releases now cover Windows x64 and Apple Silicon.

## 1.0.0 — 2026-07-19

First stable release.

### Features

- **Fully offline PDF chat**: Gemma 4 E2B (a reasoning model) served by a bundled llama.cpp; no cloud, no accounts, no data leaves the device.
- **Three-panel session view**: library sidebar (switch/create sessions) · PDF preview · chat sidebar; both sidebars resizable.
- **PDF preview**: fit-to-width rendering with lazy page loading, zoom (40–300%), centered pages, editable current-page navigator, floating bottom toolbar.
- **Find in document** (button or Ctrl/Cmd+F): live word-level highlights drawn on the pages, match counter, next/previous navigation.
- **Chat**: streamed markdown answers, live collapsible model reasoning ("Thinking…"), clickable page citations that jump the preview to the source page, pulsing generation indicator. The chat stays scrollable while an answer streams in, so you can read back without being yanked to the bottom.
- **Background generation**: the AI keeps working when you switch to another PDF — summaries and answers finish and save to their own session in the background, and closing the app while it's still running asks for confirmation.
- **New-session onboarding**: automatic document summary plus two clickable starter questions.
- **Transparency**: persistent local-model status (name, resource footprint) and an AI-can-make-mistakes reminder.
- First-launch model download (~3 GB, one time) with progress bar + live engine log; the llama.cpp runtime ships bundled in the installer, so only the model is fetched, and the app is fully offline thereafter.
- Robust AI lifecycle: llama-server starts with the app, stops on close, stale processes cleaned up on startup, startup failures surface with a Retry.

### Privacy & security

- Answers are grounded in the document: the model is instructed to answer only from the PDF, admit when the answer isn't present, and cite pages (verifiable via the clickable citations).
- No web capability: the inference engine cannot browse or search, and the app window enforces a strict Content-Security-Policy plus HTML sanitization so nothing in a document or answer can trigger an outbound network request — even while the machine is online.
- Self-contained: PawDF installs and uses its own copy of llama.cpp and the model; it never reuses or modifies an existing local install.

### Docs

- User guide with screenshots (`docs/USER_GUIDE.md`), release process (`docs/RELEASING.md`).
