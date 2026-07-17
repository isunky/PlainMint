import type { DocumentRecord, LanguageId } from "./types";
import type { TextStats } from "./textStats";

export const MAX_SYNTAX_HIGHLIGHT_BYTES = 5 * 1024 * 1024;
export const MAX_SYNTAX_HIGHLIGHT_LINES = 50_000;
const MAX_CONTENT_SNIFF_LENGTH = 16 * 1024;

export type LanguageDefinition = {
  id: Exclude<LanguageId, "plain">;
  name: string;
  aliases?: readonly string[];
  extensions?: readonly string[];
  filename?: RegExp;
};

export const languageOptionIds: LanguageId[] = [
  "plain", "markdown", "json", "yaml", "xml", "html", "css", "scss", "less",
  "javascript", "jsx", "typescript", "tsx", "python", "sql", "shell", "powershell",
  "cpp", "csharp", "java", "go", "rust", "php",
];

export const languageDefinitions: readonly LanguageDefinition[] = [
  { id: "markdown", name: "Markdown", aliases: ["md"], extensions: ["md", "markdown", "mdx"] },
  { id: "json", name: "JSON", aliases: ["jsonc"], extensions: ["json", "jsonc", "geojson"] },
  { id: "yaml", name: "YAML", aliases: ["yml"], extensions: ["yaml", "yml"] },
  { id: "xml", name: "XML", extensions: ["xml", "svg", "xsl", "xslt"] },
  { id: "html", name: "HTML", aliases: ["htm"], extensions: ["html", "htm"] },
  { id: "css", name: "CSS", extensions: ["css"] },
  { id: "scss", name: "SCSS", extensions: ["scss", "sass"] },
  { id: "less", name: "Less", extensions: ["less"] },
  { id: "javascript", name: "JavaScript", aliases: ["js", "node"], extensions: ["js", "mjs", "cjs"] },
  { id: "jsx", name: "JSX", extensions: ["jsx"] },
  { id: "typescript", name: "TypeScript", aliases: ["ts"], extensions: ["ts", "mts", "cts"] },
  { id: "tsx", name: "TSX", extensions: ["tsx"] },
  { id: "python", name: "Python", aliases: ["py"], extensions: ["py", "pyw"] },
  { id: "sql", name: "SQL", extensions: ["sql", "pgsql", "plsql"] },
  { id: "shell", name: "Shell", aliases: ["bash", "sh", "zsh"], extensions: ["sh", "bash", "zsh", "fish"], filename: /(^|\/|\\)(\.bashrc|\.zshrc|\.profile|bashrc|zshrc)$/i },
  { id: "powershell", name: "PowerShell", aliases: ["pwsh", "ps"], extensions: ["ps1", "psm1", "psd1"] },
  { id: "cpp", name: "C / C++", aliases: ["c", "cpp", "c++"], extensions: ["c", "h", "cc", "cp", "cpp", "cxx", "hpp", "hh", "hxx"] },
  { id: "csharp", name: "C#", aliases: ["csharp", "cs"], extensions: ["cs", "csx"] },
  { id: "java", name: "Java", extensions: ["java"] },
  { id: "go", name: "Go", extensions: ["go"] },
  { id: "rust", name: "Rust", aliases: ["rs"], extensions: ["rs"] },
  { id: "php", name: "PHP", extensions: ["php", "phtml"] },
];

export function languageLabelKey(id: LanguageId) {
  return `syntaxLanguage_${id}`;
}

export function effectiveLanguage(document: Pick<DocumentRecord, "languageMode" | "detectedLanguage">): LanguageId {
  return document.languageMode === "auto" ? document.detectedLanguage : document.languageMode;
}

export function isTextLanguage(id: LanguageId) {
  return id === "plain" || id === "markdown";
}

export function isSyntaxHighlightableStats(stats: Pick<TextStats, "utf8Bytes" | "lines">) {
  return stats.utf8Bytes <= MAX_SYNTAX_HIGHLIGHT_BYTES && stats.lines <= MAX_SYNTAX_HIGHLIGHT_LINES;
}

export function isSyntaxHighlightable(content: string) {
  return isSyntaxHighlightableStats({
    utf8Bytes: new TextEncoder().encode(content).byteLength,
    lines: content.length === 0 ? 1 : content.split("\n").length,
  });
}

export function isReadyForUntitledLanguageDetection(content: string) {
  const trimmed = content.trim();
  return hasHighConfidenceContentSignature(trimmed)
    || (trimmed.replace(/\s/g, "").length >= 32 && trimmed.split(/\r?\n/).filter(Boolean).length >= 2);
}

export function detectLanguage(fileName: string, content: string): LanguageId {
  const normalized = fileName.replace(/\\/g, "/").toLocaleLowerCase("en-US");
  const basename = normalized.split("/").at(-1) ?? normalized;
  const filenameMatch = languageDefinitions.find((definition) =>
    Boolean(definition.filename?.test(normalized)) || definition.extensions?.some((extension) => basename.endsWith(`.${extension}`)),
  );
  return filenameMatch?.id ?? detectLanguageFromContent(content);
}

function detectLanguageFromContent(content: string): LanguageId {
  const sample = content.slice(0, MAX_CONTENT_SNIFF_LENGTH).trimStart();
  if (!sample) return "plain";
  const shebang = sample.split(/\r?\n/, 1)[0].toLowerCase();
  if (/^#!.*(?:\benv\s+)?python(?:\d+(?:\.\d+)?)?\b/.test(shebang)) return "python";
  if (/^#!.*(?:\benv\s+)?(?:node|deno|bun)\b/.test(shebang)) return "javascript";
  if (/^#!.*(?:\benv\s+)?(?:pwsh|powershell)\b/.test(shebang)) return "powershell";
  if (/^#!.*(?:\benv\s+)?(?:bash|zsh|fish|sh)\b/.test(shebang)) return "shell";
  if (/^<\?php\b/i.test(sample)) return "php";
  if (/^<!doctype\s+html\b/i.test(sample) || /^<html\b/i.test(sample)) return "html";
  if (/^<\?xml\b/i.test(sample) || /^<([\w:-]+)(?:\s|>)/.test(sample)) return "xml";
  if (content.length <= MAX_CONTENT_SNIFF_LENGTH && /^[{[]/.test(sample)) {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object") return "json";
    } catch {
      // JSON-like content should remain plain unless it is valid JSON.
    }
  }
  if (/^(?:select|insert\s+into|update\s+\w+\s+set|delete\s+from|create\s+(?:table|index|view)|alter\s+table)\b/i.test(sample)
    && /\b(?:from|where|values|set|table|into)\b/i.test(sample)) return "sql";
  if (/^---\s*(?:\r?\n|$)/.test(sample) && /^[\w.-]+\s*:/m.test(sample)) return "yaml";
  if (/(^|\n)#{1,6}\s+\S/.test(sample) && (/(^|\n)(?:[-*+]\s+|```|>\s+)/.test(sample) || /\[[^\]]+\]\([^)]+\)/.test(sample))) return "markdown";
  return "plain";
}

function hasHighConfidenceContentSignature(content: string) {
  if (!content) return false;
  if (/^#!/.test(content) || /^<\?php\b/i.test(content) || /^<!doctype\s+html\b/i.test(content) || /^<\?xml\b/i.test(content)) return true;
  if (/^(?:select|insert\s+into|update\s+\w+\s+set|delete\s+from|create\s+(?:table|index|view)|alter\s+table)\b/i.test(content)) return true;
  if (/^---\s*(?:\r?\n|$)/.test(content) || /(^|\n)#{1,6}\s+\S/.test(content) && /(^|\n)(?:[-*+]\s+|```|>\s+)/.test(content)) return true;
  if (/^[{[]/.test(content)) {
    try {
      const parsed = JSON.parse(content);
      return Boolean(parsed && typeof parsed === "object");
    } catch {
      return false;
    }
  }
  return false;
}
