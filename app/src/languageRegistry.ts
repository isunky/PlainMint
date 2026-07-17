import type { LanguageSupport } from "@codemirror/language";
import { LanguageDescription, LanguageSupport as CodeMirrorLanguageSupport, StreamLanguage } from "@codemirror/language";
import type { DocumentRecord, LanguageId } from "./types";

export const MAX_SYNTAX_HIGHLIGHT_BYTES = 5 * 1024 * 1024;
export const MAX_SYNTAX_HIGHLIGHT_LINES = 50_000;
const MAX_CONTENT_SNIFF_LENGTH = 16 * 1024;

type LanguageDefinition = {
  id: Exclude<LanguageId, "plain">;
  name: string;
  aliases?: readonly string[];
  extensions?: readonly string[];
  filename?: RegExp;
  load: () => Promise<LanguageSupport>;
};

export const languageOptionIds: LanguageId[] = [
  "plain", "markdown", "json", "yaml", "xml", "html", "css", "scss", "less",
  "javascript", "jsx", "typescript", "tsx", "python", "sql", "shell", "powershell",
  "cpp", "csharp", "java", "go", "rust", "php",
];

const definitions: LanguageDefinition[] = [
  {
    id: "markdown", name: "Markdown", aliases: ["md"], extensions: ["md", "markdown", "mdx"],
    load: async () => (await import("@codemirror/lang-markdown")).markdown({ codeLanguages: languageDescriptions }),
  },
  {
    id: "json", name: "JSON", aliases: ["jsonc"], extensions: ["json", "jsonc", "geojson"],
    load: async () => (await import("@codemirror/lang-json")).json(),
  },
  {
    id: "yaml", name: "YAML", aliases: ["yml"], extensions: ["yaml", "yml"],
    load: async () => (await import("@codemirror/lang-yaml")).yaml(),
  },
  {
    id: "xml", name: "XML", extensions: ["xml", "svg", "xsl", "xslt"],
    load: async () => (await import("@codemirror/lang-xml")).xml(),
  },
  {
    id: "html", name: "HTML", aliases: ["htm"], extensions: ["html", "htm"],
    load: async () => (await import("@codemirror/lang-html")).html(),
  },
  {
    id: "css", name: "CSS", extensions: ["css"],
    load: async () => (await import("@codemirror/lang-css")).css(),
  },
  {
    id: "scss", name: "SCSS", extensions: ["scss", "sass"],
    load: async () => (await import("@codemirror/lang-sass")).sass({ indented: false }),
  },
  {
    id: "less", name: "Less", extensions: ["less"],
    load: async () => (await import("@codemirror/lang-less")).less(),
  },
  {
    id: "javascript", name: "JavaScript", aliases: ["js", "node"], extensions: ["js", "mjs", "cjs"],
    load: async () => (await import("@codemirror/lang-javascript")).javascript(),
  },
  {
    id: "jsx", name: "JSX", extensions: ["jsx"],
    load: async () => (await import("@codemirror/lang-javascript")).javascript({ jsx: true }),
  },
  {
    id: "typescript", name: "TypeScript", aliases: ["ts"], extensions: ["ts", "mts", "cts"],
    load: async () => (await import("@codemirror/lang-javascript")).javascript({ typescript: true }),
  },
  {
    id: "tsx", name: "TSX", extensions: ["tsx"],
    load: async () => (await import("@codemirror/lang-javascript")).javascript({ jsx: true, typescript: true }),
  },
  {
    id: "python", name: "Python", aliases: ["py"], extensions: ["py", "pyw"],
    load: async () => (await import("@codemirror/lang-python")).python(),
  },
  {
    id: "sql", name: "SQL", extensions: ["sql", "pgsql", "plsql"],
    load: async () => (await import("@codemirror/lang-sql")).sql(),
  },
  {
    id: "shell", name: "Shell", aliases: ["bash", "sh", "zsh"], extensions: ["sh", "bash", "zsh", "fish"], filename: /(^|\/|\\)(\.bashrc|\.zshrc|\.profile|bashrc|zshrc)$/i,
    load: async () => {
      const { shell } = await import("@codemirror/legacy-modes/mode/shell");
      return new CodeMirrorLanguageSupport(StreamLanguage.define(shell));
    },
  },
  {
    id: "powershell", name: "PowerShell", aliases: ["pwsh", "ps"], extensions: ["ps1", "psm1", "psd1"],
    load: async () => {
      const { powerShell } = await import("@codemirror/legacy-modes/mode/powershell");
      return new CodeMirrorLanguageSupport(StreamLanguage.define(powerShell));
    },
  },
  {
    id: "cpp", name: "C / C++", aliases: ["c", "cpp", "c++"], extensions: ["c", "h", "cc", "cp", "cpp", "cxx", "hpp", "hh", "hxx"],
    load: async () => (await import("@codemirror/lang-cpp")).cpp(),
  },
  {
    id: "csharp", name: "C#", aliases: ["csharp", "cs"], extensions: ["cs", "csx"],
    load: async () => {
      const { csharp } = await import("@codemirror/legacy-modes/mode/clike");
      return new CodeMirrorLanguageSupport(StreamLanguage.define(csharp));
    },
  },
  {
    id: "java", name: "Java", extensions: ["java"],
    load: async () => (await import("@codemirror/lang-java")).java(),
  },
  {
    id: "go", name: "Go", extensions: ["go"],
    load: async () => (await import("@codemirror/lang-go")).go(),
  },
  {
    id: "rust", name: "Rust", aliases: ["rs"], extensions: ["rs"],
    load: async () => (await import("@codemirror/lang-rust")).rust(),
  },
  {
    id: "php", name: "PHP", extensions: ["php", "phtml"],
    load: async () => (await import("@codemirror/lang-php")).php(),
  },
];

const descriptionsById = new Map<LanguageId, LanguageDescription>();
export const languageDescriptions = definitions.map((definition) => {
  const description = LanguageDescription.of(definition);
  descriptionsById.set(definition.id, description);
  return description;
});

const descriptionIds = new Map(languageDescriptions.map((description, index) => [description, definitions[index].id]));
const loadedLanguages = new Map<LanguageId, Promise<LanguageSupport>>();

export function loadLanguage(id: LanguageId): Promise<LanguageSupport | null> {
  if (id === "plain") return Promise.resolve(null);
  const cached = loadedLanguages.get(id);
  if (cached) return cached;
  const description = descriptionsById.get(id);
  if (!description) return Promise.resolve(null);
  const load = description.load();
  loadedLanguages.set(id, load);
  return load;
}

export function languageLabelKey(id: LanguageId) {
  return `syntaxLanguage_${id}`;
}

export function effectiveLanguage(document: Pick<DocumentRecord, "languageMode" | "detectedLanguage">): LanguageId {
  return document.languageMode === "auto" ? document.detectedLanguage : document.languageMode;
}

export function isTextLanguage(id: LanguageId) {
  return id === "plain" || id === "markdown";
}

export function isSyntaxHighlightable(content: string) {
  return new TextEncoder().encode(content).byteLength <= MAX_SYNTAX_HIGHLIGHT_BYTES
    && content.split("\n").length <= MAX_SYNTAX_HIGHLIGHT_LINES;
}

export function isReadyForUntitledLanguageDetection(content: string) {
  const trimmed = content.trim();
  return hasHighConfidenceContentSignature(trimmed)
    || (trimmed.replace(/\s/g, "").length >= 32 && trimmed.split(/\r?\n/).filter(Boolean).length >= 2);
}

export function detectLanguage(fileName: string, content: string): LanguageId {
  const filenameMatch = LanguageDescription.matchFilename(languageDescriptions, fileName.toLocaleLowerCase("en-US"));
  if (filenameMatch) return descriptionIds.get(filenameMatch) ?? "plain";
  return detectLanguageFromContent(content);
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
