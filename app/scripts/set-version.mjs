import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  throw new Error("Expected a semantic version such as 1.2.3");
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");

async function updateJson(relativePath, update) {
  const filePath = path.join(appRoot, relativePath);
  const value = JSON.parse(await readFile(filePath, "utf8"));
  update(value);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

await updateJson("package.json", (value) => {
  value.version = version;
});
await updateJson("package-lock.json", (value) => {
  value.version = version;
  value.packages[""].version = version;
});
await updateJson(path.join("src-tauri", "tauri.conf.json"), (value) => {
  value.version = version;
});

const cargoPath = path.join(appRoot, "src-tauri", "Cargo.toml");
const cargo = await readFile(cargoPath, "utf8");
await writeFile(
  cargoPath,
  cargo.replace(/^version = "[^"]+"/m, `version = "${version}"`),
  "utf8",
);

const cargoLockPath = path.join(appRoot, "src-tauri", "Cargo.lock");
const cargoLock = await readFile(cargoLockPath, "utf8");
const plainMintCargoLockPattern = /(\[\[package\]\]\r?\nname = "plainmint"\r?\nversion = ")[^"]+("\r?\n)/;
if (!plainMintCargoLockPattern.test(cargoLock)) {
  throw new Error("PlainMint package entry was not found in Cargo.lock");
}
const updatedCargoLock = cargoLock.replace(
  plainMintCargoLockPattern,
  `$1${version}$2`,
);
await writeFile(cargoLockPath, updatedCargoLock, "utf8");

console.log(`PlainMint version set to ${version}`);
