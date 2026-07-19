# Changelog

## 1.0.0 — 2026-07-19

First stable release.

### Features

- **Fully offline PDF chat**: Gemma 4 E2B (a reasoning model) served by a bundled llama.cpp; no cloud, no accounts, no data leaves the device.
- **Three-panel session view**: library sidebar (switch/create sessions) · PDF preview · chat sidebar; both sidebars resizable.
- **PDF preview**: fit-to-width rendering with lazy page loading, zoom (40–300%), centered pages, editable current-page navigator, floating bottom toolbar.
- **Find in document** (button or Ctrl/Cmd+F): live word-level highlights drawn on the pages, match counter, next/previous navigation.
- **Chat**: streamed markdown answers, live collapsible model reasoning ("Thinking…"), clickable page citations that jump the preview to the source page, pulsing generation indicator.
- **New-session onboarding**: automatic document summary plus two clickable starter questions.
- **Transparency**: persistent local-model status (name, resource footprint) and an AI-can-make-mistakes reminder.
- First-launch model download with progress + live engine log (dev builds); installers ship with model and runtime bundled for offline first run.
- Robust AI lifecycle: llama-server starts with the app, stops on close, stale processes cleaned up on startup, startup failures surface with a Retry.

### Privacy & security

- Answers are grounded in the document: the model is instructed to answer only from the PDF, admit when the answer isn't present, and cite pages (verifiable via the clickable citations).
- No web capability: the inference engine cannot browse or search, and the app window enforces a strict Content-Security-Policy plus HTML sanitization so nothing in a document or answer can trigger an outbound network request — even while the machine is online.
- Self-contained: PawDF installs and uses its own copy of llama.cpp and the model; it never reuses or modifies an existing local install.

### Docs

- User guide with screenshots (`docs/USER_GUIDE.md`), release process (`docs/RELEASING.md`).
