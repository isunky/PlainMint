import type { DocumentRecord, FileFingerprint } from "./types";

export type Clock = Record<string, number>;
export type DraftBody = Pick<DocumentRecord, "content" | "encoding" | "lineEnding" | "fileName"> & {
  fingerprint?: FileFingerprint;
};
export type CloudDraft = { id: string; clock: Clock; path?: string; body: DraftBody };
export type Resolution = Pick<CloudDraft, "id" | "clock">;
export type Snapshot = { version: 1; files: string[]; drafts: CloudDraft[]; resolved: Resolution[] };
export type Journal = {
  version: 1;
  entries: Record<string, CloudDraft>;
  revisions: Record<string, number>;
  resolved: Resolution[];
  dismissed: string[];
  files: string[];
  pending: boolean;
  sequence: number;
};

export const emptyJournal = (): Journal => ({
  version: 1, entries: {}, revisions: {}, resolved: [], dismissed: [], files: [], pending: false, sequence: 0,
});

export function scopeKey(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(normalized + "/") || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized;
}

export function relativeCloudPath(root: string, path: string) {
  const prefix = scopeKey(root) + "/";
  if (!scopeKey(path).startsWith(prefix)) return undefined;
  const relative = path.replace(/\\/g, "/").slice(prefix.length);
  return validRelative(relative) ? relative : undefined;
}

export function dominates(left: Clock, right: Clock) {
  return Object.entries(right).every(([device, revision]) => (left[device] ?? 0) >= revision);
}

export function sameClock(left: Clock, right: Clock) {
  return dominates(left, right) && dominates(right, left);
}

export function recordResolution(list: Resolution[], resolved: Resolution) {
  if (list.some((item) => item.id === resolved.id && dominates(item.clock, resolved.clock))) return list;
  return [...list.filter((item) => item.id !== resolved.id || !dominates(resolved.clock, item.clock)), resolved];
}

export function incomingDrafts(snapshots: Snapshot[], localResolutions: Resolution[]) {
  const resolved = [...localResolutions, ...snapshots.flatMap((snapshot) => snapshot.resolved)];
  const drafts = snapshots.flatMap((snapshot) => snapshot.drafts);
  return drafts.filter((draft, index) =>
    !resolved.some((item) => item.id === draft.id && dominates(item.clock, draft.clock))
    && !drafts.some((other, otherIndex) => other.id === draft.id
      && otherIndex !== index && dominates(other.clock, draft.clock)
      && (otherIndex < index || !sameClock(other.clock, draft.clock))));
}

export function draftBody(document: DocumentRecord): DraftBody {
  return {
    content: document.content, fileName: document.fileName,
    encoding: document.encoding, lineEnding: document.lineEnding,
    ...(document.fingerprint && { fingerprint: document.fingerprint }),
  };
}

export function sameBody(left: DraftBody, right: DraftBody) {
  return left.content === right.content && left.fileName === right.fileName
    && left.encoding === right.encoding && left.lineEnding === right.lineEnding
    && left.fingerprint?.hash === right.fingerprint?.hash;
}

const validRelative = (value: unknown): value is string =>
  typeof value === "string" && !/[\\:\0]/.test(value)
  && value.split("/").every((part) => part && part !== "." && part !== "..")
  && value.split("/")[0].toLowerCase() !== "plainmint workspace";

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const validClock = (value: unknown) => object(value) && Object.keys(value).length > 0
  && Object.entries(value).every(([device, revision]) =>
    /^[a-f0-9-]{36}$/i.test(device) && Number.isSafeInteger(revision) && Number(revision) > 0);
const validResolution = (value: unknown): value is Resolution => object(value)
  && typeof value.id === "string" && value.id.length > 0 && validClock(value.clock);
const validFingerprint = (value: unknown) => object(value) && typeof value.hash === "string"
  && Number.isSafeInteger(value.modifiedAt) && Number.isSafeInteger(value.size);
const validDraft = (value: unknown): value is CloudDraft => {
  if (!object(value) || !validResolution(value)) return false;
  const draft = value as Record<string, unknown>;
  const body = draft.body;
  return (draft.path === undefined || validRelative(draft.path)) && object(body)
    && typeof body.content === "string" && typeof body.fileName === "string"
    && ["utf-8", "utf-8-bom", "utf-16le", "utf-16be"].includes(String(body.encoding))
    && ["lf", "crlf", "cr"].includes(String(body.lineEnding))
    && (body.fingerprint === undefined || validFingerprint(body.fingerprint));
};

export function isSnapshot(value: unknown): value is Snapshot {
  return object(value) && value.version === 1
    && Array.isArray(value.files) && value.files.every(validRelative)
    && Array.isArray(value.drafts) && value.drafts.every(validDraft)
    && Array.isArray(value.resolved) && value.resolved.every(validResolution);
}

export function isJournal(value: unknown): value is Journal {
  return object(value) && value.version === 1 && typeof value.pending === "boolean"
    && Number.isSafeInteger(value.sequence) && Number(value.sequence) >= 0
    && object(value.entries) && Object.values(value.entries).every(validDraft)
    && object(value.revisions) && Object.values(value.revisions).every((revision) => Number.isSafeInteger(revision) && Number(revision) >= 0)
    && Array.isArray(value.files) && value.files.every(validRelative)
    && Array.isArray(value.resolved) && value.resolved.every(validResolution)
    && Array.isArray(value.dismissed) && value.dismissed.every(validRelative);
}
