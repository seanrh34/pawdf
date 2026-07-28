# Changelog

## Unreleased

Long, dense documents — contracts, case law, reports of 100+ pages — are now the target. Previously a 150-page contract showed the model roughly 5% of itself per question, chosen by raw keyword counts, and took ~30 seconds to answer.

### Features

- **GPU acceleration on Windows.** Bundles llama.cpp's Vulkan runtime instead of the CPU-only build. It works with any compatible GPU including integrated graphics, and falls back to the CPU backends it also ships when there is none — so it is a strict upgrade, not a hardware requirement. Measured on an RTX 3090: prompt processing went from 135 to ~4,500 tokens/second, generation from 14 to ~130 tokens/second. Installer grows by ~32 MB.
- **The document budget is measured, not guessed.** The backend times a real prefill at startup and the UI sizes each question's document budget from it — ~12k characters on a slow CPU up to 90k on a GPU. One build stays usable across very different machines. Cached after the first run; the first measurement also absorbs Vulkan's one-off shader compilation, which would otherwise land on the user's first question.
- **Context window raised** from 8k to 32k tokens, with llama-server pinned to a single slot so one question can use all of it.
- **BM25 retrieval, on page-aligned chunks.** Replaces raw term-overlap counting. Rare, locating terms ("indemnity", "12.3") now outrank the boilerplate every clause repeats, stopwords are dropped, and a relative floor keeps a question from dragging in every chunk that merely shares the word "agreement". The opening pages are always included (parties, dates, definitions), neighbouring chunks come along so a clause and its carve-outs stay together, and the previous question joins the query so follow-ups retrieve against the topic they continue.

- **Word forms are folded before ranking.** People ask "which law *governs* this agreement" about a clause reading "*governed* by the *laws* of Singapore". Without stemming those share no tokens, and on a 320-page contract that clause was never retrieved at realistic budgets. A crude suffix stripper (applied identically to query and document, so linguistic accuracy doesn't matter) takes retrieval from 6/7 to 9/9 on a 320-page contract at 2.4% coverage.
- **Thinking is now off.** Answering from a document is extraction, not deduction. Measured over repeated runs on a 120-page contract, the model reasons itself onto a neighbouring page: 6/7 correct citations with thinking, 7/7 without, consistently. It is also 4–6x faster on a GPU, and on a CPU-only machine a 1,200-token reasoning trace costs over a minute. The collapsible "Thinking" block therefore no longer appears.

### Fixes

- **The budget overshot its own time target.** Characters-per-token was calibrated on synthetic filler (5.5) rather than real contract text (4.7), so the ten-second prefill target was ~17% optimistic — on exactly the machines least able to absorb it.
- **Citations could name the wrong page.** Chunks were blind character slices, so a chunk that fell between two `[Page N]` markers carried no page of its own and the model attributed it to whatever marker was nearest. Chunks are now cut on page boundaries and each carries its own marker.
- **Questions that matched nothing were answered anyway.** With no relevance floor, a question sharing no words with the document still filled the budget — with the opening pages, in document order — and the model answered confidently from them. Retrieval now reports when nothing matched and the model is told to say so.
- **New-session summaries only described the opening pages.** The summary was retrieved by ranking against the words "summary overview", which either matched stray occurrences or fell back to the start of the document. Summaries now sample evenly across the whole document.
- **Citations to pages that don't exist rendered as dead buttons.** Contracts number their clauses, and the model would cite "[p.604]" of a 120-page document; clicking scrolled nowhere. Only real pages become buttons now, multi-page citations like "[p.4, p.24]" are linked individually, and the model is told the valid page range.
- **The measured budget was lost on reload.** Delivered as an event that the already-running-server path never emitted; it is now pulled by the UI after startup.
- `npm run bundle-assets` no longer reuses a previously extracted runtime from a different asset, which would have silently shipped the old CPU build.

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
