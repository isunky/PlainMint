import { describe, expect, it } from "vitest";
import { findSearchMatches } from "./searchPolicy";

const defaults = {
  query: "",
  replacement: "",
  caseSensitive: false,
  wholeWord: false,
  regexp: false,
};

describe("search policy", () => {
  it("finds regular-expression matches and rejects invalid expressions", () => {
    expect(findSearchMatches("item-12 item-34", { ...defaults, query: "item-(\\d+)", regexp: true })).toEqual({
      valid: true,
      matches: [{ from: 0, to: 7 }, { from: 8, to: 15 }],
    });
    expect(findSearchMatches("item", { ...defaults, query: "[", regexp: true })).toEqual({ valid: false, matches: [] });
  });

  it("keeps literal searches literal when regular expressions are disabled", () => {
    expect(findSearchMatches("a.b acb a.b", { ...defaults, query: "a.b" })).toEqual({
      valid: true,
      matches: [{ from: 0, to: 3 }, { from: 8, to: 11 }],
    });
  });
});
