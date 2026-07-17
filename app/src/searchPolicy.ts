import { SearchQuery } from "@codemirror/search";
import type { SearchState } from "./types";

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
