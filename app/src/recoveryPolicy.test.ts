import { describe, expect, it } from "vitest";
import { createWorkspaceSession, decideStartupRecovery } from "./recoveryPolicy";
import type { DocumentRecord, WorkspaceSession } from "./types";

const session: WorkspaceSession = {
  savedAt: 1,
  split: false,
  activeTab: { left: "tab-1", right: null },
  tabs: { left: [{ id: "tab-1", documentId: "doc-1", pane: "left", order: 0 }], right: [] },
  documents: [{
    id: "doc-1",
    fileName: "draft.txt",
    content: "unsaved",
    encoding: "utf-8",
    lineEnding: "lf",
    languageMode: "auto",
    detectedLanguage: "plain",
    autoLanguageDetectionComplete: false,
    dirty: true,
    readOnly: false,
    missing: false,
    externalModified: false,
    revision: 0,
    createdAt: 1,
  }],
};

describe("startup recovery policy", () => {
  it("asks only after an unexpected exit when ask mode is enabled", () => {
    expect(decideStartupRecovery("ask", { previousExitWasUnclean: true }, session)).toBe("ask");
    expect(decideStartupRecovery("ask", { previousExitWasUnclean: false }, session)).toBe("restore");
  });

  it("honors automatic and empty recovery modes", () => {
    expect(decideStartupRecovery("auto", { previousExitWasUnclean: true }, session)).toBe("restore");
    expect(decideStartupRecovery("empty", { previousExitWasUnclean: true }, session)).toBe("empty");
  });

  it("does not interrupt startup for an empty untitled workspace", () => {
    const emptySession: WorkspaceSession = {
      ...session,
      documents: [{ ...session.documents[0], content: "", dirty: false }],
    };
    expect(decideStartupRecovery("ask", { previousExitWasUnclean: true }, emptySession)).toBe("restore");
  });
});

describe("clean exit session snapshot", () => {
  it("omits only explicitly discarded documents and keeps untitled drafts", () => {
    const clean: DocumentRecord = {
      id: "clean",
      fileName: "clean.txt",
      content: "saved",
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
    const dirty = { ...clean, id: "dirty", filePath: "C:\\draft.txt", fileName: "draft.txt", dirty: true };
    const untitled = { ...clean, id: "untitled", fileName: "Untitled 1", content: "draft", dirty: true };
    const snapshot = createWorkspaceSession({
      split: true,
      splitRatio: 0.64,
      documents: { clean, dirty, untitled },
      tabs: {
        left: [{ id: "tab-clean", documentId: "clean", pane: "left", order: 0 }],
        right: [
          { id: "tab-dirty", documentId: "dirty", pane: "right", order: 0 },
          { id: "tab-untitled", documentId: "untitled", pane: "right", order: 1 },
        ],
      },
      activeTab: { left: "tab-clean", right: "tab-dirty" },
    }, new Set(["dirty"]));

    expect(snapshot.documents.map((document) => document.id)).toEqual(["clean", "untitled"]);
    expect(snapshot.tabs.right.map((tab) => tab.documentId)).toEqual(["untitled"]);
    expect(snapshot.activeTab.right).toBe("tab-untitled");
    expect(snapshot.split).toBe(true);
    expect(snapshot.splitRatio).toBe(0.64);
  });
});
