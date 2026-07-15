import type { DocumentRecord } from "./types";

export function isAutoSaveEligible(document: DocumentRecord | undefined): document is DocumentRecord {
  return Boolean(
    document
      && document.dirty
      && document.filePath
      && !document.readOnly
      && !document.missing
      && !document.externalModified,
  );
}

export function isAutoSaveRevisionSuppressed(document: DocumentRecord, failedRevision?: number) {
  return failedRevision === document.revision;
}
