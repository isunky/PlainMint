import { describe, expect, it } from "vitest";
import { OPEN_DOCUMENT_RESULT_LIMIT, searchOpenedDocuments } from "./openedDocumentSearch";
import type { DocumentRecord, EditorTab } from "./types";

const search = { query: "cat", replacement: "", caseSensitive: false, wholeWord: false, regexp: false };

function document(id: string, content: string): DocumentRecord {
  return {
    id,
    filePath: `C:\\${id}.txt`,
    fileName: `${id}.txt`,
    content,
    encoding: "utf-8",
    lineEnding: "lf",
    languageMode: "auto",
    detectedLanguage: "plain",
    autoLanguageDetectionComplete: true,
    dirty: id === "draft",
    readOnly: false,
    missing: false,
    externalModified: false,
    revision: 0,
    createdAt: 1,
  };
}

function tab(id: string, documentId: string, pane: "left" | "right"): EditorTab {
  return { id, documentId, pane, order: 0 };
}

describe("opened document search", () => {
  it("uses left then right tab order, de-duplicates split documents, and searches unsaved content", () => {
    const result = searchOpenedDocuments(
      { a: document("a", "cat"), draft: document("draft", "CAT cat"), b: document("b", "no match") },
      { left: [tab("left-a", "a", "left"), tab("left-draft", "draft", "left")], right: [tab("right-a", "a", "right"), tab("right-b", "b", "right")] },
      search,
    );

    expect(result.total).toBe(3);
    expect(result.documentCount).toBe(2);
    expect(result.groups.map((group) => group.documentId)).toEqual(["a", "draft"]);
    expect(result.groups[1].matches[0]).toMatchObject({ line: 1, preview: "CAT cat" });
  });

  it("shares search options, rejects invalid regular expressions, and caps rendered results", () => {
    const documents = { a: document("a", "cat ".repeat(OPEN_DOCUMENT_RESULT_LIMIT + 2)) };
    const tabs = { left: [tab("left-a", "a", "left")], right: [] };
    const capped = searchOpenedDocuments(documents, tabs, search);
    expect(capped).toMatchObject({ valid: true, total: OPEN_DOCUMENT_RESULT_LIMIT + 2, truncated: true });
    expect(capped.groups[0].matches).toHaveLength(OPEN_DOCUMENT_RESULT_LIMIT);
    expect(searchOpenedDocuments(documents, tabs, { ...search, query: "[", regexp: true })).toEqual({
      valid: false,
      total: 0,
      documentCount: 0,
      truncated: false,
      groups: [],
    });
    expect(searchOpenedDocuments({ a: document("a", "Cat cat catalog") }, tabs, { ...search, wholeWord: true, caseSensitive: true }).total).toBe(1);
  });

  it("creates line previews with surrounding context", () => {
    const result = searchOpenedDocuments(
      { a: document("a", "first line\nsecond cat line\nthird") },
      { left: [tab("left-a", "a", "left")], right: [] },
      search,
    );
    expect(result.groups[0].matches[0]).toMatchObject({ line: 2, preview: "second cat line" });
  });
});
