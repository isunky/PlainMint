import { describe, expect, it } from "vitest";
import { findSearchMatches, findSearchMatchesWithLimit } from "./searchMatcher";

const defaults = {
  query: "",
  replacement: "",
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
};

describe("search matcher", () => {
  it("respects case sensitivity and whole-word matching", () => {
    expect(findSearchMatches("Cat cat catalog", { ...defaults, query: "cat" }).matches).toHaveLength(3);
    expect(findSearchMatches("Cat cat catalog", { ...defaults, query: "cat", wholeWord: true }).matches).toHaveLength(2);
    expect(findSearchMatches("Cat cat catalog", { ...defaults, query: "cat", wholeWord: true, caseSensitive: true }).matches).toEqual([{ from: 4, to: 7 }]);
  });

  it("does not loop forever on zero-length regular-expression matches", () => {
    expect(findSearchMatches("ab", { ...defaults, query: "(?=.)", regexp: true })).toEqual({
      valid: true,
      matches: [{ from: 0, to: 0 }, { from: 1, to: 1 }],
    });
  });

  it("keeps an exact count when only a limited number of matches are retained", () => {
    expect(findSearchMatchesWithLimit("cat cat cat", { ...defaults, query: "cat" }, 2)).toEqual({
      valid: true,
      total: 3,
      matches: [{ from: 0, to: 3 }, { from: 4, to: 7 }],
    });
  });
});
