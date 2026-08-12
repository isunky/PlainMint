import { describe, expect, it } from "vitest";
import { buildTextCleanupChanges } from "./textCleanup";

function apply(content: string, action: Parameters<typeof buildTextCleanupChanges>[2], selections: Array<{ from: number; to: number }> = []) {
  return buildTextCleanupChanges(content, selections, action, "en").reduceRight((result, change) => (
    result.slice(0, change.from) + change.insert + result.slice(change.to)
  ), content);
}

describe("text cleanup", () => {
  it("uses stable natural sorting in both directions across the whole document when nothing is selected", () => {
    expect(apply("item-10\nitem-2\nAlpha\nalpha", "sortAscending")).toBe("Alpha\nalpha\nitem-2\nitem-10");
    expect(apply("item-10\nitem-2\nAlpha\nalpha", "sortDescending")).toBe("item-10\nitem-2\nAlpha\nalpha");
  });

  it("keeps exact duplicates, whitespace rules, and the final newline boundary", () => {
    expect(apply("a\nA\na\n a\n\t\n", "deduplicate")).toBe("a\nA\n a\n\t\n");
    expect(apply("a\n \n\t\n\u00a0\n", "removeBlankLines")).toBe("a\n\u00a0\n");
    expect(apply(" a \t\n\u00a0 \t", "trimTrailingWhitespace")).toBe(" a\n\u00a0");
  });

  it("changes only the exact selected characters without expanding to whole lines", () => {
    expect(apply("Xc\nbY", "sortAscending", [{ from: 1, to: 4 }])).toBe("Xb\ncY");
    expect(apply("AA  \nBB  \nCC  ", "trimTrailingWhitespace", [{ from: 5, to: 9 }])).toBe("AA  \nBB\nCC  ");
    expect(apply("a\n\nb", "removeBlankLines", [{ from: 2, to: 3 }])).toBe("a\nb");
  });

  it("processes multiple selections independently", () => {
    expect(apply("c\nb--z\ny", "sortAscending", [{ from: 0, to: 3 }, { from: 5, to: 8 }])).toBe("b\nc--y\nz");
  });

  it("does not produce a change when cleanup has no visible effect", () => {
    expect(buildTextCleanupChanges("a\nb", [], "trimTrailingWhitespace", "en")).toEqual([]);
  });
});
