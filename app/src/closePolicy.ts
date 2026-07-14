import type { DocumentRecord } from "./types";

export function needsSaveConfirmation(document: DocumentRecord) {
  return document.dirty && document.content.length > 0;
}
