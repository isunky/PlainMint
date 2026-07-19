import { describe, expect, it } from "vitest";
import { createDocumentTemplate, documentTemplates } from "./documentTemplates";

describe("built-in document templates", () => {
  it("provides six unique offline templates", () => {
    expect(documentTemplates).toHaveLength(6);
    expect(new Set(documentTemplates.map((template) => template.id)).size).toBe(6);
    expect(new Set(documentTemplates.map((template) => template.fileName)).size).toBe(6);
  });

  it("creates localized Markdown content with the current date", () => {
    const now = new Date(2026, 6, 19);
    expect(createDocumentTemplate("meeting-notes", "zh-CN", now)).toMatchObject({
      fileName: "meeting-notes.md",
      languageMode: "markdown",
      content: expect.stringContaining("# 会议记录\n\n日期：2026-07-19"),
    });
    expect(createDocumentTemplate("daily-note", "en", now).content).toContain("# Daily note · 2026-07-19");
  });
});
