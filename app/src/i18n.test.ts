import { describe, expect, it } from "vitest";
import i18n, { resources } from "./i18n";

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

  it("switches languages while preserving interpolation and plural forms", async () => {
    const previousLanguage = i18n.language;
    try {
      await i18n.changeLanguage("en");
      expect(document.documentElement.lang).toBe("en");
      expect(i18n.t("untitledNumbered", { number: 3 })).toBe("Untitled 3");
      expect(i18n.t("templateIssues", { count: 1 })).toBe("1 template file needs attention in the templates folder.");
      expect(i18n.t("templateIssues", { count: 2 })).toBe("2 template files need attention in the templates folder.");

      await i18n.changeLanguage("zh-CN");
      expect(document.documentElement.lang).toBe("zh-CN");
      expect(i18n.t("untitledNumbered", { number: 3 })).toBe("未命名 3");
      expect(i18n.t("templateIssues", { count: 2 })).toBe("模板文件夹中有 2 个模板需要处理。");
    } finally {
      await i18n.changeLanguage(previousLanguage);
    }
  });
});
