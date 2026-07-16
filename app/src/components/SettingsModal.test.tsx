import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { defaultSettings } from "../store";
import { SettingsModal } from "./SettingsModal";

const handlers = {
  onChange: vi.fn(),
  onApply: vi.fn(),
  onCancel: vi.fn(),
  onChooseDirectory: vi.fn(),
  onClearDirectory: vi.fn(),
  onOpenRecovery: vi.fn(),
  onCheckUpdates: vi.fn(),
  onOpenSource: vi.fn(),
};

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
});

afterEach(cleanup);

describe("settings runtime controls", () => {
  it("binds the new-file encoding selector to settings", () => {
    render(<SettingsModal
      settings={{ ...defaultSettings, defaultEncoding: "utf-8-bom" }}
      directoryChecks={{ defaultSaveFolder: { status: "idle" }, cloudSyncFolder: { status: "idle" } }}
      applying={false}
      canApply
      {...handlers}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Files & folders" }));
    const encoding = screen.getByLabelText("New file encoding") as HTMLSelectElement;
    expect(encoding.value).toBe("utf-8-bom");
    fireEvent.change(encoding, { target: { value: "utf-16be" } });
    expect(handlers.onChange).toHaveBeenCalledWith({ defaultEncoding: "utf-16be" });
  });

  it("shows a directory error and prevents applying invalid settings", () => {
    render(<SettingsModal
      settings={{ ...defaultSettings, defaultSaveFolder: "C:\\missing" }}
      directoryChecks={{
        defaultSaveFolder: {
          status: "invalid",
          result: { valid: false, exists: false, isDirectory: false, readable: false, writable: false, availableBytes: 0, errorCode: "not-found" },
        },
        cloudSyncFolder: { status: "idle" },
      }}
      applying={false}
      canApply={false}
      {...handlers}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Files & folders" }));
    expect(screen.getByText("This folder no longer exists.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("explains that the cloud-synced folder is preferred for new files", () => {
    render(<SettingsModal
      settings={{ ...defaultSettings }}
      directoryChecks={{ defaultSaveFolder: { status: "idle" }, cloudSyncFolder: { status: "idle" } }}
      applying={false}
      canApply
      {...handlers}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Files & folders" }));
    expect(screen.getByText("Preferred location for the first save of new files.")).toBeInTheDocument();
    expect(screen.getByText("Used when no available cloud-synced folder is configured.")).toBeInTheDocument();
  });
});
