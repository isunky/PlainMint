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

  it("lets users choose separate Latin and CJK editor fonts", () => {
    render(<SettingsModal
      settings={{ ...defaultSettings }}
      directoryChecks={{ defaultSaveFolder: { status: "idle" }, cloudSyncFolder: { status: "idle" } }}
      applying={false}
      canApply
      {...handlers}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    const latinFont = screen.getByLabelText("Latin font") as HTMLSelectElement;
    const cjkFont = screen.getByLabelText("Chinese / CJK font") as HTMLSelectElement;
    expect(latinFont.value).toBe("system-monospace");
    expect(cjkFont.value).toBe("system-cjk");
    expect(screen.getByText("PlainMint uses the Latin font first, then falls back to the selected Chinese / CJK font for Chinese characters.")).toBeInTheDocument();

    fireEvent.change(latinFont, { target: { value: "JetBrains Mono" } });
    fireEvent.change(cjkFont, { target: { value: "PingFang SC" } });
    expect(handlers.onChange).toHaveBeenCalledWith({ latinFontFamily: "JetBrains Mono" });
    expect(handlers.onChange).toHaveBeenCalledWith({ cjkFontFamily: "PingFang SC" });
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
    expect(screen.getByLabelText("Current version")).toHaveTextContent("v0.1.0");
    expect(screen.getByLabelText("Author")).toHaveTextContent("Sunky");
    const website = screen.getByRole("link", { name: "http://www.sunky.net" });
    expect(website).toHaveAttribute("href", "http://www.sunky.net");
    fireEvent.click(website);
    expect(handlers.onOpenAuthorWebsite).toHaveBeenCalledOnce();
  });

  it("keeps contextual help in hoverable setting icons", () => {
    render(<SettingsModal
      settings={{ ...defaultSettings }}
      directoryChecks={{ defaultSaveFolder: { status: "idle" }, cloudSyncFolder: { status: "idle" } }}
      applying={false}
      canApply
      {...handlers}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Files & folders" }));
    expect(screen.getAllByRole("img", { name: "These defaults apply only to new files. Opened files keep their original encoding and line ending." })).toHaveLength(2);
    expect(screen.getByRole("img", { name: "Preferred location for the first save of new files. OneDrive, iCloud, or Dropbox performs the actual sync." })).toBeInTheDocument();
    const helpIcon = screen.getByRole("img", { name: "Preferred location for the first save of new files. OneDrive, iCloud, or Dropbox performs the actual sync." });
    fireEvent.pointerEnter(helpIcon);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Preferred location for the first save of new files. OneDrive, iCloud, or Dropbox performs the actual sync.");
    expect(screen.getByRole("tooltip").parentElement).toBe(document.body);

    fireEvent.click(screen.getByRole("button", { name: "Backup & recovery" }));
    expect(screen.getByRole("img", { name: "Recovery copies protect unsaved work. Open the recovery center to inspect or restore available copies." })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    expect(screen.getByRole("img", { name: "This changes the PlainMint interface language only; it does not change your document content." })).toBeInTheDocument();
  });

  it("shows a removable Windows context-menu integration when supported", () => {
    const onContextMenuChange = vi.fn();
    render(<SettingsModal
      settings={{ ...defaultSettings }}
      directoryChecks={{ defaultSaveFolder: { status: "idle" }, cloudSyncFolder: { status: "idle" } }}
      applying={false}
      canApply
      contextMenuStatus={{ supported: true, enabled: false }}
      onContextMenuChange={onContextMenuChange}
      {...handlers}
    />);

    const toggle = screen.getByRole("switch", { name: "File Explorer context menu" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(onContextMenuChange).toHaveBeenCalledWith(true);
  });

  it("restores only the active settings page to its defaults before applying", () => {
    const onChange = vi.fn();
    render(<SettingsModal
      settings={{ ...defaultSettings, fontSize: 20, defaultEncoding: "utf-16le", recentFileLimit: 8 }}
      directoryChecks={{ defaultSaveFolder: { status: "idle" }, cloudSyncFolder: { status: "idle" } }}
      applying={false}
      canApply
      {...handlers}
      onChange={onChange}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Restore defaults" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ autoBackupEnabled: true, wordWrapByDefault: true, autoCheckUpdates: true }));
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ fontSize: 14 }));

    fireEvent.click(screen.getByRole("button", { name: "Files & folders" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore defaults" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ defaultEncoding: "utf-8", defaultLineEnding: "lf", recentFileLimit: 20 }));
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

  it("attaches cloud and default folder help to their setting labels", () => {
    render(<SettingsModal
      settings={{ ...defaultSettings }}
      directoryChecks={{ defaultSaveFolder: { status: "idle" }, cloudSyncFolder: { status: "idle" } }}
      applying={false}
      canApply
      {...handlers}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Files & folders" }));
    expect(screen.getByRole("img", { name: "Preferred location for the first save of new files. OneDrive, iCloud, or Dropbox performs the actual sync." })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Used when no available cloud-synced folder is configured." })).toBeInTheDocument();
  });
});
