import { describe, expect, it } from "vitest";
import { needsExitSaveConfirmation, needsSaveConfirmation } from "./closePolicy";
import type { DocumentRecord } from "./types";

function documentWith(content: string, dirty = true): DocumentRecord {
  return {
    id: "test-document",
    fileName: "Untitled",
    content,
    encoding: "utf-8",
    lineEnding: "lf",
    languageMode: "auto",
    detectedLanguage: "plain",
    autoLanguageDetectionComplete: false,
    dirty,
    readOnly: false,
    missing: false,
    externalModified: false,
    revision: 0,
    createdAt: 0,
  };
}

describe("close confirmation policy", () => {
  it("closes an empty dirty document without confirmation", () => {
    expect(needsSaveConfirmation(documentWith(""))).toBe(false);
  });

  it("still protects whitespace and other text content", () => {
    expect(needsSaveConfirmation(documentWith(" "))).toBe(true);
    expect(needsSaveConfirmation(documentWith("PlainMint"))).toBe(true);
  });

  it("does not confirm for a clean document", () => {
    expect(needsSaveConfirmation(documentWith("PlainMint", false))).toBe(false);
  });

  it("only requests an exit confirmation for dirty documents with a saved path", () => {
    expect(needsExitSaveConfirmation(documentWith("untitled draft"))).toBe(false);
    expect(needsExitSaveConfirmation({ ...documentWith("saved draft"), filePath: "C:\\draft.txt" })).toBe(true);
  });
});
