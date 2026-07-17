import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowsClockwise,
  CloudArrowUp,
  FolderSimple,
  GearSix,
  Info,
  Keyboard,
  PaintBrush,
  PencilSimple,
  Question,
  ShieldCheck,
  X,
} from "@phosphor-icons/react";
import type { AccentTheme, AppLocale, AppearanceMode, ContextMenuStatus, DirectoryValidationResult, Encoding, LineEnding, UserSettings } from "../types";
import { cjkFontOptions, latinFontOptions, systemCjkFont, systemMonospaceFont } from "../fontSettings";
import { defaultSettings } from "../store";

type SettingsSection = "general" | "editor" | "files" | "backup" | "appearance" | "shortcuts" | "about";

const resettableSections = new Set<SettingsSection>(["general", "editor", "files", "backup", "appearance"]);

function defaultsForSection(section: SettingsSection): Partial<UserSettings> {
  switch (section) {
    case "general":
      return pickDefaults("autoBackupEnabled", "sessionRecoveryMode", "wordWrapByDefault", "showLineNumbers", "autoCheckUpdates");
    case "editor":
      return pickDefaults("fontFamily", "latinFontFamily", "cjkFontFamily", "fontSize", "lineHeight", "tabSize", "highlightCurrentLine", "spellCheckEnabled");
    case "files":
      return pickDefaults("defaultSaveFolder", "cloudSyncFolder", "defaultEncoding", "defaultLineEnding", "recentFileLimit");
    case "backup":
      return pickDefaults("backupDebounceSeconds", "backupRetentionDays", "maxBackupVersionsPerFile", "autoSaveMode", "sessionRecoveryMode");
    case "appearance":
      return pickDefaults("appearanceMode", "accentTheme", "locale");
    default:
      return {};
  }
}

function pickDefaults<K extends keyof UserSettings>(...keys: K[]): Pick<UserSettings, K> {
  return Object.fromEntries(keys.map((key) => [key, defaultSettings[key]])) as Pick<UserSettings, K>;
}

interface SettingsModalProps {
  settings: UserSettings;
  directoryChecks: Record<"defaultSaveFolder" | "cloudSyncFolder", {
    status: "idle" | "checking" | "valid" | "invalid";
    result?: DirectoryValidationResult;
  }>;
  applying: boolean;
  canApply: boolean;
  currentVersion?: string;
  checkingForUpdates?: boolean;
  updateCheckStatus?: "idle" | "latest" | "failed";
  onChange: (patch: Partial<UserSettings>) => void;
  onApply: () => void;
  onCancel: () => void;
  onChooseDirectory: (field: "defaultSaveFolder" | "cloudSyncFolder") => void;
  onClearDirectory: (field: "defaultSaveFolder" | "cloudSyncFolder") => void;
  onOpenRecovery: () => void;
  onCheckUpdates: () => void;
  onOpenSource: () => void;
  onOpenAuthorWebsite: () => void;
  contextMenuStatus?: ContextMenuStatus;
  contextMenuBusy?: boolean;
  onContextMenuChange?: (enabled: boolean) => void;
}

function formatBytes(bytes: number, locale: string) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit > 1 ? 1 : 0 }).format(value)} ${units[unit]}`;
}

const accentValues: Record<AccentTheme, string> = {
  tiffany: "#18B7AA",
  graphite: "#4B5563",
  amber: "#E59A20",
  coral: "#E96F61",
  iris: "#8B6FD6",
};

function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={"switch " + (checked ? "switch-on" : "")}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function SettingToggle({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="setting-row setting-toggle-row">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

function HelpTip({ text }: { text: string }) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; placement: "above" | "below" } | null>(null);
  const visible = hovered || focused;

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const horizontalInset = 168;
    const left = Math.min(Math.max(rect.left + rect.width / 2, horizontalInset), window.innerWidth - horizontalInset);
    const placement = rect.bottom + 96 > window.innerHeight ? "above" : "below";
    setPosition({ left, top: placement === "above" ? rect.top - 8 : rect.bottom + 8, placement });
  };

  useEffect(() => {
    if (!visible) return;
    updatePosition();
    const reposition = () => updatePosition();
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    };
  }, [visible]);

  return (
    <span className="setting-help" onPointerEnter={() => { setHovered(true); updatePosition(); }} onPointerLeave={() => setHovered(false)}>
      <span ref={triggerRef} className="setting-help-trigger" role="img" tabIndex={0} aria-label={text} aria-describedby={visible ? tooltipId : undefined} onFocus={() => { setFocused(true); updatePosition(); }} onBlur={() => setFocused(false)}>
        <Question size={14} weight="bold" />
      </span>
      {visible && position && createPortal(
        <span
          id={tooltipId}
          className="setting-help-tooltip"
          data-placement={position.placement}
          role="tooltip"
          style={{ left: position.left, top: position.top }}
        >{text}</span>,
        document.body,
      )}
    </span>
  );
}

export function SettingsModal({
  settings,
  directoryChecks,
  applying,
  canApply,
  currentVersion = "0.1.0",
  checkingForUpdates = false,
  updateCheckStatus = "idle",
  onChange,
  onApply,
  onCancel,
  onChooseDirectory,
  onClearDirectory,
  onOpenRecovery,
  onCheckUpdates,
  onOpenSource,
  onOpenAuthorWebsite,
  contextMenuStatus = { supported: false, enabled: false },
  contextMenuBusy = false,
  onContextMenuChange,
}: SettingsModalProps) {
  const { t, i18n } = useTranslation();
  const [section, setSection] = useState<SettingsSection>("general");
  const navigation: Array<{ id: SettingsSection; label: string; icon: typeof GearSix }> = [
    { id: "general", label: t("general"), icon: GearSix },
    { id: "editor", label: t("editor"), icon: PencilSimple },
    { id: "files", label: t("filesFolders"), icon: FolderSimple },
    { id: "backup", label: t("backupRecovery"), icon: CloudArrowUp },
    { id: "appearance", label: t("appearance"), icon: PaintBrush },
    { id: "shortcuts", label: t("keyboardShortcuts"), icon: Keyboard },
    { id: "about", label: t("about"), icon: Info },
  ];
  const sectionTitle = navigation.find((item) => item.id === section)?.label;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label={t("settings")}>
        <aside className="settings-sidebar">
          <h2>{t("settings")}</h2>
          <nav>
            {navigation.map(({ id, label, icon: Icon }) => (
              <button
                type="button"
                key={id}
                className={section === id ? "active" : ""}
                onClick={() => setSection(id)}
              >
                <Icon size={20} weight="regular" />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </aside>
        <div className="settings-content">
          <header>
            <h3>{sectionTitle}</h3>
            <div className="settings-header-actions">
              {resettableSections.has(section) && (
                <button type="button" className="button-secondary settings-reset-button" disabled={applying} onClick={() => onChange(defaultsForSection(section))}>{t("restoreDefaults")}</button>
              )}
              <button type="button" className="icon-button close-settings" disabled={applying} onClick={onCancel} aria-label={t("close")}>
                <X size={19} />
              </button>
            </div>
          </header>

          <div className="settings-scroll">
            {section === "general" && (
              <div className="settings-grid">
                <section className="settings-card settings-card-wide">
                  <h4>{t("behavior")}</h4>
                  <SettingToggle
                    title={t("autoBackup")}
                    description={t("autoBackupDescription")}
                    checked={settings.autoBackupEnabled}
                    onChange={(value) => onChange({ autoBackupEnabled: value })}
                  />
                  <SettingToggle
                    title={t("sessionRecovery")}
                    description={t("sessionRecoveryDescription")}
                    checked={settings.sessionRecoveryMode !== "empty"}
                    onChange={(value) => onChange({ sessionRecoveryMode: value ? "ask" : "empty" })}
                  />
                  <SettingToggle
                    title={t("wordWrapDefault")}
                    description={t("wordWrapDescription")}
                    checked={settings.wordWrapByDefault}
                    onChange={(value) => onChange({ wordWrapByDefault: value })}
                  />
                  <SettingToggle
                    title={t("showLineNumbers")}
                    description={t("lineNumbersDescription")}
                    checked={settings.showLineNumbers}
                    onChange={(value) => onChange({ showLineNumbers: value })}
                  />
                  <SettingToggle
                    title={t("autoCheckUpdates")}
                    description={t("autoCheckDescription")}
                    checked={settings.autoCheckUpdates}
                    onChange={(value) => onChange({ autoCheckUpdates: value })}
                  />
                  {contextMenuStatus.supported && (
                    <SettingToggle
                      title={t("contextMenuIntegration")}
                      description={t("contextMenuDescription")}
                      checked={contextMenuStatus.enabled}
                      disabled={contextMenuBusy}
                      onChange={(value) => onContextMenuChange?.(value)}
                    />
                  )}
                </section>
              </div>
            )}

            {section === "editor" && (
              <div className="settings-grid">
                <section className="settings-card settings-card-wide">
                  <h4>{t("editor")}</h4>
                  <div className="field-grid">
                    <label className="field-label">
                      <span>{t("latinFont")}</span>
                      <select value={settings.latinFontFamily} onChange={(event) => onChange({ latinFontFamily: event.target.value })}>
                        {latinFontOptions.map((font) => (
                          <option value={font} key={font}>{font === systemMonospaceFont ? t("systemMonospaceFont") : font === "SFMono-Regular" ? "SF Mono" : font}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field-label">
                      <span>{t("cjkFont")}</span>
                      <select value={settings.cjkFontFamily} onChange={(event) => onChange({ cjkFontFamily: event.target.value })}>
                        {cjkFontOptions.map((font) => (
                          <option value={font} key={font}>{font === systemCjkFont ? t("systemCjkFont") : font}</option>
                        ))}
                      </select>
                    </label>
                    <p className="editor-font-hint">{t("editorFontHint")}</p>
                    <label className="field-label">
                      <span>{t("fontSize")}</span>
                      <input type="number" min={10} max={28} value={settings.fontSize} onChange={(event) => onChange({ fontSize: Number(event.target.value) })} />
                    </label>
                    <label className="field-label">
                      <span>{t("lineHeight")}</span>
                      <input type="number" min={1.2} max={2} step={0.05} value={settings.lineHeight} onChange={(event) => onChange({ lineHeight: Number(event.target.value) })} />
                    </label>
                    <label className="field-label">
                      <span>{t("tabSize")}</span>
                      <input type="number" min={2} max={8} value={settings.tabSize} onChange={(event) => onChange({ tabSize: Number(event.target.value) })} />
                    </label>
                  </div>
                  <SettingToggle
                    title={t("currentLine")}
                    description={t("lineNumbersDescription")}
                    checked={settings.highlightCurrentLine}
                    onChange={(value) => onChange({ highlightCurrentLine: value })}
                  />
                  <SettingToggle
                    title={t("spellCheck")}
                    description={t("spellCheckDescription")}
                    checked={settings.spellCheckEnabled}
                    onChange={(value) => onChange({ spellCheckEnabled: value })}
                  />
                </section>
              </div>
            )}

            {section === "files" && (
              <div className="settings-grid">
                <section className="settings-card settings-card-wide">
                  <h4>{t("filesFolders")}</h4>
                  {(["defaultSaveFolder", "cloudSyncFolder"] as const).map((field) => (
                    <div className="field-label" key={field}>
                      <span className="field-label-title">
                        {t(field === "defaultSaveFolder" ? "defaultFolder" : "cloudFolder")}
                        <HelpTip text={t(field === "defaultSaveFolder" ? "defaultFolderHint" : "cloudFolderHint")} />
                      </span>
                      <div className="path-field">
                        <input aria-label={t(field === "defaultSaveFolder" ? "defaultFolder" : "cloudFolder")} value={settings[field] ?? ""} readOnly />
                        <button type="button" className="button-secondary" disabled={applying} aria-label={t("chooseFolder")} onClick={() => onChooseDirectory(field)}>…</button>
                        {settings[field] && <button type="button" className="button-secondary clear-path" disabled={applying} onClick={() => onClearDirectory(field)}>{t("clear")}</button>}
                      </div>
                      {directoryChecks[field].status === "checking" && <small className="directory-status checking">{t("directoryChecking")}</small>}
                      {directoryChecks[field].status === "valid" && directoryChecks[field].result && (
                        <small className="directory-status valid">{t("directoryAvailable", { space: formatBytes(directoryChecks[field].result.availableBytes, i18n.language) })}</small>
                      )}
                      {directoryChecks[field].status === "invalid" && (
                        <small className="directory-status invalid">{t(`directoryError_${directoryChecks[field].result?.errorCode ?? "unavailable"}`)}</small>
                      )}
                    </div>
                  ))}
                  <div className="field-grid">
                    <label className="field-label">
                      <span className="field-label-title">{t("encoding")}<HelpTip text={t("newFileDefaultsHint")} /></span>
                      <select aria-label={t("encoding")} value={settings.defaultEncoding} onChange={(event) => onChange({ defaultEncoding: event.target.value as Encoding })}><option value="utf-8">UTF-8</option><option value="utf-8-bom">UTF-8 BOM</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option></select>
                    </label>
                    <label className="field-label">
                      <span className="field-label-title">{t("lineEnding")}<HelpTip text={t("newFileDefaultsHint")} /></span>
                      <select aria-label={t("lineEnding")} value={settings.defaultLineEnding} onChange={(event) => onChange({ defaultLineEnding: event.target.value as LineEnding })}><option value="lf">LF</option><option value="crlf">CRLF</option><option value="cr">CR</option></select>
                    </label>
                    <label className="field-label">
                      <span>{t("recentFiles")}</span>
                      <input type="number" min={5} max={50} value={settings.recentFileLimit} onChange={(event) => onChange({ recentFileLimit: Number(event.target.value) })} />
                    </label>
                  </div>
                </section>
              </div>
            )}

            {section === "backup" && (
              <div className="settings-grid">
                <section className="settings-card settings-card-wide">
                  <h4>{t("backupRecovery")}<HelpTip text={t("backupRecoveryHint")} /></h4>
                  <div className="field-grid">
                    <label className="field-label"><span>{t("backupDelay")}</span><input type="number" min={1} max={60} value={settings.backupDebounceSeconds} onChange={(event) => onChange({ backupDebounceSeconds: Number(event.target.value) })} /></label>
                    <label className="field-label"><span>{t("backupRetention")}</span><input type="number" min={1} max={365} value={settings.backupRetentionDays} onChange={(event) => onChange({ backupRetentionDays: Number(event.target.value) })} /></label>
                    <label className="field-label"><span>{t("backupVersions")}</span><input type="number" min={1} max={100} value={settings.maxBackupVersionsPerFile} onChange={(event) => onChange({ maxBackupVersionsPerFile: Number(event.target.value) })} /></label>
                    <label className="field-label"><span>{t("autoSave")}</span><select value={settings.autoSaveMode} onChange={(event) => onChange({ autoSaveMode: event.target.value as UserSettings["autoSaveMode"] })}><option value="off">{t("autoSaveOff")}</option><option value="idle">{t("autoSaveIdle")}</option><option value="interval">{t("autoSaveInterval")}</option><option value="blur">{t("autoSaveBlur")}</option><option value="tab-switch">{t("autoSaveTab")}</option></select></label>
                    <label className="field-label"><span>{t("recoveryBehavior")}</span><select value={settings.sessionRecoveryMode} onChange={(event) => onChange({ sessionRecoveryMode: event.target.value as UserSettings["sessionRecoveryMode"] })}><option value="ask">{t("recoveryAsk")}</option><option value="auto">{t("recoveryAuto")}</option><option value="empty">{t("recoveryOpenEmpty")}</option></select></label>
                  </div>
                  <button type="button" className="button-secondary" onClick={onOpenRecovery}>{t("openRecovery")}</button>
                </section>
              </div>
            )}

            {section === "appearance" && (
              <div className="settings-grid">
                <section className="settings-card settings-card-wide">
                  <h4>{t("appearance")}</h4>
                  <div className="segmented">
                    {(["system", "light", "dark"] as AppearanceMode[]).map((mode) => (
                      <button type="button" key={mode} className={settings.appearanceMode === mode ? "active" : ""} onClick={() => onChange({ appearanceMode: mode })}>{t(mode)}</button>
                    ))}
                  </div>
                  <div className="accent-options" aria-label={t("accent")}>
                    {(Object.keys(accentValues) as AccentTheme[]).map((accent) => (
                      <button type="button" key={accent} className={settings.accentTheme === accent ? "active" : ""} onClick={() => onChange({ accentTheme: accent })}>
                        <span className="accent-swatch" style={{ backgroundColor: accentValues[accent] }}><ShieldCheck size={15} weight={settings.accentTheme === accent ? "fill" : "regular"} /></span>
                        <span>{t(accent)}</span>
                      </button>
                    ))}
                  </div>
                </section>
                <section className="settings-card settings-card-wide">
                  <h4>{t("language")}</h4>
                  <label className="field-label">
                    <span className="field-label-title">{t("language")}<HelpTip text={t("languageHint")} /></span>
                    <select
                      aria-label={t("language")}
                      value={settings.locale}
                      onChange={(event) => onChange({ locale: event.target.value as AppLocale })}
                    >
                      <option value="system">{t("languageSystem")}</option>
                      <option value="zh-CN">{t("chinese")}</option>
                      <option value="en">{t("english")}</option>
                    </select>
                  </label>
                </section>
              </div>
            )}

            {section === "shortcuts" && (
              <div className="shortcut-panel">
                <section className="shortcut-card" aria-labelledby="shortcut-title">
                  <h4 id="shortcut-title">{t("keyboardShortcuts")}</h4>
                  <div className="shortcut-list">
                    {[
                      [t("new"), "Ctrl / ⌘ + N"], [t("open"), "Ctrl / ⌘ + O"], [t("save"), "Ctrl / ⌘ + S"], [t("saveAs"), "Ctrl / ⌘ + Shift + S"],
                      [t("undo"), "Ctrl / ⌘ + Z"], [t("redo"), "Ctrl / ⌘ + Y"], [t("find"), "Ctrl / ⌘ + F"], [t("replace"), "Ctrl / ⌘ + H"],
                      [t("compare"), "Ctrl / ⌘ + Shift + D"], [t("goToLine"), "Ctrl / ⌘ + G"], [t("selectNextOccurrence"), "Ctrl / ⌘ + D"], [t("closeCurrentTab"), "Ctrl / ⌘ + W"], [t("reopenClosedTab"), "Ctrl / ⌘ + Shift + T"],
                      [t("split"), "Ctrl / ⌘ + \\"], [t("settings"), "Ctrl / ⌘ + ,"], [t("moveLine"), "Alt / Option + ↑ / ↓"], [t("copyLine"), "Shift + Alt / Option + ↑ / ↓"],
                      [t("deleteLine"), "Ctrl / ⌘ + Shift + K"], [t("indentSelection"), "Tab / Shift + Tab"],
                    ].map(([label, keys]) => <div className="shortcut-row" key={String(label)}><span>{label}</span><kbd>{keys}</kbd></div>)}
                  </div>
                </section>
              </div>
            )}

            {section === "about" && (
              <div className="about-panel">
                <header className="about-hero">
                  <img src="/plainmint-icon-source.png" alt="" />
                  <div>
                    <h3>{t("productName")}</h3>
                    <p>{t("productDescription")}</p>
                  </div>
                </header>

                <div className="about-meta-grid">
                  <section className="about-meta-card" aria-label={t("currentVersion")}>
                    <span>{t("currentVersion")}</span>
                    <strong>v{currentVersion}</strong>
                  </section>
                  <section className="about-meta-card" aria-label={t("author")}>
                    <span>{t("author")}</span>
                    <strong>Sunky</strong>
                    <a href="http://www.sunky.net" onClick={(event) => { event.preventDefault(); onOpenAuthorWebsite(); }}>http://www.sunky.net</a>
                  </section>
                </div>

                <section className="about-update-card" aria-labelledby="about-update-title">
                  <div className="about-update-icon"><ArrowsClockwise size={22} /></div>
                  <div>
                    <h4 id="about-update-title">{t("updates")}</h4>
                    <p aria-live="polite">{checkingForUpdates ? t("checkingUpdates") : updateCheckStatus === "latest" ? t("latestVersion") : updateCheckStatus === "failed" ? t("updateCheckFailed") : t("updateReadyDescription")}</p>
                  </div>
                  <button type="button" className="button-secondary" disabled={checkingForUpdates} onClick={onCheckUpdates}>{checkingForUpdates ? t("checkingUpdates") : t("checkUpdates")}</button>
                </section>

                <div className="about-footer">
                  <p>{t("privacy")}</p>
                  <div>
                    <button type="button" className="button-secondary" onClick={onOpenSource}>{t("sourceCode")}</button>
                    <span>{t("license")}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          <footer>
            <button type="button" className="button-secondary" disabled={applying} onClick={onCancel}>{t("cancel")}</button>
            <button type="button" className="button-primary" disabled={!canApply || applying} onClick={onApply}>{applying ? t("applying") : t("apply")}</button>
          </footer>
        </div>
      </section>
    </div>
  );
}
