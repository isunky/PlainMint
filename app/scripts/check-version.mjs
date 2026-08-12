import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(appRoot, relativePath), "utf8"));
}

function requireMatch(source, pattern, label) {
  const match = source.match(pattern);
  if (!match) throw new Error(`Could not read ${label}`);
  return match[1];
}

const packageJson = await readJson("package.json");
const packageLock = await readJson("package-lock.json");
const tauriConfig = await readJson(path.join("src-tauri", "tauri.conf.json"));
const cargo = await readFile(path.join(appRoot, "src-tauri", "Cargo.toml"), "utf8");
const cargoLock = await readFile(path.join(appRoot, "src-tauri", "Cargo.lock"), "utf8");
const expected = packageJson.version;
const versions = new Map([
  ["package.json", packageJson.version],
  ["package-lock.json", packageLock.version],
  ["package-lock.json root package", packageLock.packages?.[""]?.version],
  ["tauri.conf.json", tauriConfig.version],
  ["Cargo.toml", requireMatch(cargo, /^version = "([^"]+)"/m, "Cargo.toml package version")],
  ["Cargo.lock", requireMatch(cargoLock, /\[\[package\]\]\r?\nname = "plainmint"\r?\nversion = "([^"]+)"/, "Cargo.lock PlainMint version")],
]);
const mismatches = [...versions].filter(([, version]) => version !== expected);
if (mismatches.length > 0) {
  throw new Error(`PlainMint version mismatch; expected ${expected}: ${mismatches.map(([file, version]) => `${file}=${version ?? "missing"}`).join(", ")}`);
}

console.log(`PlainMint version metadata is consistent: ${expected}`);
