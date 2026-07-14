import { ChangeSet } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { useAppStore } from "./store";
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
