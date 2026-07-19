import { findSearchMatchesWithLimit } from "./searchMatcher";
import type { DocumentRecord, EditorTab, PaneId, SearchState } from "./types";

export const OPEN_DOCUMENT_RESULT_LIMIT = 500;

export interface OpenedDocumentSearchMatch {
  from: number;
  to: number;
  line: number;
  preview: string;
}

export interface OpenedDocumentSearchGroup {
  documentId: string;
  matchCount: number;
  matches: OpenedDocumentSearchMatch[];
}

export interface OpenedDocumentSearchResult {
  valid: boolean;
  total: number;
  documentCount: number;
  truncated: boolean;
  groups: OpenedDocumentSearchGroup[];
}

type SearchOptions = Pick<SearchState, "query" | "replacement" | "caseSensitive" | "wholeWord" | "regexp">;

export function openedDocumentIds(tabs: Record<PaneId, EditorTab[]>) {
  const ids = new Set<string>();
  for (const pane of ["left", "right"] as PaneId[]) {
    for (const tab of tabs[pane]) ids.add(tab.documentId);
  }
  return [...ids];
}

export function searchOpenedDocuments(
  documents: Record<string, DocumentRecord>,
  tabs: Record<PaneId, EditorTab[]>,
  search: SearchOptions,
  limit = OPEN_DOCUMENT_RESULT_LIMIT,
): OpenedDocumentSearchResult {
  const groups: OpenedDocumentSearchGroup[] = [];
  let total = 0;
  let stored = 0;
  let documentCount = 0;
  for (const documentId of openedDocumentIds(tabs)) {
    const document = documents[documentId];
    if (!document) continue;
    const result = findSearchMatchesWithLimit(document.content, search, Math.max(0, limit - stored));
    if (!result.valid) return { valid: false, total: 0, documentCount: 0, truncated: false, groups: [] };
    total += result.total;
    if (!result.total) continue;
    documentCount += 1;
    const matches = result.matches.map((match) => ({ ...match, ...matchContext(document.content, match.from, match.to) }));
    stored += matches.length;
    if (matches.length) groups.push({ documentId, matchCount: result.total, matches });
  }
  return { valid: true, total, documentCount, truncated: total > stored, groups };
}

function matchContext(content: string, from: number, to: number) {
  const lineStart = content.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  const lineEndIndex = content.indexOf("\n", to);
  const lineEnd = lineEndIndex === -1 ? content.length : lineEndIndex;
  const rawLine = content.slice(lineStart, lineEnd).replace(/\r$/, "");
  const offset = from - lineStart;
  const line = content.slice(0, from).split("\n").length;
  return { line, preview: trimPreview(rawLine, offset, Math.max(0, to - from)) };
}

function trimPreview(line: string, matchOffset: number, matchLength: number) {
  const maximum = 160;
  if (line.length <= maximum) return line;
  const start = Math.max(0, Math.min(matchOffset - Math.floor(maximum / 3), line.length - maximum));
  const end = Math.min(line.length, Math.max(start + maximum, matchOffset + matchLength));
  return `${start ? "…" : ""}${line.slice(start, end)}${end < line.length ? "…" : ""}`;
}
