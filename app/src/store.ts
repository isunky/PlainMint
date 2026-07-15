import { ChangeSet, Text } from "@codemirror/state";
import { create } from "zustand";
import type {
  CursorStats,
  DocumentRecord,
  EditorTab,
  OpenedDocument,
  PaneId,
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
  search: SearchState;
  cursor: Record<PaneId, CursorStats>;
  settings: UserSettings;
  histories: Record<string, { undo: HistoryEntry[]; redo: HistoryEntry[] }>;
  createDocument: (pane?: PaneId) => string;
  addOpenedDocument: (opened: OpenedDocument, pane?: PaneId) => string;
  setActiveTab: (pane: PaneId, tabId: string) => void;
  closeTab: (pane: PaneId, tabId: string) => void;
  toggleSplit: () => void;
  setActivePane: (pane: PaneId) => void;
  applyChanges: (documentId: string, changes: ChangeSet, origin: string) => void;
  undoDocument: (documentId: string) => void;
  redoDocument: (documentId: string) => void;
  markSaved: (documentId: string, filePath: string, fingerprint?: DocumentRecord["fingerprint"]) => void;
  updateDocumentFlags: (documentId: string, flags: Partial<Pick<DocumentRecord, "readOnly" | "missing" | "externalModified">>) => void;
  setSearch: (patch: Partial<SearchState>) => void;
  replaceCurrent: (documentId: string, from: number, to: number, value: string) => void;
  replaceAll: (documentId: string, ranges: Array<{ from: number; to: number }>, value: string) => void;
  setCursor: (pane: PaneId, cursor: CursorStats) => void;
  updateSettings: (patch: Partial<UserSettings>) => void;
  loadSettings: (settings: UserSettings) => void;
  restoreSession: (session: WorkspaceSession) => void;
}

export const defaultSettings: UserSettings = {
  locale: "system",
  appearanceMode: "system",
  accentTheme: "tiffany",
  fontFamily: "ui-monospace",
  fontSize: 14,
  lineHeight: 1.55,
  tabSize: 4,
  showLineNumbers: true,
  wordWrapByDefault: true,
  highlightCurrentLine: true,
  autoBackupEnabled: true,
  backupDebounceSeconds: 3,
  backupRetentionDays: 30,
  maxBackupVersionsPerFile: 20,
  autoSaveMode: "off",
  sessionRecoveryMode: "ask",
  recentFileLimit: 20,
  autoCheckUpdates: true,
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

function makeDocument(id: string, fileName: string, content: string, dirty = false): DocumentRecord {
  return {
    id,
    fileName,
    content,
    encoding: "utf-8",
    lineEnding: "lf",
    dirty,
    readOnly: false,
    missing: false,
    externalModified: false,
    createdAt: Date.now(),
  };
}

function createInitialState() {
  const webPreview = !window.__TAURI_INTERNALS__;
  if (!webPreview) {
    const document = makeDocument("doc-untitled-1", "Untitled", "");
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

const initial = createInitialState();
const requestedState = new URLSearchParams(window.location.search).get("state");

export const useAppStore = create<AppState>((set, get) => ({
  ...initial,
  activePane: "left",
  split: requestedState === "split",
  search: {
    open: requestedState === "find",
    replaceOpen: requestedState === "find",
    query: requestedState === "find" ? "wrap" : "",
    replacement: "",
    caseSensitive: false,
    wholeWord: false,
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
    const document = makeDocument(id, "Untitled", "", true);
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
      const existingTab = get().tabs[pane].find((tab) => tab.documentId === existing.id);
      if (existingTab) get().setActiveTab(pane, existingTab.id);
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
      dirty: Boolean(opened.recovered),
      readOnly: opened.readOnly,
      missing: false,
      externalModified: false,
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

  closeTab: (pane, tabId) => set((state) => {
    const index = state.tabs[pane].findIndex((tab) => tab.id === tabId);
    const nextTabs = state.tabs[pane].filter((tab) => tab.id !== tabId);
    const nextActive = state.activeTab[pane] === tabId
      ? nextTabs[Math.min(index, Math.max(0, nextTabs.length - 1))]?.id ?? null
      : state.activeTab[pane];
    const openDocumentIds = new Set([
      ...state.tabs.left.filter((tab) => tab.id !== tabId).map((tab) => tab.documentId),
      ...state.tabs.right.filter((tab) => tab.id !== tabId).map((tab) => tab.documentId),
    ]);
    const documents = { ...state.documents };
    const histories = { ...state.histories };
    const closing = state.tabs[pane].find((tab) => tab.id === tabId);
    if (closing && !openDocumentIds.has(closing.documentId)) {
      delete documents[closing.documentId];
      delete histories[closing.documentId];
    }
    return {
      documents,
      histories,
      tabs: { ...state.tabs, [pane]: nextTabs },
      activeTab: { ...state.activeTab, [pane]: nextActive },
      split: pane === "right" && nextTabs.length === 0 ? false : state.split,
    };
  }),

  toggleSplit: () => set((state) => {
    if (state.split) return { split: false, activePane: "left" };
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

  setActivePane: (pane) => set({ activePane: pane }),

  applyChanges: (documentId, changes, origin) => set((state) => {
    const document = state.documents[documentId];
    if (!document || document.readOnly || changes.empty) return state;
    const before = Text.of(document.content.split("\n"));
    const inverse = changes.invert(before);
    const content = changes.apply(before).toString();
    const history = state.histories[documentId] ?? { undo: [], redo: [] };
    return {
      documents: {
        ...state.documents,
        [documentId]: {
          ...document,
          content,
          dirty: true,
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
    const before = Text.of(document.content.split("\n"));
    const content = entry.inverse.apply(before).toString();
    return {
      documents: {
        ...state.documents,
        [documentId]: {
          ...document,
          content,
          dirty: true,
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
    const before = Text.of(document.content.split("\n"));
    const content = entry.forward.apply(before).toString();
    return {
      documents: {
        ...state.documents,
        [documentId]: {
          ...document,
          content,
          dirty: true,
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

  markSaved: (documentId, filePath, fingerprint) => set((state) => {
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
          fingerprint,
          dirty: false,
          externalModified: false,
          lastSavedAt: Date.now(),
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

  updateSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),
  loadSettings: (settings) => set({ settings: { ...defaultSettings, ...settings } }),
  restoreSession: (session) => set(() => {
    const documents = Object.fromEntries(session.documents.map(({ patch: _patch, ...document }) => [
      document.id,
      { ...document, patch: undefined },
    ]));
    const validTabs = (pane: PaneId) => (session.tabs[pane] ?? []).filter((tab) => Boolean(documents[tab.documentId]));
    const tabs = { left: validTabs("left"), right: validTabs("right") };
    const activeFor = (pane: PaneId) => tabs[pane].some((tab) => tab.id === session.activeTab[pane])
      ? session.activeTab[pane]
      : tabs[pane][0]?.id ?? null;
    return {
      documents,
      tabs,
      activeTab: { left: activeFor("left"), right: activeFor("right") },
      split: Boolean(session.split && tabs.right.length),
      activePane: "left",
      histories: {},
    };
  }),
}));
