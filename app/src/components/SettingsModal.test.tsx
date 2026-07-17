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
  onOpenAuthorWebsite: vi.fn(),
};

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
});

afterEach(cleanup);

describe("settings runtime controls", () => {
  it("groups language settings with appearance", () => {
    render(<SettingsModal
      settings={{ ...defaultSettings, locale: "system" }}
      directoryChecks={{ defaultSaveFolder: { status: "idle" }, cloudSyncFolder: { status: "idle" } }}
      applying={false}
      canApply
      {...handlers}
    />);

    expect(screen.queryByLabelText("Language")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    const language = screen.getByLabelText("Language") as HTMLSelectElement;
    expect(language.value).toBe("system");

    fireEvent.change(language, { target: { value: "zh-CN" } });
    expect(handlers.onChange).toHaveBeenCalledWith({ locale: "zh-CN" });
  });

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

  it("binds the new-file line-ending selector to settings", () => {
    render(<SettingsModal
      settings={{ ...defaultSettings, defaultLineEnding: "crlf" }}
      directoryChecks={{ defaultSaveFolder: { status: "idle" }, cloudSyncFolder: { status: "idle" } }}
      applying={false}
      canApply
      {...handlers}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Files & folders" }));
    const lineEnding = screen.getByLabelText("New file line ending") as HTMLSelectElement;
    expect(lineEnding.value).toBe("crlf");
    fireEvent.change(lineEnding, { target: { value: "cr" } });
    expect(handlers.onChange).toHaveBeenCalledWith({ defaultLineEnding: "cr" });
  });

  it("keeps spell check disabled by default and exposes the toggle in editor settings", () => {
    render(<SettingsModal
      settings={{ ...defaultSettings }}
      directoryChecks={{ defaultSaveFolder: { status: "idle" }, cloudSyncFolder: { status: "idle" } }}
      applying={false}
      canApply
      {...handlers}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    const spellCheck = screen.getByRole("switch", { name: "Spell check" });
    expect(spellCheck).toHaveAttribute("aria-checked", "false");
    fireEvent.click(spellCheck);
    expect(handlers.onChange).toHaveBeenCalledWith({ spellCheckEnabled: true });
  });

  it("shows shortcuts on their own page before the about page", () => {
    const { container } = render(<SettingsModal
      settings={{ ...defaultSettings }}
      directoryChecks={{ defaultSaveFolder: { status: "idle" }, cloudSyncFolder: { status: "idle" } }}
      applying={false}
      canApply
      {...handlers}
    />);

    expect(Array.from(container.querySelectorAll(".settings-sidebar nav button")).map((button) => button.textContent)).toEqual([
      "General", "Editor", "Files & folders", "Backup & recovery", "Appearance", "Keyboard shortcuts", "About",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    expect(screen.getAllByRole("heading", { name: "Keyboard shortcuts" })).toHaveLength(2);
    expect(screen.getByText("Go to line")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "About" }));
    expect(screen.queryByRole("heading", { name: "Keyboard shortcuts" })).not.toBeInTheDocument();
    expect(screen.getByText("Current version 0.1.0")).toBeInTheDocument();
    expect(container.querySelector(".about-author")).toHaveTextContent("Author: Sunky");
    const website = screen.getByRole("link", { name: "http://www.sunky.net" });
    expect(website).toHaveAttribute("href", "http://www.sunky.net");
    fireEvent.click(website);
    expect(handlers.onOpenAuthorWebsite).toHaveBeenCalledOnce();
  });

  it("opens hidden help from the title bar without adding it to the sidebar", () => {
    const { container } = render(<SettingsModal
      settings={{ ...defaultSettings }}
      directoryChecks={{ defaultSaveFolder: { status: "idle" }, cloudSyncFolder: { status: "idle" } }}
      applying={false}
      canApply
      {...handlers}
    />);

    expect(Array.from(container.querySelectorAll(".settings-sidebar nav button")).map((button) => button.textContent)).not.toContain("Help");
    const help = screen.getByRole("button", { name: "Help" });
    fireEvent.click(help);

    expect(screen.getByRole("heading", { name: "Help" })).toBeInTheDocument();
    expect(screen.getByText("Getting started")).toBeInTheDocument();
    expect(screen.getByText("New documents are numbered until you choose a location with Save or Save as.")).toBeInTheDocument();
    expect(screen.getByText("Troubleshooting")).toBeInTheDocument();

    fireEvent.click(help);
    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
  });

  it("links hidden help to shortcuts and recovery", () => {
    render(<SettingsModal
      settings={{ ...defaultSettings }}
      directoryChecks={{ defaultSaveFolder: { status: "idle" }, cloudSyncFolder: { status: "idle" } }}
      applying={false}
      canApply
      {...handlers}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Keyboard shortcuts" })[1]);
    expect(screen.getAllByRole("heading", { name: "Keyboard shortcuts" })).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.click(screen.getByRole("button", { name: "Open recovery center" }));
    expect(handlers.onOpenRecovery).toHaveBeenCalledOnce();
  });

  it("shows update results inside the about page", () => {
    render(<SettingsModal
      settings={{ ...defaultSettings }}
      directoryChecks={{ defaultSaveFolder: { status: "idle" }, cloudSyncFolder: { status: "idle" } }}
      applying={false}
      canApply
      updateCheckStatus="latest"
      {...handlers}
    />);

    fireEvent.click(screen.getByRole("button", { name: "About" }));
    expect(screen.getByText("You are using the latest version.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(handlers.onCheckUpdates).toHaveBeenCalledOnce();
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
