import { ChangeSet } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { defaultSettings, normalizeRecentlyClosedTabs, normalizeSettings, useAppStore } from "./store";
import type { DocumentRecord, WorkspaceSession } from "./types";

function documentRecord(id: string): DocumentRecord {
  return {
    id,
    fileName: `${id}.txt`,
    filePath: `C:\\${id}.txt`,
    content: id,
    encoding: "utf-8",
    lineEnding: "lf",
    languageMode: "auto",
    detectedLanguage: "plain",
    autoLanguageDetectionComplete: true,
    dirty: false,
    readOnly: false,
    missing: false,
    externalModified: false,
    revision: 0,
    createdAt: 1,
  };
}

describe("document history", () => {
  it("creates a dirty document from a template using the current file defaults", () => {
    const previousSettings = useAppStore.getState().settings;
    useAppStore.setState((state) => ({
      settings: { ...state.settings, defaultEncoding: "utf-16le", defaultLineEnding: "crlf" },
    }));
    const id = useAppStore.getState().createDocument("right", {
      fileName: "meeting-notes.md",
      content: "# Meeting notes\n",
      languageMode: "markdown",
    });

    const document = useAppStore.getState().documents[id];
    useAppStore.setState({ settings: previousSettings });
    expect(document.filePath).toBeUndefined();
    expect(document).toMatchObject({
      fileName: "meeting-notes.md",
      untitledNumber: undefined,
      content: "# Meeting notes\n",
      encoding: "utf-16le",
      lineEnding: "crlf",
      languageMode: "markdown",
      dirty: true,
    });
    expect(useAppStore.getState().activePane).toBe("right");
    expect(useAppStore.getState().tabs.right.at(-1)?.documentId).toBe(id);
  });

  it("applies, undoes, and redoes a change through the shared controller", () => {
    const id = useAppStore.getState().createDocument("left");
    const before = useAppStore.getState().documents[id].content;
    useAppStore.getState().applyChanges(id, ChangeSet.of({ from: 0, insert: "PlainMint" }, before.length), "test");
    expect(useAppStore.getState().documents[id].content).toBe("PlainMint");
    expect(useAppStore.getState().documents[id].dirty).toBe(true);

    useAppStore.getState().undoDocument(id);
    expect(useAppStore.getState().documents[id].content).toBe("");

    useAppStore.getState().redoDocument(id);
    expect(useAppStore.getState().documents[id].content).toBe("PlainMint");
  });
});

describe("disk reload", () => {
  it("replaces a clean document only at the expected revision and clears history", () => {
    const id = "disk-reload";
    useAppStore.setState((state) => ({
      documents: { ...state.documents, [id]: { ...documentRecord(id), dirty: false, externalModified: true, revision: 4 } },
      histories: {
        ...state.histories,
        [id]: { undo: [{ forward: ChangeSet.of([], 0), inverse: ChangeSet.of([], 0) }], redo: [] },
      },
    }));
    const opened = {
      path: "C:\\disk-reload.txt",
      name: "disk-reload.txt",
      content: "from disk",
      encoding: "utf-8" as const,
      lineEnding: "crlf" as const,
      readOnly: false,
      fingerprint: { modifiedAt: 10, size: 9, hash: "disk" },
    };

    expect(useAppStore.getState().replaceDocumentFromDisk(id, opened, 3)).toBe(false);
    expect(useAppStore.getState().replaceDocumentFromDisk(id, opened, 4)).toBe(true);
    const document = useAppStore.getState().documents[id];
    expect(document).toMatchObject({ content: "from disk", dirty: false, externalModified: false, revision: 5, lineEnding: "crlf" });
    expect(useAppStore.getState().histories[id]).toEqual({ undo: [], redo: [] });
  });

  it("refreshes disk metadata without changing content, revision, dirty state, or history", () => {
    const id = "disk-state";
    useAppStore.setState((state) => ({
      documents: { ...state.documents, [id]: { ...documentRecord(id), dirty: true, missing: true, revision: 8 } },
      histories: {
        ...state.histories,
        [id]: { undo: [{ forward: ChangeSet.of([], 0), inverse: ChangeSet.of([], 0) }], redo: [] },
      },
    }));
    const beforeHistory = useAppStore.getState().histories[id];

    useAppStore.getState().refreshDocumentDiskState(id, `C:\\${id}.txt`, { modifiedAt: 12, size: 10, hash: "same" }, true);

    expect(useAppStore.getState().documents[id]).toMatchObject({
      content: id,
      dirty: true,
      missing: false,
      readOnly: true,
      revision: 8,
      fingerprint: { modifiedAt: 12, size: 10, hash: "same" },
    });
    expect(useAppStore.getState().histories[id]).toBe(beforeHistory);
  });
});

describe("settings migration", () => {
  it("keeps a legacy editor font as the selected Latin font", () => {
    const settings = normalizeSettings({ fontFamily: "Consolas" });

    expect(settings.latinFontFamily).toBe("Consolas");
    expect(settings.cjkFontFamily).toBe("system-cjk");
  });
});

describe("workspace session", () => {
  it("restores valid tabs and removes references to missing documents", () => {
    const session: WorkspaceSession = {
      savedAt: Date.now(),
      split: true,
      documents: [{
        id: "restored-doc",
        fileName: "restored.txt",
        content: "safe content",
        encoding: "utf-8",
        lineEnding: "lf",
        languageMode: "auto",
        detectedLanguage: "plain",
        autoLanguageDetectionComplete: true,
        dirty: true,
        readOnly: false,
        missing: false,
        externalModified: false,
        revision: 0,
        createdAt: Date.now(),
      }],
      tabs: {
        left: [{ id: "restored-tab", documentId: "restored-doc", pane: "left", order: 0 }],
        right: [{ id: "missing-tab", documentId: "missing-doc", pane: "right", order: 0 }],
      },
      activeTab: { left: "restored-tab", right: "missing-tab" },
    };

    useAppStore.getState().restoreSession(session);
    const state = useAppStore.getState();
    expect(state.documents["restored-doc"].content).toBe("safe content");
    expect(state.activeTab.left).toBe("restored-tab");
    expect(state.tabs.right).toHaveLength(0);
    expect(state.split).toBe(false);
  });
});

describe("document language state", () => {
  it("changes the display mode without touching content history or dirty state", () => {
    const id = "language-mode";
    useAppStore.setState((state) => ({
      documents: {
        ...state.documents,
        [id]: {
          ...documentRecord(id),
          fileName: "language-mode.ts",
          dirty: true,
          revision: 6,
          languageMode: "auto",
          detectedLanguage: "typescript",
        },
      },
      histories: { ...state.histories, [id]: { undo: [], redo: [] } },
    }));
    const history = useAppStore.getState().histories[id];

    useAppStore.getState().setDocumentLanguageMode(id, "python");
    expect(useAppStore.getState().documents[id]).toMatchObject({ languageMode: "python", detectedLanguage: "typescript", dirty: true, revision: 6 });
    expect(useAppStore.getState().histories[id]).toBe(history);

    useAppStore.getState().setDocumentLanguageMode(id, "auto");
    expect(useAppStore.getState().documents[id]).toMatchObject({ languageMode: "auto", detectedLanguage: "typescript", dirty: true, revision: 6 });
  });

  it("runs untitled content detection once without creating an edit", () => {
    const id = "untitled-language";
    useAppStore.setState((state) => ({
      documents: {
        ...state.documents,
        [id]: {
          ...documentRecord(id),
          filePath: undefined,
          fileName: "Untitled",
          content: "# Heading\n\n- item",
          dirty: true,
          revision: 4,
          languageMode: "auto",
          detectedLanguage: "plain",
          autoLanguageDetectionComplete: false,
        },
      },
    }));

    useAppStore.getState().completeUntitledLanguageDetection(id);
    expect(useAppStore.getState().documents[id]).toMatchObject({ detectedLanguage: "markdown", autoLanguageDetectionComplete: true, dirty: true, revision: 4 });
  });

  it("assigns stable numbers to legacy untitled documents when restoring a session", () => {
    const legacyDocument = (id: string, createdAt: number, untitledNumber?: number): DocumentRecord => ({
      ...documentRecord(id),
      filePath: undefined,
      fileName: "Untitled",
      untitledNumber,
      createdAt,
    });
    const session: WorkspaceSession = {
      savedAt: Date.now(),
      split: false,
      documents: [
        legacyDocument("legacy-first", 1),
        legacyDocument("numbered", 2, 2),
        legacyDocument("duplicate", 3, 2),
      ],
      tabs: {
        left: [
          { id: "legacy-first-tab", documentId: "legacy-first", pane: "left", order: 0 },
          { id: "numbered-tab", documentId: "numbered", pane: "left", order: 1 },
          { id: "duplicate-tab", documentId: "duplicate", pane: "left", order: 2 },
        ],
        right: [],
      },
      activeTab: { left: "legacy-first-tab", right: null },
    };

    useAppStore.getState().restoreSession(session);

    expect(useAppStore.getState().documents).toMatchObject({
      "legacy-first": { fileName: "Untitled 1", untitledNumber: 1 },
      numbered: { fileName: "Untitled 2", untitledNumber: 2 },
      duplicate: { fileName: "Untitled 3", untitledNumber: 3 },
    });
  });
});

describe("untitled document naming", () => {
  it("numbers new documents across panes and clears the number after the first save", () => {
    useAppStore.setState({
      documents: {},
      tabs: { left: [], right: [] },
      activeTab: { left: null, right: null },
      activePane: "left",
    });

    const firstId = useAppStore.getState().createDocument("left");
    const secondId = useAppStore.getState().createDocument("right");
    const first = useAppStore.getState().documents[firstId];
    const second = useAppStore.getState().documents[secondId];

    expect(first).toMatchObject({ fileName: "Untitled 1", untitledNumber: 1 });
    expect(second).toMatchObject({ fileName: "Untitled 2", untitledNumber: 2 });

    useAppStore.getState().markSaved(firstId, "C:\\Notes\\saved.txt", first.revision);
    expect(useAppStore.getState().documents[firstId]).toMatchObject({ fileName: "saved.txt", untitledNumber: undefined });
  });
});

describe("recovered documents", () => {
  it("opens recovered content as an unsaved document without deduplicating unnamed copies", () => {
    const opened = {
      path: "",
      name: "recovered.txt",
      content: "recovered content",
      encoding: "utf-8" as const,
      lineEnding: "lf" as const,
      readOnly: false,
      recovered: true,
    };

    const firstId = useAppStore.getState().addOpenedDocument(opened, "left");
    const secondId = useAppStore.getState().addOpenedDocument(opened, "left");

    expect(secondId).not.toBe(firstId);
    expect(useAppStore.getState().documents[firstId].dirty).toBe(true);
    expect(useAppStore.getState().documents[firstId].filePath).toBeUndefined();
  });
});

describe("runtime settings", () => {
  it("normalizes the supported Tab width range", () => {
    useAppStore.getState().loadSettings({ ...defaultSettings, tabSize: 99 });
    expect(useAppStore.getState().settings.tabSize).toBe(8);
    useAppStore.getState().updateSettings({ tabSize: 1 });
    expect(useAppStore.getState().settings.tabSize).toBe(2);
  });

  it("fills the default encoding when loading a legacy settings file", () => {
    useAppStore.getState().loadSettings({ tabSize: 4 });
    expect(useAppStore.getState().settings.defaultEncoding).toBe("utf-8");
    expect(useAppStore.getState().settings.defaultLineEnding).toBe("lf");
    expect(useAppStore.getState().settings.spellCheckEnabled).toBe(false);
  });

  it("uses configured defaults only for newly created documents", () => {
    useAppStore.getState().loadSettings({ ...defaultSettings, defaultEncoding: "utf-16le", defaultLineEnding: "crlf" });
    const createdId = useAppStore.getState().createDocument("left");
    const openedId = useAppStore.getState().addOpenedDocument({
      path: "C:\\opened.txt",
      name: "opened.txt",
      content: "opened",
      encoding: "utf-8-bom",
      lineEnding: "lf",
      readOnly: false,
    }, "left");

    expect(useAppStore.getState().documents[createdId].encoding).toBe("utf-16le");
    expect(useAppStore.getState().documents[createdId].lineEnding).toBe("crlf");
    expect(useAppStore.getState().documents[openedId].encoding).toBe("utf-8-bom");
    expect(useAppStore.getState().documents[openedId].lineEnding).toBe("lf");
  });

  it("applies hydrated defaults when the startup blank document is first edited", () => {
    useAppStore.getState().loadSettings({ ...defaultSettings, defaultEncoding: "utf-8", defaultLineEnding: "lf" });
    const id = useAppStore.getState().createDocument("left");
    useAppStore.getState().loadSettings({ ...defaultSettings, defaultEncoding: "utf-16be", defaultLineEnding: "cr" });
    useAppStore.getState().applyChanges(id, ChangeSet.of({ from: 0, insert: "text" }, 0), "test");
    expect(useAppStore.getState().documents[id].encoding).toBe("utf-16be");
    expect(useAppStore.getState().documents[id].lineEnding).toBe("cr");
  });

  it("marks format changes as unsaved without changing content or history", () => {
    const id = useAppStore.getState().createDocument("left");
    const before = useAppStore.getState().documents[id];

    useAppStore.getState().updateDocumentFormat(id, { encoding: "utf-16le", lineEnding: "crlf" });
    const updated = useAppStore.getState().documents[id];

    expect(updated).toMatchObject({ encoding: "utf-16le", lineEnding: "crlf", content: before.content, dirty: true, revision: before.revision + 1 });
    expect(useAppStore.getState().histories[id]).toBeUndefined();

    useAppStore.getState().updateDocumentFormat(id, { encoding: "utf-16le" });
    expect(useAppStore.getState().documents[id].revision).toBe(updated.revision);

    useAppStore.setState({ documents: { ...useAppStore.getState().documents, [id]: { ...updated, readOnly: true } } });
    useAppStore.getState().updateDocumentFormat(id, { lineEnding: "cr" });
    expect(useAppStore.getState().documents[id].lineEnding).toBe("crlf");
  });

  it("does not clear newer edits when an older revision finishes saving", () => {
    const id = useAppStore.getState().createDocument("left");
    useAppStore.getState().applyChanges(id, ChangeSet.of({ from: 0, insert: "first" }, 0), "test");
    const savedRevision = useAppStore.getState().documents[id].revision;
    useAppStore.getState().applyChanges(id, ChangeSet.of({ from: 5, insert: " second" }, 5), "test");

    useAppStore.getState().markSaved(id, "C:\\notes.txt", savedRevision, { modifiedAt: 1, size: 5, hash: "saved" });
    expect(useAppStore.getState().documents[id].dirty).toBe(true);

    const currentRevision = useAppStore.getState().documents[id].revision;
    useAppStore.getState().markSaved(id, "C:\\notes.txt", currentRevision, { modifiedAt: 2, size: 12, hash: "current" });
    expect(useAppStore.getState().documents[id].dirty).toBe(false);
  });
});

describe("tab and split workspace", () => {
  it("reorders tabs within one pane and normalizes their order", () => {
    const documents = { a: documentRecord("a"), b: documentRecord("b"), c: documentRecord("c") };
    useAppStore.setState({
      documents,
      tabs: {
        left: [
          { id: "tab-a", documentId: "a", pane: "left", order: 0 },
          { id: "tab-b", documentId: "b", pane: "left", order: 1 },
          { id: "tab-c", documentId: "c", pane: "left", order: 2 },
        ],
        right: [],
      },
      activeTab: { left: "tab-b", right: null },
      activePane: "left",
      split: false,
    });

    useAppStore.getState().moveTab("tab-c", "left", 0);

    expect(useAppStore.getState().tabs.left.map((tab) => tab.id)).toEqual(["tab-c", "tab-a", "tab-b"]);
    expect(useAppStore.getState().tabs.left.map((tab) => tab.order)).toEqual([0, 1, 2]);
    expect(useAppStore.getState().activeTab.left).toBe("tab-c");
  });

  it("moves a tab across panes and removes a duplicate target tab", () => {
    const documents = { a: documentRecord("a"), b: documentRecord("b") };
    useAppStore.setState({
      documents,
      tabs: {
        left: [
          { id: "tab-a", documentId: "a", pane: "left", order: 0 },
          { id: "tab-b", documentId: "b", pane: "left", order: 1 },
        ],
        right: [{ id: "tab-a-right", documentId: "a", pane: "right", order: 0 }],
      },
      activeTab: { left: "tab-a", right: "tab-a-right" },
      activePane: "left",
      split: true,
    });

    useAppStore.getState().moveTab("tab-a", "right", 1);

    const state = useAppStore.getState();
    expect(state.tabs.left.map((tab) => tab.id)).toEqual(["tab-b"]);
    expect(state.tabs.right.map((tab) => tab.id)).toEqual(["tab-a-right"]);
    expect(state.activeTab.right).toBe("tab-a-right");
    expect(state.documents.a).toBeDefined();
  });

  it("merges the right pane without duplicate documents and keeps its active document", () => {
    const documents = { a: documentRecord("a"), b: documentRecord("b") };
    useAppStore.setState({
      documents,
      tabs: {
        left: [{ id: "tab-a", documentId: "a", pane: "left", order: 0 }],
        right: [
          { id: "tab-a-right", documentId: "a", pane: "right", order: 0 },
          { id: "tab-b", documentId: "b", pane: "right", order: 1 },
        ],
      },
      activeTab: { left: "tab-a", right: "tab-b" },
      activePane: "right",
      split: true,
    });

    useAppStore.getState().toggleSplit();

    const state = useAppStore.getState();
    expect(state.split).toBe(false);
    expect(state.tabs.right).toEqual([]);
    expect(state.tabs.left.map((tab) => tab.documentId)).toEqual(["a", "b"]);
    expect(state.tabs.left.find((tab) => tab.id === state.activeTab.left)?.documentId).toBe("b");
  });

  it("restores a persisted split ratio and defaults legacy sessions to one half", () => {
    const base: WorkspaceSession = {
      savedAt: 1,
      split: false,
      activeTab: { left: null, right: null },
      tabs: { left: [], right: [] },
      documents: [],
    };
    useAppStore.getState().restoreSession({ ...base, splitRatio: 0.68 });
    expect(useAppStore.getState().splitRatio).toBe(0.68);
    useAppStore.getState().restoreSession(base);
    expect(useAppStore.getState().splitRatio).toBe(0.5);
  });

  it("merges right-side tabs from legacy non-split sessions instead of hiding them", () => {
    const a = documentRecord("a");
    const b = documentRecord("b");
    useAppStore.getState().restoreSession({
      savedAt: 1,
      split: false,
      activeTab: { left: "tab-a", right: "tab-b" },
      tabs: {
        left: [{ id: "tab-a", documentId: "a", pane: "left", order: 0 }],
        right: [{ id: "tab-b", documentId: "b", pane: "right", order: 0 }],
      },
      documents: [a, b],
    });

    expect(useAppStore.getState().tabs.left.map((tab) => tab.documentId)).toEqual(["a", "b"]);
    expect(useAppStore.getState().tabs.right).toEqual([]);
  });
});

describe("recently closed tabs", () => {
  it("deduplicates Windows paths and keeps at most ten entries", () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({
      path: `C:\\Notes\\${index}.txt`,
      fileName: `${index}.txt`,
      closedAt: 12 - index,
    }));
    entries.splice(1, 0, { path: "c:\\notes\\0.txt", fileName: "duplicate.txt", closedAt: 99 });

    const normalized = normalizeRecentlyClosedTabs(entries);

    expect(normalized).toHaveLength(10);
    expect(normalized.filter((entry) => entry.path.toLowerCase().endsWith("0.txt"))).toHaveLength(1);
    expect(normalized[0].fileName).toBe("0.txt");
  });
});
