# Releasing PawDF

## Checklist

1. **Bump the version** in all three files (they must match):
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`
2. Update `CHANGELOG.md`.
3. Commit, then tag and push:

   ```sh
   git tag v1.0.0
   git push origin main --tags
   ```

4. CI (`.github/workflows/release.yml`) builds installers for **Windows x64**, **macOS arm64**, and **macOS Intel**, and attaches them to a **draft** GitHub release named "PawDF v1.0.0".
5. Review the draft release, edit notes, and **publish** it.

## What the build does

`beforeBuildCommand` runs `npm run bundle-assets && npm run build`:

- `scripts/bundle-assets.mjs` downloads the pinned llama.cpp release and the Gemma model GGUF into `src-tauri/resources/` (skipped if already present), so **installers ship fully offline-capable**.
- Tauri bundles those resources into the app; at runtime the backend prefers bundled resources and falls back to downloading into app data (dev builds).

## Pinned versions

Both live at the top of `src-tauri/src/lib.rs` and are duplicated in `scripts/bundle-assets.mjs` — **change both files together**:

- llama.cpp release tag (e.g. `b9950`) and per-OS asset names
- Model URL + filename (e.g. Gemma 4 E2B Q4_K_M)

When replacing the model, add the old filename to `OLD_MODEL_FILES` in `lib.rs` so upgraded dev installs delete the superseded ~3 GB file.

After bumping either pin, verify locally before tagging: `npm run tauri dev`, confirm the model loads and a chat round-trip works.

## Local production build

```sh
npm install
npm run tauri build   # installers land in src-tauri/target/release/bundle/
```

The first run downloads ~3.4 GB into `src-tauri/resources/` (git-ignored).

## Known release caveats

- Builds are **unsigned**: Windows SmartScreen and macOS Gatekeeper will warn users (documented in the User Guide + README). Code signing is the main polish item for a future release.
- `tauri.conf.json` pins `"targets": "all"` — on Windows that produces both `.msi` and `.exe` (NSIS).
