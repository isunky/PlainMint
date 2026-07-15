import { ChangeSet } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { defaultSettings, useAppStore } from "./store";
import type { WorkspaceSession } from "./types";

describe("document history", () => {
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
  });

  it("uses the configured default encoding only for newly created documents", () => {
    useAppStore.getState().loadSettings({ ...defaultSettings, defaultEncoding: "utf-16le" });
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
    expect(useAppStore.getState().documents[openedId].encoding).toBe("utf-8-bom");
  });

  it("applies hydrated defaults when the startup blank document is first edited", () => {
    useAppStore.getState().loadSettings({ ...defaultSettings, defaultEncoding: "utf-8" });
    const id = useAppStore.getState().createDocument("left");
    useAppStore.getState().loadSettings({ ...defaultSettings, defaultEncoding: "utf-16be" });
    useAppStore.getState().applyChanges(id, ChangeSet.of({ from: 0, insert: "text" }, 0), "test");
    expect(useAppStore.getState().documents[id].encoding).toBe("utf-16be");
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
