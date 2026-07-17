import { describe, expect, it } from "vitest";
import { displayDocumentName, isUntitledDocument, untitledDocumentFileName, untitledSaveFileName } from "./documentName";

describe("untitled document names", () => {
  it("formats numbered untitled documents without changing saved file names", () => {
    const untitled = { fileName: "Untitled 2", untitledNumber: 2 };
    const saved = { fileName: "notes.txt", filePath: "C:\\Notes\\notes.txt", untitledNumber: 2 };

    expect(isUntitledDocument(untitled)).toBe(true);
    expect(displayDocumentName(untitled, (number) => `未命名 ${number}`)).toBe("未命名 2");
    expect(isUntitledDocument(saved)).toBe(false);
    expect(displayDocumentName(saved, (number) => `未命名 ${number}`)).toBe("notes.txt");
    expect(untitledDocumentFileName(2)).toBe("Untitled 2");
    expect(untitledSaveFileName(2)).toBe("untitled-2.txt");
  });
});
