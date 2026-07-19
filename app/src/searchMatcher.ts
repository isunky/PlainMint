import type { SearchState } from "./types";

export type SearchMatch = { from: number; to: number };
type SearchOptions = Pick<SearchState, "query" | "replacement" | "caseSensitive" | "wholeWord" | "regexp">;

const wordCharacter = /[\p{L}\p{N}_]/u;

export function findSearchMatches(content: string, search: SearchOptions) {
  const result = findSearchMatchesWithLimit(content, search, Number.POSITIVE_INFINITY);
  return { valid: result.valid, matches: result.matches };
}

export function findSearchMatchesWithLimit(content: string, search: SearchOptions, limit: number) {
  const expression = createExpression(search);
  if (!expression) return { valid: false, matches: [] as SearchMatch[], total: 0 };

  const matches: SearchMatch[] = [];
  let total = 0;
  for (let result = expression.exec(content); result; result = expression.exec(content)) {
    const from = result.index;
    const to = from + result[0].length;
    if (!search.wholeWord || hasWordBoundaries(content, from, to)) {
      total += 1;
      if (matches.length < limit) matches.push({ from, to });
    }
    if (result[0].length === 0) expression.lastIndex += 1;
  }
  return { valid: true, matches, total };
}

function createExpression(search: SearchOptions): RegExp | null {
  try {
    const source = search.regexp ? search.query : escapeRegularExpression(search.query);
    return new RegExp(source, `g${search.caseSensitive ? "" : "i"}`);
  } catch {
    return null;
  }
}

function hasWordBoundaries(content: string, from: number, to: number) {
  return !isWordCharacter(content[from - 1]) && !isWordCharacter(content[to]);
}

function isWordCharacter(character: string | undefined) {
  return Boolean(character && wordCharacter.test(character));
}

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
