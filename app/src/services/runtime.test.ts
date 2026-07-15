import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentRecord } from "../types";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  join: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
  check: vi.fn(),
  relaunch: vi.fn(),
  getVersion: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: mocks.getVersion }));
vi.mock("@tauri-apps/api/path", () => ({ join: mocks.join }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open, save: mocks.save }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));

import { checkForUpdates, encodedByteLength, getAppVersion, saveDocument } from "./runtime";

function document(patch: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: "doc-1",
    fileName: "Untitled",
    content: "PlainMint",
    encoding: "utf-8",
    lineEnding: "lf",
    dirty: true,
    readOnly: false,
    missing: false,
    externalModified: false,
    revision: 1,
    createdAt: 1,
    ...patch,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  mocks.join.mockResolvedValue("C:\\Default\\untitled.txt");
  mocks.save.mockResolvedValue("C:\\Default\\untitled.txt");
  mocks.getVersion.mockResolvedValue("1.2.3");
  mocks.invoke.mockResolvedValue({
    path: "C:\\Default\\untitled.txt",
    fingerprint: { modifiedAt: 1, size: 9, hash: "hash" },
    savedAt: 1,
  });
});

describe("save dialog defaults", () => {
  it("uses the configured folder for an untitled document's first save", async () => {
    await saveDocument(document(), { defaultSaveFolder: "C:\\Default" });

    expect(mocks.join).toHaveBeenCalledWith("C:\\Default", "untitled.txt");
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "C:\\Default\\untitled.txt" }));
  });

  it("keeps an existing file path as the Save As starting point", async () => {
    const existing = document({ filePath: "C:\\Existing\\notes.txt", fileName: "notes.txt" });
    mocks.save.mockResolvedValue("C:\\Existing\\copy.txt");

    await saveDocument(existing, { forceSaveAs: true, defaultSaveFolder: "C:\\Default" });

    expect(mocks.join).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: existing.filePath }));
  });
});

describe("encoded file size", () => {
  it("accounts for BOMs, UTF-16 units, and converted line endings", () => {
    expect(encodedByteLength(document({ content: "a\nb", encoding: "utf-8-bom", lineEnding: "crlf" }))).toBe(7);
    expect(encodedByteLength(document({ content: "a😀", encoding: "utf-16le" }))).toBe(8);
  });
});

describe("signed application updates", () => {
  it("exposes the installed version and reports when no update exists", async () => {
    mocks.check.mockResolvedValue(null);

    await expect(getAppVersion()).resolves.toBe("1.2.3");
    await expect(checkForUpdates()).resolves.toEqual({ available: false });
  });

  it("reports download progress, installs, and relaunches", async () => {
    mocks.check.mockResolvedValue({
      version: "1.3.0",
      body: "A safer update.",
      downloadAndInstall: vi.fn(async (onEvent: (event: unknown) => void) => {
        onEvent({ event: "Started", data: { contentLength: 100 } });
        onEvent({ event: "Progress", data: { chunkLength: 40 } });
        onEvent({ event: "Finished", data: {} });
      }),
    });

    const result = await checkForUpdates();
    expect(result.available).toBe(true);
    if (!result.available) return;
    const progress = vi.fn();
    await result.install(progress);

    expect(progress).toHaveBeenNthCalledWith(1, { phase: "downloading", downloaded: 0, total: 100 });
    expect(progress).toHaveBeenNthCalledWith(2, { phase: "downloading", downloaded: 40, total: 100 });
    expect(progress).toHaveBeenNthCalledWith(3, { phase: "installing", downloaded: 40, total: 100 });
    expect(mocks.relaunch).toHaveBeenCalledOnce();
  });

  it("keeps the current version usable when checking fails", async () => {
    mocks.check.mockRejectedValue(new Error("offline"));

    await expect(checkForUpdates()).resolves.toEqual({ available: false, error: true });
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });
});
