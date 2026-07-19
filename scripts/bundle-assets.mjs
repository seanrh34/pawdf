import { createWriteStream } from "node:fs";
import { access, chmod, mkdir, readdir, rename, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const release = "https://github.com/ggml-org/llama.cpp/releases/download/b9950";
const assets = {
  "win32-x64": "llama-b9950-bin-win-cpu-x64.zip",
  "darwin-arm64": "llama-b9950-bin-macos-arm64.tar.gz",
  "darwin-x64": "llama-b9950-bin-macos-x64.tar.gz",
};
const asset = assets[`${process.platform}-${process.arch}`];
if (!asset) throw new Error(`Unsupported release target: ${process.platform}-${process.arch}`);

// Bundles only the small llama.cpp runtime into the installer. The ~3 GB model
// is NOT bundled: it would push the installer past GitHub Releases' 2 GB
// per-asset limit, so the app downloads it once on first launch instead
// (see download_assets in src-tauri/src/lib.rs).
const root = path.resolve("src-tauri/resources");
const llama = path.join(root, "llama");
const serverName = process.platform === "win32" ? "llama-server.exe" : "llama-server";

async function exists(file) {
  return access(file).then(() => true, () => false);
}

async function find(dir, name) {
  if (!(await exists(dir))) return null;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = await find(file, name);
      if (found) return found;
    } else if (entry.name === name) return file;
  }
  return null;
}

async function download(url, dest) {
  console.log(`Downloading ${path.basename(dest)}...`);
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`);
  const partial = `${dest}.part`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  await rename(partial, dest);
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

await mkdir(llama, { recursive: true });
let server = await find(llama, serverName);
if (!server) {
  const archive = path.join(root, asset);
  await download(`${release}/${asset}`, archive);
  const tar = process.platform === "win32" ? "C:\\Windows\\System32\\tar.exe" : "tar";
  await run(tar, ["-xf", archive, "-C", llama]);
  await rm(archive);
  server = await find(llama, serverName);
  if (!server) throw new Error(`${serverName} was not present in ${asset}`);
}
if (process.platform !== "win32") await chmod(server, 0o755);

console.log("llama.cpp runtime is ready for packaging (model downloads on first launch).");
