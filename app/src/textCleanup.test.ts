import { describe, expect, it } from "vitest";
import { buildTextCleanupChanges } from "./textCleanup";

function apply(content: string, action: Parameters<typeof buildTextCleanupChanges>[2], selections: Array<{ from: number; to: number }> = []) {
  return buildTextCleanupChanges(content, selections, action, "en").reduceRight((result, change) => (
    result.slice(0, change.from) + change.insert + result.slice(change.to)
  ), content);
}

describe("text cleanup", () => {
  it("uses stable natural sorting in both directions", () => {
    expect(apply("item-10\nitem-2\nAlpha\nalpha", "sortAscending")).toBe("Alpha\nalpha\nitem-2\nitem-10");
    expect(apply("item-10\nitem-2\nAlpha\nalpha", "sortDescending")).toBe("item-10\nitem-2\nAlpha\nalpha");
  });

  it("keeps exact duplicates, whitespace rules, and the final newline boundary", () => {
    expect(apply("a\nA\na\n a\n\t\n", "deduplicate")).toBe("a\nA\n a\n\t\n");
    expect(apply("a\n \n\t\n\u00a0\n", "removeBlankLines")).toBe("a\n\u00a0\n");
    expect(apply(" a \t\n\u00a0 \t", "trimTrailingWhitespace")).toBe(" a\n\u00a0");
  });

  it("expands selections to whole lines, excludes a next-line boundary, and merges adjacent blocks", () => {
    expect(apply("c\nb\na\nd", "sortAscending", [{ from: 0, to: 2 }])).toBe("c\nb\na\nd");
    expect(apply("c\nb\na\nd", "sortAscending", [{ from: 0, to: 1 }, { from: 2, to: 3 }])).toBe("b\nc\na\nd");
  });

  it("does not produce a change when cleanup has no visible effect", () => {
    expect(buildTextCleanupChanges("a\nb", [], "trimTrailingWhitespace", "en")).toEqual([]);
  });
});
