import { describe, expect, it } from "vitest";
import { resources } from "./i18n";

describe("translations", () => {
  it("keeps English and Simplified Chinese keys in parity", () => {
    const english = Object.keys(resources.en.translation).sort();
    const chinese = Object.keys(resources["zh-CN"].translation).sort();
    expect(chinese).toEqual(english);
  });

  it("ships both required languages", () => {
    expect(resources.en.translation.appName).toBe("PlainMint");
    expect(resources["zh-CN"].translation.appName).toBe("PlainMint");
  });
});
