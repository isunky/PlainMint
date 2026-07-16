import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, useAppStore } from "./store";
import type { DocumentRecord, OpenedDocument } from "./types";

const runtimeMocks = vi.hoisted(() => ({
  inspectFileMetadata: vi.fn(),
  openDocumentPath: vi.fn(),
  syncFileWatches: vi.fn(),
  listenForFileWatchChanges: vi.fn(),
  unlistenFileWatch: vi.fn(),
  saveDocument: vi.fn(),
  fileWatchHandler: undefined as ((paths: string[]) => void) | undefined,
}));

vi.mock("./services/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/runtime")>();
  return {
    ...actual,
    beginAppSession: vi.fn().mockResolvedValue({ previousExitWasUnclean: false }),
    loadSettings: vi.fn().mockResolvedValue(null),
    loadSession: vi.fn().mockResolvedValue(null),
    loadRecentFiles: vi.fn().mockResolvedValue([]),
    loadRecentlyClosedTabs: vi.fn().mockResolvedValue([]),
    persistSession: vi.fn().mockResolvedValue(undefined),
    persistRecentFiles: vi.fn().mockResolvedValue(undefined),
    persistRecentlyClosedTabs: vi.fn().mockResolvedValue(undefined),
    pruneRecoveries: vi.fn().mockResolvedValue(undefined),
    writeRecovery: vi.fn().mockResolvedValue(undefined),
    listenForWindowClose: vi.fn().mockResolvedValue(() => undefined),
    inspectFileMetadata: runtimeMocks.inspectFileMetadata,
    openDocumentPath: runtimeMocks.openDocumentPath,
    syncFileWatches: runtimeMocks.syncFileWatches,
    listenForFileWatchChanges: runtimeMocks.listenForFileWatchChanges,
    saveDocument: runtimeMocks.saveDocument,
  };
});

import { App } from "./App";

function document(id: string, patch: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id,
    filePath: `C:\\Notes\\${id}.txt`,
    fileName: `${id}.txt`,
    content: `local-${id}`,
    encoding: "utf-8",
    lineEnding: "lf",
    dirty: false,
    readOnly: false,
    missing: false,
    externalModified: false,
    revision: 1,
    fingerprint: { modifiedAt: 10, size: 7, hash: `hash-${id}` },
    createdAt: 1,
    ...patch,
  };
}

function opened(id: string, patch: Partial<OpenedDocument> = {}): OpenedDocument {
  return {
    path: `C:\\Notes\\${id}.txt`,
    name: `${id}.txt`,
    content: `local-${id}`,
    encoding: "utf-8",
    lineEnding: "lf",
    readOnly: false,
    fingerprint: { modifiedAt: 10, size: 7, hash: `hash-${id}` },
    ...patch,
  };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  runtimeMocks.fileWatchHandler = undefined;
  runtimeMocks.inspectFileMetadata.mockReset().mockResolvedValue({ exists: true, modifiedAt: 10, size: 7, readOnly: false });
  runtimeMocks.openDocumentPath.mockReset().mockImplementation(async (path: string) => opened(path.includes("beta") ? "beta" : "alpha"));
  runtimeMocks.syncFileWatches.mockReset().mockResolvedValue({ available: true, watchedFiles: 1, watchedDirectories: 1, failedDirectories: [] });
  runtimeMocks.unlistenFileWatch.mockReset();
  runtimeMocks.saveDocument.mockReset().mockImplementation(async (value: DocumentRecord) => ({
    path: value.filePath,
    fingerprint: { modifiedAt: 30, size: value.content.length, hash: "saved" },
    savedAt: 30,
  }));
  runtimeMocks.listenForFileWatchChanges.mockReset().mockImplementation(async (handler: (paths: string[]) => void) => {
    runtimeMocks.fileWatchHandler = handler;
    return runtimeMocks.unlistenFileWatch;
  });
  const alpha = document("alpha");
  useAppStore.setState({
    documents: { alpha },
    tabs: { left: [{ id: "tab-alpha", documentId: "alpha", pane: "left", order: 0 }], right: [] },
    activeTab: { left: "tab-alpha", right: null },
    activePane: "left",
    split: false,
    histories: { alpha: { undo: [], redo: [] } },
    settings: { ...defaultSettings, autoBackupEnabled: false, autoCheckUpdates: false },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("event-driven external file checks", () => {
  it("does not read files at four seconds and uses metadata only at sixty seconds", async () => {
    render(<App />);
    await settle();

    act(() => vi.advanceTimersByTime(59_000));
    expect(runtimeMocks.inspectFileMetadata).not.toHaveBeenCalled();
    expect(runtimeMocks.openDocumentPath).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
    });
    expect(runtimeMocks.inspectFileMetadata).toHaveBeenCalledWith("C:\\Notes\\alpha.txt");
    expect(runtimeMocks.openDocumentPath).not.toHaveBeenCalled();
  });

  it("checks only the event target and reloads a clean changed document", async () => {
    const alpha = document("alpha");
    const beta = document("beta");
    useAppStore.setState((state) => ({
      documents: { alpha, beta },
      tabs: {
        left: [
          { id: "tab-alpha", documentId: "alpha", pane: "left", order: 0 },
          { id: "tab-beta", documentId: "beta", pane: "left", order: 1 },
        ],
        right: [],
      },
      activeTab: { ...state.activeTab, left: "tab-alpha" },
      histories: { alpha: { undo: [], redo: [] }, beta: { undo: [], redo: [] } },
    }));
    runtimeMocks.openDocumentPath.mockResolvedValue(opened("alpha", {
      content: "disk-alpha",
      fingerprint: { modifiedAt: 20, size: 10, hash: "changed-alpha" },
    }));
    render(<App />);
    await settle();

    await act(async () => {
      runtimeMocks.fileWatchHandler?.(["c:/notes/ALPHA.txt"]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runtimeMocks.openDocumentPath).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.openDocumentPath).toHaveBeenCalledWith("C:\\Notes\\alpha.txt");
    expect(useAppStore.getState().documents.alpha.content).toBe("disk-alpha");
    expect(useAppStore.getState().documents.beta.content).toBe("local-beta");
  });

  it("preserves dirty edits and marks an event conflict", async () => {
    useAppStore.setState((state) => ({
      documents: { alpha: { ...state.documents.alpha, dirty: true, content: "unsaved-alpha" } },
    }));
    runtimeMocks.openDocumentPath.mockResolvedValue(opened("alpha", {
      content: "disk-alpha",
      fingerprint: { modifiedAt: 20, size: 10, hash: "changed-alpha" },
    }));
    render(<App />);
    await settle();

    await act(async () => {
      runtimeMocks.fileWatchHandler?.(["C:\\Notes\\alpha.txt"]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useAppStore.getState().documents.alpha.content).toBe("unsaved-alpha");
    expect(useAppStore.getState().documents.alpha.externalModified).toBe(true);
  });

  it("updates watch registration when a document path changes and unregisters the listener", async () => {
    render(<App />);
    await settle();
    expect(runtimeMocks.syncFileWatches).toHaveBeenCalledWith(["C:\\Notes\\alpha.txt"]);

    act(() => useAppStore.setState((state) => ({
      documents: { alpha: { ...state.documents.alpha, filePath: "D:\\Cloud\\alpha.txt" } },
    })));
    await settle();
    expect(runtimeMocks.syncFileWatches).toHaveBeenLastCalledWith(["D:\\Cloud\\alpha.txt"]);

    cleanup();
    expect(runtimeMocks.unlistenFileWatch).toHaveBeenCalledOnce();
    expect(runtimeMocks.syncFileWatches).toHaveBeenLastCalledWith([]);
  });

  it("queues one event check until an in-flight save completes", async () => {
    useAppStore.setState((state) => ({
      documents: { alpha: { ...state.documents.alpha, dirty: true } },
    }));
    let finishSave: ((result: { path: string; fingerprint: { modifiedAt: number; size: number; hash: string }; savedAt: number }) => void) | undefined;
    runtimeMocks.saveDocument.mockReturnValue(new Promise((resolve) => {
      finishSave = resolve;
    }));
    render(<App />);
    await settle();

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await settle();
    runtimeMocks.fileWatchHandler?.(["C:\\Notes\\alpha.txt"]);
    await settle();
    expect(runtimeMocks.openDocumentPath).not.toHaveBeenCalled();

    await act(async () => {
      finishSave?.({
        path: "C:\\Notes\\alpha.txt",
        fingerprint: { modifiedAt: 30, size: 11, hash: "saved" },
        savedAt: 30,
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(runtimeMocks.openDocumentPath).toHaveBeenCalledTimes(1);
  });
});
