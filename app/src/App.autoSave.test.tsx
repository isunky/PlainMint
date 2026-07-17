import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, useAppStore } from "./store";
import type { DocumentRecord, EditorTab } from "./types";

const runtimeMocks = vi.hoisted(() => ({
  saveDocument: vi.fn(),
}));

vi.mock("./services/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/runtime")>();
  return {
    ...actual,
    beginAppSession: vi.fn().mockResolvedValue({ previousExitWasUnclean: false }),
    loadSettings: vi.fn().mockResolvedValue(null),
    loadSession: vi.fn().mockResolvedValue(null),
    loadRecentFiles: vi.fn().mockResolvedValue([]),
    persistSession: vi.fn().mockResolvedValue(undefined),
    persistRecentFiles: vi.fn().mockResolvedValue(undefined),
    pruneRecoveries: vi.fn().mockResolvedValue(undefined),
    writeRecovery: vi.fn().mockResolvedValue(undefined),
    listenForWindowClose: vi.fn().mockResolvedValue(() => undefined),
    saveDocument: runtimeMocks.saveDocument,
  };
});

import { App } from "./App";

function savedDocument(id = "doc-1", revision = 1): DocumentRecord {
  return {
    id,
    filePath: `C:\\${id}.txt`,
    fileName: `${id}.txt`,
    content: `content-${revision}`,
    encoding: "utf-8",
    lineEnding: "lf",
    languageMode: "auto",
    detectedLanguage: "plain",
    autoLanguageDetectionComplete: true,
    dirty: true,
    readOnly: false,
    missing: false,
    externalModified: false,
    revision,
    createdAt: 1,
  };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  runtimeMocks.saveDocument.mockReset().mockImplementation(async (document: DocumentRecord) => ({
    path: document.filePath,
    fingerprint: { modifiedAt: document.revision, size: document.content.length, hash: `hash-${document.revision}` },
    savedAt: document.revision,
  }));
  useAppStore.setState({
    documents: { "doc-1": savedDocument() },
    tabs: { left: [], right: [] },
    activeTab: { left: null, right: null },
    activePane: "left",
    split: false,
    histories: {},
    settings: { ...defaultSettings, autoBackupEnabled: false, autoSaveMode: "off" },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("auto-save runtime triggers", () => {
  it("runs idle, interval, blur, and tab-switch strategies", async () => {
    render(<App />);
    await settle();

    act(() => useAppStore.getState().updateSettings({ autoSaveMode: "idle" }));
    act(() => vi.advanceTimersByTime(9_999));
    expect(runtimeMocks.saveDocument).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(runtimeMocks.saveDocument).toHaveBeenCalledTimes(1);

    act(() => useAppStore.setState({ documents: { "doc-1": savedDocument("doc-1", 2) } }));
    act(() => useAppStore.getState().updateSettings({ autoSaveMode: "interval" }));
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    expect(runtimeMocks.saveDocument).toHaveBeenCalledTimes(2);

    act(() => useAppStore.setState({ documents: { "doc-1": savedDocument("doc-1", 3) } }));
    act(() => useAppStore.getState().updateSettings({ autoSaveMode: "blur" }));
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
      await Promise.resolve();
    });
    expect(runtimeMocks.saveDocument).toHaveBeenCalledTimes(3);

    const first = savedDocument("doc-1", 4);
    const second = savedDocument("doc-2", 1);
    const leftTabs: EditorTab[] = [
      { id: "tab-1", documentId: first.id, pane: "left", order: 0 },
      { id: "tab-2", documentId: second.id, pane: "left", order: 1 },
    ];
    act(() => useAppStore.setState({
      documents: { [first.id]: first, [second.id]: second },
      tabs: { left: leftTabs, right: [] },
      activeTab: { left: "tab-1", right: null },
    }));
    act(() => useAppStore.getState().updateSettings({ autoSaveMode: "tab-switch" }));
    await settle();
    act(() => useAppStore.getState().setActiveTab("left", "tab-2"));
    await settle();
    expect(runtimeMocks.saveDocument).toHaveBeenCalledTimes(4);
    expect(runtimeMocks.saveDocument.mock.calls[3][0].id).toBe("doc-1");
  });

  it("suppresses a failed revision, retries after editing, and deduplicates concurrent triggers", async () => {
    runtimeMocks.saveDocument.mockRejectedValueOnce(new Error("disk full"));
    render(<App />);
    await settle();

    act(() => useAppStore.getState().updateSettings({ autoSaveMode: "idle" }));
    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });
    expect(runtimeMocks.saveDocument).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(20_000);
      await Promise.resolve();
    });
    expect(runtimeMocks.saveDocument).toHaveBeenCalledTimes(1);

    act(() => useAppStore.setState({ documents: { "doc-1": savedDocument("doc-1", 2) } }));
    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });
    expect(runtimeMocks.saveDocument).toHaveBeenCalledTimes(2);

    let finishSave: ((value: unknown) => void) | undefined;
    runtimeMocks.saveDocument.mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve; }));
    act(() => useAppStore.setState({ documents: { "doc-1": savedDocument("doc-1", 3) } }));
    act(() => useAppStore.getState().updateSettings({ autoSaveMode: "blur" }));
    act(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("blur"));
    });
    expect(runtimeMocks.saveDocument).toHaveBeenCalledTimes(3);
    await act(async () => {
      finishSave?.({
        path: "C:\\doc-1.txt",
        fingerprint: { modifiedAt: 3, size: 9, hash: "hash-3" },
        savedAt: 3,
      });
      await Promise.resolve();
    });
  });
});
