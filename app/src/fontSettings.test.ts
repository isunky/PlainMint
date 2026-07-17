import { describe, expect, it } from "vitest";
import { buildEditorFontFamily } from "./fontSettings";

describe("editor font stacks", () => {
  it("uses platform-aware defaults for Latin and CJK characters", () => {
    const stack = buildEditorFontFamily("system-monospace", "system-cjk");

    expect(stack).toContain('"Cascadia Mono"');
    expect(stack).toContain('"SF Mono"');
    expect(stack).toContain('"Microsoft YaHei"');
    expect(stack).toContain('"PingFang SC"');
  });

  it("keeps selected font names safely quoted", () => {
    expect(buildEditorFontFamily("JetBrains Mono", "Source Han Sans SC")).toBe('"JetBrains Mono", "Source Han Sans SC", monospace');
  });
});
