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

- `scripts/bundle-assets.mjs` downloads the pinned **llama.cpp** release into `src-tauri/resources/` (skipped if already present). The **model is deliberately NOT bundled** — a >2 GB installer exceeds GitHub Releases' 2 GB per-asset limit, so the app downloads the ~3 GB model on first launch instead.
- Tauri bundles the llama.cpp runtime into the app; at runtime `find_server` uses the bundled binary and `download_assets` fetches only the missing model into app data on first launch.

> **Do not re-add the model to the bundle.** It makes the installer exceed 2 GB and the release upload fails with `size must be less than 2147483648`.

## Pinned versions

- **llama.cpp** release tag (e.g. `b9950`) + per-OS asset names: defined in **both** `src-tauri/src/lib.rs` (runtime download fallback) and `scripts/bundle-assets.mjs` (installer bundling) — **change both together**.
- **Model** URL + filename (e.g. Gemma 4 E2B Q4_K_M): only in `src-tauri/src/lib.rs` (the model is not bundled).

The model URL/filename lives only in `lib.rs` (the model isn't bundled). When replacing the model, add the old filename to `OLD_MODEL_FILES` in `lib.rs` so upgraded installs delete the superseded ~3 GB file.

After bumping either pin, verify locally before tagging: `npm run tauri dev`, confirm the model loads and a chat round-trip works.

## Local production build

```sh
npm install
npm run tauri build   # installers land in src-tauri/target/release/bundle/
```

The build downloads the small llama.cpp runtime into `src-tauri/resources/` (git-ignored). The installer stays well under GitHub's 2 GB asset limit; the model is fetched by the app on first launch.

## Known release caveats

- Builds are **unsigned**: Windows SmartScreen and macOS Gatekeeper will warn users (documented in the User Guide + README). Code signing is the main polish item for a future release.
- `tauri.conf.json` pins `"targets": "all"` — on Windows that produces both `.msi` and `.exe` (NSIS).
