import { describe, expect, it } from "vitest";
import { detectLanguage, effectiveLanguage, isReadyForUntitledLanguageDetection, isSyntaxHighlightable } from "./languageRegistry";

describe("language detection", () => {
  it("uses filename extensions and special shell filenames before content", () => {
    expect(detectLanguage("notes.TSX", "plain text")).toBe("tsx");
    expect(detectLanguage("settings.jsonc", "// comment")).toBe("json");
    expect(detectLanguage(".bashrc", "plain text")).toBe("shell");
    expect(detectLanguage("script.ps1", "plain text")).toBe("powershell");
  });

  it("recognizes only high-confidence extensionless content", () => {
    expect(detectLanguage("Untitled", "#!/usr/bin/env python\nprint('PlainMint')")).toBe("python");
    expect(detectLanguage("Untitled", "{\n  \"name\": \"PlainMint\"\n}")).toBe("json");
    expect(detectLanguage("Untitled", "# Title\n\n- one\n- two")).toBe("markdown");
    expect(detectLanguage("Untitled", "ordinary prose: with punctuation")).toBe("plain");
  });

  it("waits for meaningful untitled content, then detects only once in the caller", () => {
    expect(isReadyForUntitledLanguageDetection("short note")).toBe(false);
    expect(isReadyForUntitledLanguageDetection("# Heading\n\n- item")).toBe(true);
    expect(isReadyForUntitledLanguageDetection("one two three four five six seven eight\nsecond line with enough text")).toBe(true);
  });

  it("keeps manual language selection ahead of automatic detection", () => {
    expect(effectiveLanguage({ languageMode: "rust", detectedLanguage: "plain" })).toBe("rust");
    expect(effectiveLanguage({ languageMode: "auto", detectedLanguage: "rust" })).toBe("rust");
  });

  it("disables parser loading for very large content", () => {
    expect(isSyntaxHighlightable("x".repeat(5 * 1024 * 1024 + 1))).toBe(false);
    expect(isSyntaxHighlightable(Array.from({ length: 50_001 }, () => "x").join("\n"))).toBe(false);
  });
});
