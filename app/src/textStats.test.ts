import { ChangeSet } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { applyChangesToString, applyTextStats, getTextStats } from "./textStats";

describe("incremental text stats", () => {
  it("updates Unicode, byte, and line counts without rebuilding the whole document", () => {
    const before = "alpha\n薄荷🙂";
    const changes = ChangeSet.of({ from: 6, to: before.length, insert: "Mint\n✓" }, before.length);
    const result = applyChangesToString(before, changes);

    expect(result.content).toBe("alpha\nMint\n✓");
    expect(applyTextStats(getTextStats(before), result.statsDelta)).toEqual(getTextStats(result.content));
  });

  it("builds an inverse change set suitable for undo", () => {
    const before = "one\ntwo\nthree";
    const changes = ChangeSet.of({ from: 4, to: 7, insert: "second" }, before.length);
    const changed = applyChangesToString(before, changes);
    const inverse = ChangeSet.of(changed.inverseSpecs, changed.content.length);

    expect(applyChangesToString(changed.content, inverse).content).toBe(before);
  });
});
