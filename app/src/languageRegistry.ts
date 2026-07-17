import type { LanguageSupport } from "@codemirror/language";
import { LanguageDescription, LanguageSupport as CodeMirrorLanguageSupport, StreamLanguage } from "@codemirror/language";
import { languageDefinitions } from "./languageMetadata";
import type { LanguageId } from "./types";

export * from "./languageMetadata";

type LanguageLoader = () => Promise<LanguageSupport>;

const languageDescriptions: LanguageDescription[] = [];

const languageLoaders: Record<Exclude<LanguageId, "plain">, LanguageLoader> = {
  markdown: async () => (await import("@codemirror/lang-markdown")).markdown({ codeLanguages: languageDescriptions }),
  json: async () => (await import("@codemirror/lang-json")).json(),
  yaml: async () => (await import("@codemirror/lang-yaml")).yaml(),
  xml: async () => (await import("@codemirror/lang-xml")).xml(),
  html: async () => (await import("@codemirror/lang-html")).html(),
  css: async () => (await import("@codemirror/lang-css")).css(),
  scss: async () => (await import("@codemirror/lang-sass")).sass({ indented: false }),
  less: async () => (await import("@codemirror/lang-less")).less(),
  javascript: async () => (await import("@codemirror/lang-javascript")).javascript(),
  jsx: async () => (await import("@codemirror/lang-javascript")).javascript({ jsx: true }),
  typescript: async () => (await import("@codemirror/lang-javascript")).javascript({ typescript: true }),
  tsx: async () => (await import("@codemirror/lang-javascript")).javascript({ jsx: true, typescript: true }),
  python: async () => (await import("@codemirror/lang-python")).python(),
  sql: async () => (await import("@codemirror/lang-sql")).sql(),
  shell: async () => {
    const { shell } = await import("@codemirror/legacy-modes/mode/shell");
    return new CodeMirrorLanguageSupport(StreamLanguage.define(shell));
  },
  powershell: async () => {
    const { powerShell } = await import("@codemirror/legacy-modes/mode/powershell");
    return new CodeMirrorLanguageSupport(StreamLanguage.define(powerShell));
  },
  cpp: async () => (await import("@codemirror/lang-cpp")).cpp(),
  csharp: async () => {
    const { csharp } = await import("@codemirror/legacy-modes/mode/clike");
    return new CodeMirrorLanguageSupport(StreamLanguage.define(csharp));
  },
  java: async () => (await import("@codemirror/lang-java")).java(),
  go: async () => (await import("@codemirror/lang-go")).go(),
  rust: async () => (await import("@codemirror/lang-rust")).rust(),
  php: async () => (await import("@codemirror/lang-php")).php(),
};

languageDescriptions.push(...languageDefinitions.map((definition) => LanguageDescription.of({
  ...definition,
  load: languageLoaders[definition.id],
})));

const descriptionsById = new Map(languageDefinitions.map((definition, index) => [definition.id, languageDescriptions[index]]));
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
