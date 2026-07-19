import { describe, expect, it } from "vitest";
import { createDocumentTemplate, documentTemplates, isSafeSuggestedFileName } from "./documentTemplates";

describe("built-in document templates", () => {
  it("provides six unique offline templates", () => {
    expect(documentTemplates).toHaveLength(6);
    expect(new Set(documentTemplates.map((template) => template.id)).size).toBe(6);
    expect(new Set(documentTemplates.map((template) => template.fileName)).size).toBe(6);
  });

  it("creates localized plain-text content with the current date", () => {
    const now = new Date(2026, 6, 19);
    const meetingNotes = documentTemplates.find((template) => template.kind === "builtin" && template.builtInId === "meeting-notes");
    const dailyNote = documentTemplates.find((template) => template.kind === "builtin" && template.builtInId === "daily-note");
    expect(meetingNotes).toBeDefined();
    expect(dailyNote).toBeDefined();
    expect(createDocumentTemplate(meetingNotes!, "zh-CN", now)).toMatchObject({
      fileName: "meeting-notes.txt",
      languageMode: "plain",
      content: expect.stringContaining("会议记录\n========\n\n日期：2026-07-19"),
    });
    expect(createDocumentTemplate(dailyNote!, "en", now).content).toContain("DAILY NOTE — 2026-07-19");
  });

  it("renders custom plain-text templates and validates suggested file names", () => {
    const template = { id: "weekly.pmtpl", kind: "custom" as const, name: "Weekly review", fileName: "weekly.txt", content: "DATE {{date}}\n" };
    expect(createDocumentTemplate(template, "en", new Date(2026, 6, 19))).toMatchObject({
      fileName: "weekly.txt",
      languageMode: "plain",
      content: "DATE 2026-07-19\n",
    });
    expect(isSafeSuggestedFileName("notes.txt")).toBe(true);
    expect(isSafeSuggestedFileName("nested/notes.txt")).toBe(false);
  });
});
