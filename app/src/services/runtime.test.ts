import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentRecord } from "../types";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  join: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/path", () => ({ join: mocks.join }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open, save: mocks.save }));

import { encodedByteLength, saveDocument } from "./runtime";

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
