import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "./i18n";
import { defaultSettings, useAppStore } from "./store";
import type { DocumentRecord } from "./types";

const runtimeMocks = vi.hoisted(() => ({
  checkForUpdates: vi.fn(),
  install: vi.fn(),
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
    getAppVersion: vi.fn().mockResolvedValue("0.1.4"),
    checkForUpdates: runtimeMocks.checkForUpdates,
  };
});

import { App } from "./App";

function dirtyDocument(): DocumentRecord {
  return {
    id: "dirty-document",
    filePath: "C:\\notes.txt",
    fileName: "notes.txt",
    content: "unsaved",
    encoding: "utf-8",
    lineEnding: "lf",
    dirty: true,
    readOnly: false,
    missing: false,
    externalModified: false,
    revision: 1,
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
  vi.useFakeTimers();
  localStorage.clear();
  await i18n.changeLanguage("en");
  runtimeMocks.install.mockReset().mockResolvedValue(undefined);
  runtimeMocks.checkForUpdates.mockReset().mockResolvedValue({
    available: true,
    version: "0.1.5",
    body: "Updater verification",
    install: runtimeMocks.install,
  });
  useAppStore.setState({
    documents: {},
    tabs: { left: [], right: [] },
    activeTab: { left: null, right: null },
    activePane: "left",
    split: false,
    histories: {},
    settings: { ...defaultSettings, autoBackupEnabled: false, autoCheckUpdates: true },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("application updates", () => {
  it("checks after startup and installs an available update", async () => {
    render(<App />);
    await settle();
    await act(async () => vi.advanceTimersByTimeAsync(1_500));

    expect(screen.getByRole("dialog", { name: /PlainMint 0\.1\.5 is ready/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Download and install/ }));
    await settle();

    expect(runtimeMocks.checkForUpdates).toHaveBeenCalledOnce();
    expect(runtimeMocks.install).toHaveBeenCalledOnce();
  });

  it("does not install while a document has unsaved changes", async () => {
    const document = dirtyDocument();
    useAppStore.setState({
      documents: { [document.id]: document },
      tabs: { left: [{ id: "dirty-tab", documentId: document.id, pane: "left", order: 0 }], right: [] },
      activeTab: { left: "dirty-tab", right: null },
    });
    render(<App />);
    await settle();
    await act(async () => vi.advanceTimersByTimeAsync(1_500));

    fireEvent.click(screen.getByRole("button", { name: /Download and install/ }));

    expect(runtimeMocks.install).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Save or discard unsaved changes");
  });
});
