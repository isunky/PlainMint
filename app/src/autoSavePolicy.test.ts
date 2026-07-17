import { describe, expect, it } from "vitest";
import { isAutoSaveEligible, isAutoSaveRevisionSuppressed } from "./autoSavePolicy";
import type { DocumentRecord } from "./types";

function document(patch: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: "doc-1",
    filePath: "C:\\notes.txt",
    fileName: "notes.txt",
    content: "notes",
    encoding: "utf-8",
    lineEnding: "lf",
    languageMode: "auto",
    detectedLanguage: "plain",
    autoLanguageDetectionComplete: true,
    dirty: true,
    readOnly: false,
    missing: false,
    externalModified: false,
    revision: 2,
    createdAt: 1,
    ...patch,
  };
}

describe("auto-save policy", () => {
  it("only accepts dirty writable documents with an existing path and no conflict", () => {
    expect(isAutoSaveEligible(document())).toBe(true);
    expect(isAutoSaveEligible(document({ filePath: undefined }))).toBe(false);
    expect(isAutoSaveEligible(document({ dirty: false }))).toBe(false);
    expect(isAutoSaveEligible(document({ readOnly: true }))).toBe(false);
    expect(isAutoSaveEligible(document({ missing: true }))).toBe(false);
    expect(isAutoSaveEligible(document({ externalModified: true }))).toBe(false);
  });

  it("suppresses only the exact failed content revision", () => {
    expect(isAutoSaveRevisionSuppressed(document(), 2)).toBe(true);
    expect(isAutoSaveRevisionSuppressed(document({ revision: 3 }), 2)).toBe(false);
  });
});
