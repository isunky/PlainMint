import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../store";
import type { DocumentRecord } from "../types";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  documentDir: vi.fn(),
  join: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
  check: vi.fn(),
  relaunch: vi.fn(),
  revealItemInDir: vi.fn(),
  getVersion: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: mocks.getVersion }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/api/path", () => ({ documentDir: mocks.documentDir, join: mocks.join }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open, save: mocks.save }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(), revealItemInDir: mocks.revealItemInDir }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));

import { checkForUpdates, encodedByteLength, getAppVersion, inspectFileMetadata, listenForFileWatchChanges, revealFileInDirectory, saveDocument, syncFileWatches, writeSafetyRecovery } from "./runtime";

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
  mocks.documentDir.mockResolvedValue("C:\\Users\\PlainMint\\Documents");
  mocks.join.mockResolvedValue("C:\\Default\\untitled.txt");
  mocks.save.mockResolvedValue("C:\\Default\\untitled.txt");
  mocks.getVersion.mockResolvedValue("1.2.3");
  mocks.listen.mockResolvedValue(mocks.unlisten);
  mocks.invoke.mockResolvedValue({
    path: "C:\\Default\\untitled.txt",
    fingerprint: { modifiedAt: 1, size: 9, hash: "hash" },
    savedAt: 1,
  });
});

describe("file watch runtime bridge", () => {
  it("uses metadata-only inspection and synchronizes watched paths", async () => {
    const metadata = { exists: true, modifiedAt: 4, size: 12, readOnly: false };
    const status = { available: true, watchedFiles: 1, watchedDirectories: 1, failedDirectories: [] };
    mocks.invoke.mockImplementation(async (command: string) => command === "inspect_file_metadata" ? metadata : status);

    await expect(inspectFileMetadata("C:\\Notes\\alpha.txt")).resolves.toEqual(metadata);
    await expect(syncFileWatches(["C:\\Notes\\alpha.txt"])).resolves.toEqual(status);

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "inspect_file_metadata", { path: "C:\\Notes\\alpha.txt" });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "sync_file_watches", { paths: ["C:\\Notes\\alpha.txt"] });
  });

  it("forwards Rust file events and returns an unlisten handle", async () => {
    const handler = vi.fn();
    const dispose = await listenForFileWatchChanges(handler);
    const eventHandler = mocks.listen.mock.calls[0][1] as (event: { payload: { paths: string[] } }) => void;

    eventHandler({ payload: { paths: ["C:\\Notes\\alpha.txt"] } });
    dispose();

    expect(mocks.listen).toHaveBeenCalledWith("plainmint-file-watch-change", expect.any(Function));
    expect(handler).toHaveBeenCalledWith(["C:\\Notes\\alpha.txt"]);
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });
});

describe("file location runtime bridge", () => {
  it("reveals a saved file in its containing folder", async () => {
    await revealFileInDirectory("C:\\Notes\\alpha.txt");

    expect(mocks.revealItemInDir).toHaveBeenCalledWith("C:\\Notes\\alpha.txt");
  });

});

describe("save dialog defaults", () => {
  it("uses the configured folder for an untitled document's first save", async () => {
    await saveDocument(document(), { defaultSaveFolder: "C:\\Default" });

    expect(mocks.join).toHaveBeenCalledWith("C:\\Default", "untitled.txt");
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "C:\\Default\\untitled.txt" }));
  });

  it("uses the user's Documents folder when no save folder is configured", async () => {
    mocks.join.mockResolvedValue("C:\\Users\\PlainMint\\Documents\\untitled.txt");

    await saveDocument(document());

    expect(mocks.documentDir).toHaveBeenCalledOnce();
    expect(mocks.join).toHaveBeenCalledWith("C:\\Users\\PlainMint\\Documents", "untitled.txt");
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "C:\\Users\\PlainMint\\Documents\\untitled.txt" }));
  });

  it("keeps an existing file path as the Save As starting point", async () => {
    const existing = document({ filePath: "C:\\Existing\\notes.txt", fileName: "notes.txt" });
    mocks.save.mockResolvedValue("C:\\Existing\\copy.txt");

    await saveDocument(existing, { forceSaveAs: true, defaultSaveFolder: "C:\\Default" });

    expect(mocks.join).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: existing.filePath }));
  });

  it("rejects a conflict copy that targets the original path", async () => {
    const existing = document({ filePath: "C:\\Existing\\notes.txt", fileName: "notes.txt" });
    mocks.save.mockResolvedValue("c:\\existing\\notes.txt");

    await expect(saveDocument(existing, { forceSaveAs: true, requireDifferentPath: existing.filePath })).rejects.toEqual({ code: "same_file_path" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("sends an accepted disk fingerprint when overwriting a reviewed conflict", async () => {
    const existing = document({ filePath: "C:\\Existing\\notes.txt", fileName: "notes.txt" });
    const fingerprint = { modifiedAt: 7, size: 4, hash: "disk-hash" };

    await saveDocument(existing, { acceptedExternalFingerprint: fingerprint });

    expect(mocks.invoke).toHaveBeenCalledWith("save_file", expect.objectContaining({
      request: expect.objectContaining({ expectedFingerprint: fingerprint, fallbackFileName: "notes.txt" }),
    }));
  });

  it("sends a fallback file name so a selected directory can be saved into", async () => {
    await saveDocument(document({ fileName: "draft.txt" }));

    expect(mocks.invoke).toHaveBeenCalledWith("save_file", expect.objectContaining({
      request: expect.objectContaining({ fallbackFileName: "draft.txt" }),
    }));
  });
});

describe("encoded file size", () => {
  it("accounts for BOMs, UTF-16 units, and converted line endings", () => {
    expect(encodedByteLength(document({ content: "a\nb", encoding: "utf-8-bom", lineEnding: "crlf" }))).toBe(7);
    expect(encodedByteLength(document({ content: "a😀", encoding: "utf-16le" }))).toBe(8);
  });
});

describe("conflict safety backups", () => {
  it("creates a forced recovery copy even when automatic backups are disabled", async () => {
    await writeSafetyRecovery({
      documentId: "doc-1",
      fileName: "notes.txt",
      originalPath: "C:\\notes.txt",
      content: "safe local copy",
      encoding: "utf-8",
      lineEnding: "lf",
    }, { ...defaultSettings, autoBackupEnabled: false }, "conflict-local");

    expect(mocks.invoke).toHaveBeenCalledWith("write_backup", expect.objectContaining({
      request: expect.objectContaining({ reason: "conflict-local", content: "safe local copy" }),
    }));
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
