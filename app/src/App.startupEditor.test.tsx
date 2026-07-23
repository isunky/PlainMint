import { act, cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "./i18n";
import { defaultSettings, useAppStore } from "./store";
import type { DocumentRecord } from "./types";

const editorMocks = vi.hoisted(() => ({
  loadTextEditor: vi.fn(),
}));

vi.mock("./editorRuntime", () => ({
  cleanupTextInPane: vi.fn(),
  findNextInPane: vi.fn(),
  findPreviousInPane: vi.fn(),
  focusEditor: vi.fn(),
  goToLineInPane: vi.fn(),
  loadTextEditor: editorMocks.loadTextEditor,
  replaceAllSearchMatchesInPane: vi.fn(),
  replaceCurrentSearchMatchInPane: vi.fn(),
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
  };
});

import { App } from "./App";

function startupDocument(content: string): DocumentRecord {
  return {
    id: "startup-document",
    filePath: "C:\\Notes\\startup.txt",
    fileName: "startup.txt",
    content,
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

beforeEach(async () => {
  vi.useFakeTimers();
  localStorage.clear();
  await i18n.changeLanguage("en");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("startup editor preparation", () => {
  it("preloads immediately, previews memory content, and swaps editors without changing the document", async () => {
    const content = "Visible immediately\n" + "x".repeat(70_000);
    const document = startupDocument(content);
    let resolveEditor!: (module: { TextEditor: (props: { document: DocumentRecord }) => ReactElement }) => void;
    const editorPromise = new Promise<{ TextEditor: (props: { document: DocumentRecord }) => ReactElement }>((resolve) => {
      resolveEditor = resolve;
    });
    editorMocks.loadTextEditor.mockReset().mockReturnValue(editorPromise);
    useAppStore.setState({
      documents: { [document.id]: document },
      tabs: { left: [{ id: "startup-tab", documentId: document.id, pane: "left", order: 0 }], right: [] },
      activeTab: { left: "startup-tab", right: null },
      activePane: "left",
      split: false,
      histories: {},
      settings: { ...defaultSettings, autoBackupEnabled: false },
    });

    const { container } = render(<App />);
    const preview = container.querySelector(".editor-startup-preview");
    const previewText = preview?.querySelector("pre")?.textContent ?? "";

    expect(editorMocks.loadTextEditor).toHaveBeenCalledOnce();
    expect(preview).toHaveClass("with-gutter", "wrap");
    expect(previewText).toHaveLength(64_000);
    expect(previewText.startsWith("Visible immediately")).toBe(true);
    expect(container).not.toHaveTextContent("Preparing editor");

    await act(async () => {
      resolveEditor({
        TextEditor: ({ document: loadedDocument }) => <div data-testid="loaded-editor">{loadedDocument.content}</div>,
      });
      await editorPromise;
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='loaded-editor']")).toHaveTextContent("Visible immediately");
    expect(useAppStore.getState().documents[document.id]).toBe(document);
    expect(useAppStore.getState().histories).toEqual({});
  });
});
