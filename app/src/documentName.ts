import type { DocumentRecord } from "./types";

type UntitledDocument = Pick<DocumentRecord, "fileName" | "filePath" | "untitledNumber">;

export function isUntitledDocument(document: UntitledDocument) {
  return !document.filePath && Number.isInteger(document.untitledNumber) && (document.untitledNumber ?? 0) > 0;
}

export function untitledDocumentFileName(number: number) {
  return `Untitled ${number}`;
}

export function untitledSaveFileName(number: number) {
  return `untitled-${number}.txt`;
}

export function displayDocumentName(document: UntitledDocument, formatUntitled: (number: number) => string) {
  return isUntitledDocument(document) ? formatUntitled(document.untitledNumber!) : document.fileName;
}
