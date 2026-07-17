import { describe, expect, it } from "vitest";
import { applyChangesToString, applyTextStats, getTextStats } from "./textStats";
import { createTextChangeSet } from "./textChanges";

describe("incremental text stats", () => {
  it("updates Unicode, byte, and line counts without rebuilding the whole document", () => {
    const before = "alpha\n薄荷🙂";
    const changes = createTextChangeSet(before.length, { from: 6, to: before.length, insert: "Mint\n✓" });
    const result = applyChangesToString(before, changes);

    expect(result.content).toBe("alpha\nMint\n✓");
    expect(applyTextStats(getTextStats(before), result.statsDelta)).toEqual(getTextStats(result.content));
  });

  it("builds an inverse change set suitable for undo", () => {
    const before = "one\ntwo\nthree";
    const changes = createTextChangeSet(before.length, { from: 4, to: 7, insert: "second" });
    const changed = applyChangesToString(before, changes);
    const inverse = createTextChangeSet(changed.content.length, changed.inverseSpecs);

    expect(applyChangesToString(changed.content, inverse).content).toBe(before);
  });

  it("maps inverse positions across multiple changes", () => {
    const before = "one two three";
    const changes = createTextChangeSet(before.length, [
      { from: 0, to: 3, insert: "1" },
      { from: 8, to: 13, insert: "THREE!" },
    ]);
    const changed = applyChangesToString(before, changes);
    const inverse = createTextChangeSet(changed.content.length, changed.inverseSpecs);

    expect(changed.content).toBe("1 two THREE!");
    expect(applyChangesToString(changed.content, inverse).content).toBe(before);
  });
});
