import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "./i18n";
import { defaultSettings, useAppStore } from "./store";
import type { DocumentRecord } from "./types";

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
    histories: {},
    settings: { ...defaultSettings, autoBackupEnabled: false },
  });
});

afterEach(cleanup);

describe("tab and split interactions", () => {
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
});
