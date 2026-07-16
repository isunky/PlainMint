import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "./i18n";
import { defaultSettings, useAppStore } from "./store";
import type { DocumentRecord, OpenedDocument } from "./types";

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
    revealFileInDirectory: vi.fn().mockResolvedValue(undefined),
    writeRecovery: vi.fn().mockResolvedValue(undefined),
    listenForWindowClose: vi.fn().mockResolvedValue(() => undefined),
    chooseComparisonDocument: vi.fn(),
  };
});

import { App } from "./App";
import { selectNextOccurrenceInPane } from "./components/TextEditor";
import { chooseComparisonDocument, loadRecentFiles, persistRecentFiles, revealFileInDirectory } from "./services/runtime";

function doc(id: string): DocumentRecord {
  return {
    id,
    filePath: `C:\\${id}.txt`,
    fileName: `${id}.txt`,
    content: id,
    encoding: "utf-8",
    lineEnding: "lf",
    dirty: false,
    readOnly: false,
    missing: false,
    externalModified: false,
    revision: 0,
    createdAt: 1,
  };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage("en");
  useAppStore.setState({
    documents: { a: doc("a"), b: doc("b") },
    tabs: {
      left: [
        { id: "tab-a", documentId: "a", pane: "left", order: 0 },
        { id: "tab-b", documentId: "b", pane: "left", order: 1 },
      ],
      right: [],
    },
    activeTab: { left: "tab-a", right: null },
    activePane: "left",
    split: false,
    splitRatio: 0.5,
    recentlyClosedTabs: [],
    search: { open: false, replaceOpen: false, query: "", replacement: "", caseSensitive: false, wholeWord: false, regexp: false },
    histories: {},
    settings: { ...defaultSettings, autoBackupEnabled: false },
  });
  vi.mocked(loadRecentFiles).mockResolvedValue([]);
  vi.mocked(revealFileInDirectory).mockResolvedValue(undefined);
  vi.mocked(chooseComparisonDocument).mockResolvedValue(null);
});

afterEach(cleanup);

describe("tab and split interactions", () => {
  it("compares the current unsaved content with one selected file and closes with Escape", async () => {
    const selected: OpenedDocument = {
      path: "D:\\Reference\\a.txt",
      name: "a.txt",
      content: "alpha\nsame\ndisk\nsame\ntarget",
      encoding: "utf-8",
      lineEnding: "crlf",
      readOnly: false,
    };
    useAppStore.setState((state) => ({ documents: { ...state.documents, a: { ...state.documents.a, content: "alpha\nsame\nlocal\nsame\nomega", dirty: true } } }));
    vi.mocked(chooseComparisonDocument).mockResolvedValue(selected);

    const { container } = render(<App />);
    await settle();
    fireEvent.keyDown(window, { key: "d", ctrlKey: true, shiftKey: true });
    await settle();

    expect(chooseComparisonDocument).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog", { name: "Compare text files" })).toBeInTheDocument();
    expect(container.textContent).toContain("alpha");
    expect(container.textContent).toContain("D:\\Reference\\a.txt");
    expect(container.textContent).toContain("UTF-8 · CRLF");
    expect(screen.getByText("Difference 1 of 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next difference" }));
    expect(screen.getByText("Difference 2 of 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Previous difference" }));
    expect(screen.getByText("Difference 1 of 2")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Compare text files" })).not.toBeInTheDocument();
  });

  it("disables comparison when no document is active and reports a read failure", async () => {
    useAppStore.setState({ documents: {}, tabs: { left: [], right: [] }, activeTab: { left: null, right: null } });
    const { unmount } = render(<App />);
    await settle();
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
    unmount();

    useAppStore.setState({
      documents: { a: doc("a") },
      tabs: { left: [{ id: "tab-a", documentId: "a", pane: "left", order: 0 }], right: [] },
      activeTab: { left: "tab-a", right: null },
    });
    vi.mocked(chooseComparisonDocument).mockRejectedValue(new Error("read failed"));
    render(<App />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("could not be read for comparison");
  });

  it("supports context-menu bulk close and double-click new tab", async () => {
    const { container } = render(<App />);
    await settle();

    fireEvent.contextMenu(screen.getByRole("tab", { name: /a\.txt/i }), { clientX: 24, clientY: 24 });
    fireEvent.click(screen.getByRole("menuitem", { name: /Close other tabs/ }));
    expect(useAppStore.getState().tabs.left.map((tab) => tab.id)).toEqual(["tab-a"]);
    expect(useAppStore.getState().recentlyClosedTabs[0]?.path).toBe("C:\\b.txt");

    fireEvent.keyDown(window, { key: "t", ctrlKey: true, shiftKey: true });
    await settle();
    expect(useAppStore.getState().recentlyClosedTabs).toEqual([]);
    expect(Object.values(useAppStore.getState().documents).some((document) => document.filePath === "C:\\b.txt")).toBe(true);

    const countBefore = useAppStore.getState().tabs.left.length;
    fireEvent.doubleClick(container.querySelector('[data-tabbar-pane="left"]') as HTMLElement);
    expect(useAppStore.getState().tabs.left).toHaveLength(countBefore + 1);
  });

  it("uses one confirmation dialog for bulk-closing unsaved tabs", async () => {
    useAppStore.setState({ documents: { a: doc("a"), b: { ...doc("b"), dirty: true, content: "unsaved" } } });
    render(<App />);
    await settle();

    fireEvent.contextMenu(screen.getByRole("tab", { name: /a\.txt/i }), { clientX: 24, clientY: 24 });
    fireEvent.click(screen.getByRole("menuitem", { name: /Close other tabs/ }));
    expect(screen.getByRole("alertdialog", { name: "Close these tabs?" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Discard all and close" }));

    expect(useAppStore.getState().tabs.left.map((tab) => tab.id)).toEqual(["tab-a"]);
  });

  it("cycles tabs with the keyboard and resizes split panes accessibly", async () => {
    const { container, rerender } = render(<App />);
    await settle();

    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });
    expect(useAppStore.getState().activeTab.left).toBe("tab-b");

    act(() => useAppStore.setState({
      split: true,
      tabs: {
        ...useAppStore.getState().tabs,
        right: [{ id: "tab-a-right", documentId: "a", pane: "right", order: 0 }],
      },
      activeTab: { ...useAppStore.getState().activeTab, right: "tab-a-right" },
    }));
    rerender(<App />);
    vi.spyOn(container.querySelector(".workspace") as HTMLElement, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700, toJSON: () => ({}),
    });
    const separator = screen.getByRole("separator", { name: "Resize editor panes" });
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(useAppStore.getState().splitRatio).toBeGreaterThan(0.5);
  });

  it("reveals saved files from the tab context menu", async () => {
    render(<App />);
    await settle();

    fireEvent.contextMenu(screen.getByRole("tab", { name: /a\.txt/i }), { clientX: 24, clientY: 24 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Show in File Explorer" }));

    expect(revealFileInDirectory).toHaveBeenCalledWith("C:\\a.txt");
  });

  it("shows search options in find mode and applies them to matches", async () => {
    useAppStore.setState({ documents: { a: { ...doc("a"), content: "Cat cat catalog" }, b: doc("b") } });
    render(<App />);
    await settle();

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    fireEvent.change(screen.getByPlaceholderText("Find"), { target: { value: "cat" } });
    expect(screen.getByText("1 of 3")).toBeVisible();

    fireEvent.click(screen.getByLabelText("Whole word"));
    expect(screen.getByText("1 of 2")).toBeVisible();
    fireEvent.click(screen.getByLabelText("Case sensitive"));
    expect(screen.getByText("1 of 1")).toBeVisible();
  });

  it("changes the active document format from the status bar", async () => {
    render(<App />);
    await settle();

    fireEvent.change(screen.getByLabelText("File encoding"), { target: { value: "utf-16be" } });
    fireEvent.change(screen.getByLabelText("File line ending"), { target: { value: "crlf" } });

    expect(useAppStore.getState().documents.a).toMatchObject({ encoding: "utf-16be", lineEnding: "crlf", dirty: true, revision: 2 });
  });

  it("removes and clears recent files without opening them", async () => {
    useAppStore.setState({
      documents: {},
      tabs: { left: [], right: [] },
      activeTab: { left: null, right: null },
    });
    vi.mocked(loadRecentFiles).mockResolvedValue(["C:\\a.txt", "C:\\b.txt"]);
    render(<App />);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Remove a.txt from recent files" }));
    expect(persistRecentFiles).toHaveBeenLastCalledWith(["C:\\b.txt"]);

    fireEvent.click(screen.getByRole("button", { name: "Clear recent files" }));
    expect(persistRecentFiles).toHaveBeenLastCalledWith([]);
    expect(screen.getByText("Recent files will appear here.")).toBeVisible();
  });

  it("supports regular-expression replacement with capture groups", async () => {
    useAppStore.setState({ documents: { ...useAppStore.getState().documents, a: { ...doc("a"), content: "port=80\nhost=localhost" } } });
    render(<App />);
    await settle();

    fireEvent.keyDown(window, { key: "h", ctrlKey: true });
    fireEvent.change(screen.getByPlaceholderText("Find"), { target: { value: "([a-z]+)=(.+)" } });
    fireEvent.change(screen.getByPlaceholderText("Replace with"), { target: { value: "$1: $2" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Regular expression" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));

    expect(useAppStore.getState().documents.a.content).toBe("port: 80\nhost: localhost");
  });

  it("adds selections for the next matching occurrence", async () => {
    useAppStore.setState({ documents: { ...useAppStore.getState().documents, a: { ...doc("a"), content: "alpha alpha" } } });
    render(<App />);
    await settle();

    expect(selectNextOccurrenceInPane("left")).toBe(1);
    expect(selectNextOccurrenceInPane("left")).toBe(2);
  });
});
