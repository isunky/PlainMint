import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const source = path.join(appRoot, "src-tauri", "tauri.release.conf.json.example");
const destination = path.join(appRoot, "src-tauri", "tauri.release.conf.json");
const publicKey = process.env.TAURI_UPDATER_PUBLIC_KEY;

if (!publicKey) {
  throw new Error("TAURI_UPDATER_PUBLIC_KEY is required for a release build.");
}

const template = await readFile(source, "utf8");
await writeFile(destination, template.replace("__TAURI_UPDATER_PUBLIC_KEY__", publicKey), "utf8");
