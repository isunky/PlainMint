import { Text } from "@codemirror/state";
import { SearchQuery } from "@codemirror/search";
import type { SearchState } from "./types";

export type SearchMatch = { from: number; to: number };

export function createSearchQuery(search: Pick<SearchState, "query" | "replacement" | "caseSensitive" | "wholeWord" | "regexp">) {
  return new SearchQuery({
    search: search.query,
    replace: search.replacement,
    caseSensitive: search.caseSensitive,
    wholeWord: search.wholeWord,
    regexp: search.regexp,
    literal: !search.regexp,
  });
}

export function findSearchMatches(content: string, search: Pick<SearchState, "query" | "replacement" | "caseSensitive" | "wholeWord" | "regexp">) {
  const query = createSearchQuery(search);
  if (!query.valid) return { valid: false, matches: [] as SearchMatch[] };

  const cursor = query.getCursor(Text.of(content.split("\n")));
  const matches: SearchMatch[] = [];
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    matches.push({ from: next.value.from, to: next.value.to });
  }
  return { valid: true, matches };
}
