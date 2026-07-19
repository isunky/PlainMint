import type { DocumentRecord } from "./types";

export function needsSaveConfirmation(document: DocumentRecord) {
  return document.dirty && document.content.length > 0;
}

/** Closing an app can retain untitled drafts in the workspace session. */
export function needsExitSaveConfirmation(document: DocumentRecord) {
  return Boolean(document.filePath) && needsSaveConfirmation(document);
}
