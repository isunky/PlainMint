import { ChangeSet } from "@codemirror/state";
import { create } from "zustand";
import { isUntitledDocument, untitledDocumentFileName } from "./documentName";
import { detectLanguage, isReadyForUntitledLanguageDetection } from "./languageMetadata";
import { applyChangesToString, applyTextStats, getTextStats } from "./textStats";
import type {
  CursorStats,
  DocumentRecord,
  Encoding,
  EditorTab,
  LineEnding,
  LanguageMode,
  OpenedDocument,
  PaneId,
  RecentlyClosedTab,
  SearchState,
  UserSettings,
  WorkspaceSession,
} from "./types";

interface HistoryEntry {
  forward: ChangeSet;
  inverse: ChangeSet;
}

interface AppState {
  documents: Record<string, DocumentRecord>;
  tabs: Record<PaneId, EditorTab[]>;
  activeTab: Record<PaneId, string | null>;
  activePane: PaneId;
  split: boolean;
  splitRatio: number;
  recentlyClosedTabs: RecentlyClosedTab[];
  search: SearchState;
  cursor: Record<PaneId, CursorStats>;
  settings: UserSettings;
  histories: Record<string, { undo: HistoryEntry[]; redo: HistoryEntry[] }>;
  createDocument: (pane?: PaneId) => string;
  addOpenedDocument: (opened: OpenedDocument, pane?: PaneId) => string;
  setActiveTab: (pane: PaneId, tabId: string) => void;
  closeTab: (pane: PaneId, tabId: string) => void;
  closeTabs: (targets: Array<{ pane: PaneId; tabId: string }>) => void;
  moveTab: (tabId: string, targetPane: PaneId, targetIndex: number) => void;
  toggleSplit: () => void;
  setSplitRatio: (ratio: number) => void;
  loadRecentlyClosedTabs: (entries: RecentlyClosedTab[]) => void;
  rememberClosedTab: (entry: RecentlyClosedTab) => void;
  removeRecentlyClosedTab: (path: string) => void;
  setActivePane: (pane: PaneId) => void;
  applyChanges: (documentId: string, changes: ChangeSet, origin: string) => void;
  undoDocument: (documentId: string) => void;
  redoDocument: (documentId: string) => void;
  markSaved: (documentId: string, filePath: string, savedRevision: number, fingerprint?: DocumentRecord["fingerprint"]) => void;
  replaceDocumentFromDisk: (documentId: string, opened: OpenedDocument, expectedRevision: number) => boolean;
  refreshDocumentDiskState: (documentId: string, filePath: string, fingerprint: DocumentRecord["fingerprint"], readOnly: boolean) => void;
  updateDocumentFlags: (documentId: string, flags: Partial<Pick<DocumentRecord, "readOnly" | "missing" | "externalModified">>) => void;
  updateDocumentFormat: (documentId: string, patch: Partial<Pick<DocumentRecord, "encoding" | "lineEnding">>) => void;
  setDocumentLanguageMode: (documentId: string, languageMode: LanguageMode) => void;
  completeUntitledLanguageDetection: (documentId: string) => void;
  setSearch: (patch: Partial<SearchState>) => void;
  replaceCurrent: (documentId: string, from: number, to: number, value: string) => void;
  replaceAll: (documentId: string, ranges: Array<{ from: number; to: number }>, value: string) => void;
  setCursor: (pane: PaneId, cursor: CursorStats) => void;
  updateSettings: (patch: Partial<UserSettings>) => void;
  loadSettings: (settings: Partial<UserSettings>) => void;
  restoreSession: (session: WorkspaceSession) => void;
}

export const defaultSettings: UserSettings = {
  locale: "system",
  appearanceMode: "system",
  accentTheme: "tiffany",
  fontFamily: "ui-monospace",
  latinFontFamily: "system-monospace",
  cjkFontFamily: "system-cjk",
  fontSize: 14,
  lineHeight: 1.55,
  tabSize: 4,
  showLineNumbers: true,
  wordWrapByDefault: true,
  highlightCurrentLine: true,
  spellCheckEnabled: false,
  autoBackupEnabled: true,
  backupDebounceSeconds: 3,
  backupRetentionDays: 30,
  maxBackupVersionsPerFile: 20,
  autoSaveMode: "off",
  defaultEncoding: "utf-8",
  defaultLineEnding: "lf",
  sessionRecoveryMode: "ask",
  recentFileLimit: 20,
};

const todoContent = [
  "# PlainMint - Product TODO & Notes",
  "",
  "## Goals",
  "- Build a fast, lightweight plain-text editor",
  "- Keep the UI clean, friendly, and distraction-free",
  "- Support Windows and macOS with feature parity",
  "",
  "## TODO",
  "- [x] Core text editing (open, save, undo/redo)",
  "- [x] Find & replace",
  "- [ ] Line wrap / word wrap",
  "- [ ] Split view",
  "- [ ] File encoding detection",
  "- [ ] Auto-save option",
  "- [ ] Theme support (light/dark)",
  "",
  "## Notes",
  "- Target < 10MB install size",
  "- Startup time < 300ms on modern hardware",
].join("\n");

const notesContent = [
  "# PlainMint Notes",
  "",
  "PlainMint is a modern, lightweight, plain-text editor",
  "focused on speed and simplicity.",
  "",
  "## Principles",
  "- **Fast by default** — Instant launch and snappy typing",
  "- **Minimal UI** — Keep chrome light and out of the way",
  "- **Plain text first** — No lock-in, no hidden formats",
  "- **Cross-platform** — Windows and macOS parity",
  "",
  "## Short-term Plan",
  "1. Ship core editing experience",
  "2. Add find/replace and line wrap",
  "3. Polish split view and file handling",
].join("\n");

const supportedEncodings: Encoding[] = ["utf-8", "utf-8-bom", "utf-16le", "utf-16be"];
const supportedLineEndings: LineEnding[] = ["lf", "crlf", "cr"];

export function normalizeSettings(settings: Partial<UserSettings>): UserSettings {
  const merged = { ...defaultSettings, ...settings };
  const legacyFontFamily = settings.fontFamily && settings.fontFamily !== "ui-monospace" ? settings.fontFamily : undefined;
  const requestedTabSize = Number(merged.tabSize);
  return {
    ...merged,
    latinFontFamily: settings.latinFontFamily || legacyFontFamily || defaultSettings.latinFontFamily,
    cjkFontFamily: settings.cjkFontFamily || defaultSettings.cjkFontFamily,
    tabSize: Number.isFinite(requestedTabSize) ? Math.min(8, Math.max(2, Math.round(requestedTabSize))) : defaultSettings.tabSize,
    defaultEncoding: supportedEncodings.includes(merged.defaultEncoding) ? merged.defaultEncoding : defaultSettings.defaultEncoding,
    defaultLineEnding: supportedLineEndings.includes(merged.defaultLineEnding) ? merged.defaultLineEnding : defaultSettings.defaultLineEnding,
    defaultSaveFolder: merged.defaultSaveFolder?.trim() || undefined,
    cloudSyncFolder: merged.cloudSyncFolder?.trim() || undefined,
  };
}

function makeDocument(id: string, fileName: string, content: string, dirty = false, encoding: Encoding = "utf-8", lineEnding: LineEnding = "lf", untitledNumber?: number): DocumentRecord {
  return {
    id,
    fileName,
    untitledNumber,
    content,
    textStats: getTextStats(content),
    encoding,
    lineEnding,
    languageMode: "auto",
    detectedLanguage: detectLanguage(fileName, content),
    autoLanguageDetectionComplete: false,
    dirty,
    readOnly: false,
    missing: false,
    externalModified: false,
    revision: 0,
    createdAt: Date.now(),
  };
}

function createInitialState() {
  const webPreview = !window.__TAURI_INTERNALS__;
  if (!webPreview) {
    const document = makeDocument("doc-untitled-1", untitledDocumentFileName(1), "", false, "utf-8", "lf", 1);
    const tab: EditorTab = { id: "tab-untitled-1", documentId: document.id, pane: "left", order: 0 };
    return {
      documents: { [document.id]: document },
      tabs: { left: [tab], right: [] as EditorTab[] },
      activeTab: { left: tab.id, right: null },
    };
  }

  const readme = makeDocument("doc-readme", "readme.txt", "PlainMint\n\nPlain text, freshly simple.\n");
  const todo = makeDocument("doc-todo", "todo.txt", todoContent, true);
  const notes = makeDocument("doc-notes", "notes.md", notesContent);
  return {
    documents: { [readme.id]: readme, [todo.id]: todo, [notes.id]: notes },
    tabs: {
      left: [
        { id: "tab-readme", documentId: readme.id, pane: "left" as const, order: 0 },
        { id: "tab-todo", documentId: todo.id, pane: "left" as const, order: 1 },
        { id: "tab-notes", documentId: notes.id, pane: "left" as const, order: 2 },
      ],
      right: [{ id: "tab-notes-right", documentId: notes.id, pane: "right" as const, order: 0 }],
    },
    activeTab: { left: "tab-todo", right: "tab-notes-right" },
  };
}

let sequence = 0;

function uniqueId(prefix: string) {
  sequence += 1;
  return prefix + "-" + Date.now().toString(36) + "-" + sequence.toString(36);
}

function activeDocumentId(state: AppState, pane: PaneId) {
  const active = state.activeTab[pane];
  return state.tabs[pane].find((tab) => tab.id === active)?.documentId;
}

function normalizeTabs(tabs: EditorTab[], pane: PaneId) {
  return tabs.map((tab, order) => ({ ...tab, pane, order }));
}

function nextUntitledNumber(documents: Record<string, DocumentRecord>) {
  return Object.values(documents).reduce(
    (highest, document) => isUntitledDocument(document) ? Math.max(highest, document.untitledNumber!) : highest,
    0,
  ) + 1;
}

function normalizeSplitRatio(value: unknown) {
  const ratio = Number(value);
  return Number.isFinite(ratio) ? Math.min(0.9, Math.max(0.1, ratio)) : 0.5;
}

function pathKey(path: string) {
  const normalized = path.trim().replace(/\\/g, "/");
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//")
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
}

export function normalizeRecentlyClosedTabs(entries: RecentlyClosedTab[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = pathKey(entry.path);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
}

const initial = createInitialState();
const requestedState = new URLSearchParams(window.location.search).get("state");

export const useAppStore = create<AppState>((set, get) => ({
  ...initial,
  activePane: "left",
  split: requestedState === "split",
  splitRatio: 0.5,
  recentlyClosedTabs: [],
  search: {
    open: requestedState === "find",
    replaceOpen: requestedState === "find",
    scope: "document",
    query: requestedState === "find" ? "wrap" : "",
    replacement: "",
    caseSensitive: false,
    wholeWord: false,
    regexp: false,
  },
  cursor: {
    left: { line: 1, column: 1, selected: 0 },
    right: { line: 1, column: 1, selected: 0 },
  },
  settings: defaultSettings,
  histories: {},

  createDocument: (pane = get().activePane) => {
    const id = uniqueId("doc");
    const tabId = uniqueId("tab");
    const untitledNumber = nextUntitledNumber(get().documents);
    const document = makeDocument(
      id,
      untitledDocumentFileName(untitledNumber),
      "",
      true,
      get().settings.defaultEncoding,
      get().settings.defaultLineEnding,
      untitledNumber,
    );
    set((state) => ({
      documents: { ...state.documents, [id]: document },
      tabs: {
        ...state.tabs,
        [pane]: [...state.tabs[pane], { id: tabId, documentId: id, pane, order: state.tabs[pane].length }],
      },
      activeTab: { ...state.activeTab, [pane]: tabId },
      activePane: pane,
    }));
    return id;
  },

  addOpenedDocument: (opened, pane = get().activePane) => {
    const existing = opened.path && !opened.recovered
      ? Object.values(get().documents).find((document) => document.filePath === opened.path)
      : undefined;
    if (existing) {
      const state = get();
      const existingPane = ([pane, pane === "left" ? "right" : "left"] as PaneId[])
        .find((candidate) => state.tabs[candidate].some((tab) => tab.documentId === existing.id));
      const existingTab = existingPane
        ? state.tabs[existingPane].find((tab) => tab.documentId === existing.id)
        : undefined;
      if (existingPane && existingTab) get().setActiveTab(existingPane, existingTab.id);
      return existing.id;
    }
    const id = uniqueId("doc");
    const tabId = uniqueId("tab");
    const document: DocumentRecord = {
      id,
      filePath: opened.path || undefined,
      fileName: opened.name,
      content: opened.content,
      encoding: opened.encoding,
      lineEnding: opened.lineEnding,
      languageMode: "auto",
      detectedLanguage: detectLanguage(opened.name, opened.content),
      autoLanguageDetectionComplete: true,
      dirty: Boolean(opened.recovered),
      readOnly: opened.readOnly,
      missing: false,
      externalModified: false,
      revision: 0,
      fingerprint: opened.fingerprint,
      createdAt: Date.now(),
    };
    set((state) => ({
      documents: { ...state.documents, [id]: document },
      tabs: {
        ...state.tabs,
        [pane]: [...state.tabs[pane], { id: tabId, documentId: id, pane, order: state.tabs[pane].length }],
      },
      activeTab: { ...state.activeTab, [pane]: tabId },
      activePane: pane,
    }));
    return id;
  },

  setActiveTab: (pane, tabId) => set((state) => ({
    activeTab: { ...state.activeTab, [pane]: tabId },
    activePane: pane,
  })),

  closeTab: (pane, tabId) => get().closeTabs([{ pane, tabId }]),

  closeTabs: (targets) => set((state) => {
    const targetIds = new Set(targets.map((target) => target.tabId));
    const tabsFor = (pane: PaneId) => normalizeTabs(
      state.tabs[pane].filter((tab) => !targetIds.has(tab.id)),
      pane,
    );
    const nextTabs = { left: tabsFor("left"), right: tabsFor("right") };
    const activeFor = (pane: PaneId) => {
      const current = state.activeTab[pane];
      if (current && nextTabs[pane].some((tab) => tab.id === current)) return current;
      const oldIndex = Math.max(0, state.tabs[pane].findIndex((tab) => tab.id === current));
      return nextTabs[pane][Math.min(oldIndex, Math.max(0, nextTabs[pane].length - 1))]?.id ?? null;
    };
    const openDocumentIds = new Set([...nextTabs.left, ...nextTabs.right].map((tab) => tab.documentId));
    const documents = { ...state.documents };
    const histories = { ...state.histories };
    [...state.tabs.left, ...state.tabs.right]
      .filter((tab) => targetIds.has(tab.id) && !openDocumentIds.has(tab.documentId))
      .forEach((tab) => {
        delete documents[tab.documentId];
        delete histories[tab.documentId];
      });
    const split = state.split && nextTabs.right.length > 0;
    return {
      documents,
      histories,
      tabs: nextTabs,
      activeTab: { left: activeFor("left"), right: activeFor("right") },
      split,
      activePane: !split && state.activePane === "right" ? "left" : state.activePane,
    };
  }),

  moveTab: (tabId, targetPane, targetIndex) => set((state) => {
    const sourcePane = (["left", "right"] as PaneId[])
      .find((pane) => state.tabs[pane].some((tab) => tab.id === tabId));
    if (!sourcePane) return state;
    const sourceIndex = state.tabs[sourcePane].findIndex((tab) => tab.id === tabId);
    const moving = state.tabs[sourcePane][sourceIndex];
    const sourceRemaining = state.tabs[sourcePane].filter((tab) => tab.id !== tabId);
    const targetBase = sourcePane === targetPane ? sourceRemaining : state.tabs[targetPane];
    const duplicate = targetBase.find((tab) => tab.documentId === moving.documentId);
    const insertAt = Math.min(Math.max(0, targetIndex), targetBase.length);
    const targetTabs = duplicate
      ? targetBase
      : [...targetBase.slice(0, insertAt), { ...moving, pane: targetPane }, ...targetBase.slice(insertAt)];
    const tabs = {
      left: normalizeTabs(sourcePane === "left" ? sourceRemaining : targetPane === "left" ? targetTabs : state.tabs.left, "left"),
      right: normalizeTabs(sourcePane === "right" ? sourceRemaining : targetPane === "right" ? targetTabs : state.tabs.right, "right"),
    };
    if (sourcePane === targetPane) tabs[targetPane] = normalizeTabs(targetTabs, targetPane);
    const sourceActive = state.activeTab[sourcePane] === tabId
      ? tabs[sourcePane][Math.min(sourceIndex, Math.max(0, tabs[sourcePane].length - 1))]?.id ?? null
      : state.activeTab[sourcePane];
    const targetActive = duplicate?.id ?? tabId;
    const activeTab = { ...state.activeTab, [sourcePane]: sourceActive, [targetPane]: targetActive };
    const split = (state.split || targetPane === "right") && tabs.right.length > 0;
    return {
      tabs,
      activeTab,
      activePane: split ? targetPane : "left",
      split,
    };
  }),

  toggleSplit: () => set((state) => {
    if (state.split) {
      const merged = [...state.tabs.left];
      state.tabs.right.forEach((tab) => {
        if (!merged.some((candidate) => candidate.documentId === tab.documentId)) merged.push({ ...tab, pane: "left" });
      });
      const leftTabs = normalizeTabs(merged, "left");
      const rightActiveDocumentId = state.tabs.right.find((tab) => tab.id === state.activeTab.right)?.documentId;
      const nextActive = state.activePane === "right" && rightActiveDocumentId
        ? leftTabs.find((tab) => tab.documentId === rightActiveDocumentId)?.id ?? state.activeTab.left
        : state.activeTab.left;
      return {
        split: false,
        tabs: { left: leftTabs, right: [] },
        activeTab: { left: nextActive ?? leftTabs[0]?.id ?? null, right: null },
        activePane: "left",
      };
    }
    const rightTabs = state.tabs.right.length > 0 ? state.tabs.right : (() => {
      const documentId = activeDocumentId(state, "left");
      return documentId
        ? [{ id: uniqueId("tab"), documentId, pane: "right" as const, order: 0 }]
        : [];
    })();
    return {
      split: true,
      tabs: { ...state.tabs, right: rightTabs },
      activeTab: {
        left: state.activeTab.left,
        right: state.activeTab.right ?? rightTabs[0]?.id ?? null,
      },
      activePane: "left",
    };
  }),

  setSplitRatio: (ratio) => set({ splitRatio: normalizeSplitRatio(ratio) }),

  loadRecentlyClosedTabs: (entries) => set({ recentlyClosedTabs: normalizeRecentlyClosedTabs(entries) }),
  rememberClosedTab: (entry) => set((state) => ({
    recentlyClosedTabs: normalizeRecentlyClosedTabs([entry, ...state.recentlyClosedTabs]),
  })),
  removeRecentlyClosedTab: (path) => set((state) => ({
    recentlyClosedTabs: state.recentlyClosedTabs.filter((entry) => pathKey(entry.path) !== pathKey(path)),
  })),

  setActivePane: (pane) => set({ activePane: pane }),

  applyChanges: (documentId, changes, origin) => set((state) => {
    const document = state.documents[documentId];
    if (!document || document.readOnly || changes.empty) return state;
    const result = applyChangesToString(document.content, changes);
    const inverse = ChangeSet.of(result.inverseSpecs, result.content.length);
    const history = state.histories[documentId] ?? { undo: [], redo: [] };
    return {
      documents: {
        ...state.documents,
        [documentId]: {
          ...document,
          content: result.content,
          textStats: applyTextStats(document.textStats ?? getTextStats(document.content), result.statsDelta),
          encoding: document.revision === 0 && isUntitledDocument(document) && document.content.length === 0
            ? state.settings.defaultEncoding
            : document.encoding,
          lineEnding: document.revision === 0 && isUntitledDocument(document) && document.content.length === 0
            ? state.settings.defaultLineEnding
            : document.lineEnding,
          dirty: true,
          revision: document.revision + 1,
          patch: { sequence: ++sequence, origin, changes },
        },
      },
      histories: {
        ...state.histories,
        [documentId]: {
          undo: [...history.undo.slice(-999), { forward: changes, inverse }],
          redo: [],
        },
      },
    };
  }),

  undoDocument: (documentId) => set((state) => {
    const document = state.documents[documentId];
    const history = state.histories[documentId];
    const entry = history?.undo.at(-1);
    if (!document || !history || !entry) return state;
    const result = applyChangesToString(document.content, entry.inverse);
    return {
      documents: {
        ...state.documents,
        [documentId]: {
          ...document,
          content: result.content,
          textStats: applyTextStats(document.textStats ?? getTextStats(document.content), result.statsDelta),
          dirty: true,
          revision: document.revision + 1,
          patch: { sequence: ++sequence, origin: "history", changes: entry.inverse },
        },
      },
      histories: {
        ...state.histories,
        [documentId]: {
          undo: history.undo.slice(0, -1),
          redo: [...history.redo, entry],
        },
      },
    };
  }),

  redoDocument: (documentId) => set((state) => {
    const document = state.documents[documentId];
    const history = state.histories[documentId];
    const entry = history?.redo.at(-1);
    if (!document || !history || !entry) return state;
    const result = applyChangesToString(document.content, entry.forward);
    return {
      documents: {
        ...state.documents,
        [documentId]: {
          ...document,
          content: result.content,
          textStats: applyTextStats(document.textStats ?? getTextStats(document.content), result.statsDelta),
          dirty: true,
          revision: document.revision + 1,
          patch: { sequence: ++sequence, origin: "history", changes: entry.forward },
        },
      },
      histories: {
        ...state.histories,
        [documentId]: {
          undo: [...history.undo, entry],
          redo: history.redo.slice(0, -1),
        },
      },
    };
  }),

  markSaved: (documentId, filePath, savedRevision, fingerprint) => set((state) => {
    const document = state.documents[documentId];
    if (!document) return state;
    const fileName = filePath.split(/[\\/]/).at(-1) ?? document.fileName;
    return {
      documents: {
        ...state.documents,
        [documentId]: {
          ...document,
          filePath,
          fileName,
          untitledNumber: undefined,
          detectedLanguage: document.languageMode === "auto"
            ? detectLanguage(fileName, document.content)
            : document.detectedLanguage,
          autoLanguageDetectionComplete: true,
          fingerprint,
          dirty: document.revision !== savedRevision,
          externalModified: false,
          lastSavedAt: Date.now(),
        },
      },
    };
  }),

  replaceDocumentFromDisk: (documentId, opened, expectedRevision) => {
    let replaced = false;
    set((state) => {
      const document = state.documents[documentId];
      if (!document || document.revision !== expectedRevision) return state;
      replaced = true;
      return {
        documents: {
          ...state.documents,
          [documentId]: {
            ...document,
            filePath: opened.path || document.filePath,
            fileName: opened.name,
            untitledNumber: undefined,
            content: opened.content,
            textStats: getTextStats(opened.content),
            encoding: opened.encoding,
            lineEnding: opened.lineEnding,
            detectedLanguage: document.languageMode === "auto"
              ? detectLanguage(opened.name, opened.content)
              : document.detectedLanguage,
            autoLanguageDetectionComplete: true,
            readOnly: opened.readOnly,
            missing: false,
            externalModified: false,
            fingerprint: opened.fingerprint,
            dirty: false,
            revision: document.revision + 1,
            patch: undefined,
          },
        },
        histories: {
          ...state.histories,
          [documentId]: { undo: [], redo: [] },
        },
      };
    });
    return replaced;
  },

  refreshDocumentDiskState: (documentId, filePath, fingerprint, readOnly) => set((state) => {
    const document = state.documents[documentId];
    if (!document || document.filePath !== filePath) return state;
    return {
      documents: {
        ...state.documents,
        [documentId]: {
          ...document,
          fingerprint,
          readOnly,
          missing: false,
        },
      },
    };
  }),

  updateDocumentFlags: (documentId, flags) => set((state) => {
    const document = state.documents[documentId];
    return document
      ? { documents: { ...state.documents, [documentId]: { ...document, ...flags } } }
      : state;
  }),

  updateDocumentFormat: (documentId, patch) => set((state) => {
    const document = state.documents[documentId];
    if (!document || document.readOnly) return state;
    const encoding = patch.encoding ?? document.encoding;
    const lineEnding = patch.lineEnding ?? document.lineEnding;
    if (encoding === document.encoding && lineEnding === document.lineEnding) return state;
    return {
      documents: {
        ...state.documents,
        [documentId]: {
          ...document,
          encoding,
          lineEnding,
          dirty: true,
          revision: document.revision + 1,
        },
      },
    };
  }),

  setDocumentLanguageMode: (documentId, languageMode) => set((state) => {
    const document = state.documents[documentId];
    if (!document) return state;
    const detectedLanguage = languageMode === "auto"
      ? detectLanguage(document.fileName, document.content)
      : document.detectedLanguage;
    const autoLanguageDetectionComplete = languageMode === "auto"
      ? Boolean(document.filePath) || isReadyForUntitledLanguageDetection(document.content)
      : document.autoLanguageDetectionComplete;
    if (
      document.languageMode === languageMode
      && document.detectedLanguage === detectedLanguage
      && document.autoLanguageDetectionComplete === autoLanguageDetectionComplete
    ) return state;
    return {
      documents: {
        ...state.documents,
        [documentId]: {
          ...document,
          languageMode,
          detectedLanguage,
          autoLanguageDetectionComplete,
        },
      },
    };
  }),

  completeUntitledLanguageDetection: (documentId) => set((state) => {
    const document = state.documents[documentId];
    if (
      !document
      || document.filePath
      || document.languageMode !== "auto"
      || document.autoLanguageDetectionComplete
      || !isReadyForUntitledLanguageDetection(document.content)
    ) return state;
    return {
      documents: {
        ...state.documents,
        [documentId]: {
          ...document,
          detectedLanguage: detectLanguage(document.fileName, document.content),
          autoLanguageDetectionComplete: true,
        },
      },
    };
  }),

  setSearch: (patch) => set((state) => ({ search: { ...state.search, ...patch } })),

  replaceCurrent: (documentId, from, to, value) => {
    const document = get().documents[documentId];
    if (!document) return;
    get().applyChanges(documentId, ChangeSet.of({ from, to, insert: value }, document.content.length), "replace");
  },

  replaceAll: (documentId, ranges, value) => {
    const document = get().documents[documentId];
    if (!document || ranges.length === 0) return;
    const changes = ChangeSet.of(ranges.map((range) => ({ ...range, insert: value })), document.content.length);
    get().applyChanges(documentId, changes, "replace-all");
  },

  setCursor: (pane, cursor) => set((state) => ({ cursor: { ...state.cursor, [pane]: cursor } })),

  updateSettings: (patch) => set((state) => ({ settings: normalizeSettings({ ...state.settings, ...patch }) })),
  loadSettings: (settings) => set({ settings: normalizeSettings(settings) }),
  restoreSession: (session) => set(() => {
    const restoredUntitledNumbers = new Map<string, number>();
    const untitledCandidates = session.documents
      .map((document, index) => ({ document, index }))
      .filter(({ document }) => !document.filePath && (document.fileName === "Untitled" || Number.isInteger(document.untitledNumber)))
      .sort((left, right) => left.document.createdAt - right.document.createdAt || left.index - right.index);
    const usedUntitledNumbers = new Set<number>();
    for (const { document } of untitledCandidates) {
      const number = document.untitledNumber;
      if (Number.isInteger(number) && number! > 0 && !usedUntitledNumbers.has(number!)) {
        usedUntitledNumbers.add(number!);
        restoredUntitledNumbers.set(document.id, number!);
      }
    }
    let nextRestoredUntitledNumber = 1;
    for (const { document } of untitledCandidates) {
      if (restoredUntitledNumbers.has(document.id)) continue;
      while (usedUntitledNumbers.has(nextRestoredUntitledNumber)) nextRestoredUntitledNumber += 1;
      restoredUntitledNumbers.set(document.id, nextRestoredUntitledNumber);
      usedUntitledNumbers.add(nextRestoredUntitledNumber);
      nextRestoredUntitledNumber += 1;
    }
    const documents = Object.fromEntries(session.documents.map(({ patch: _patch, ...document }) => {
      const untitledNumber = restoredUntitledNumbers.get(document.id);
      const languageMode = document.languageMode ?? "auto";
      return [
        document.id,
        {
          ...document,
          fileName: untitledNumber ? untitledDocumentFileName(untitledNumber) : document.fileName,
          untitledNumber,
          languageMode,
          detectedLanguage: document.detectedLanguage ?? detectLanguage(document.fileName, document.content),
          autoLanguageDetectionComplete: document.autoLanguageDetectionComplete ?? Boolean(document.filePath),
          textStats: document.textStats ?? getTextStats(document.content),
          revision: document.revision ?? 0,
          patch: undefined,
        },
      ];
    }));
    const validTabs = (pane: PaneId) => normalizeTabs(
      (session.tabs[pane] ?? []).filter((tab) => Boolean(documents[tab.documentId])),
      pane,
    );
    const tabs = { left: validTabs("left"), right: validTabs("right") };
    if (!session.split && tabs.right.length) {
      tabs.right.forEach((tab) => {
        if (!tabs.left.some((candidate) => candidate.documentId === tab.documentId)) {
          tabs.left.push({ ...tab, pane: "left", order: tabs.left.length });
        }
      });
      tabs.right = [];
    }
    const activeFor = (pane: PaneId) => tabs[pane].some((tab) => tab.id === session.activeTab[pane])
      ? session.activeTab[pane]
      : tabs[pane][0]?.id ?? null;
    return {
      documents,
      tabs,
      activeTab: { left: activeFor("left"), right: activeFor("right") },
      split: Boolean(session.split && tabs.right.length),
      splitRatio: normalizeSplitRatio(session.splitRatio),
      activePane: "left",
      histories: {},
    };
  }),
}));
