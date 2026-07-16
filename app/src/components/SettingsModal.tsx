import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowsClockwise,
  CloudArrowUp,
  FolderSimple,
  GearSix,
  Info,
  PaintBrush,
  PencilSimple,
  ShieldCheck,
  X,
} from "@phosphor-icons/react";
import type { AccentTheme, AppLocale, AppearanceMode, DirectoryValidationResult, Encoding, LineEnding, UserSettings } from "../types";

type SettingsSection = "general" | "editor" | "files" | "backup" | "appearance" | "updates" | "about";

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
  onChange: (patch: Partial<UserSettings>) => void;
  onApply: () => void;
  onCancel: () => void;
  onChooseDirectory: (field: "defaultSaveFolder" | "cloudSyncFolder") => void;
  onClearDirectory: (field: "defaultSaveFolder" | "cloudSyncFolder") => void;
  onOpenRecovery: () => void;
  onCheckUpdates: () => void;
  onOpenSource: () => void;
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

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      className={"switch " + (checked ? "switch-on" : "")}
      role="switch"
      aria-checked={checked}
      aria-label={label}
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
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="setting-row setting-toggle-row">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

export function SettingsModal({
  settings,
  directoryChecks,
  applying,
  canApply,
  currentVersion = "0.1.0",
  checkingForUpdates = false,
  onChange,
  onApply,
  onCancel,
  onChooseDirectory,
  onClearDirectory,
  onOpenRecovery,
  onCheckUpdates,
  onOpenSource,
}: SettingsModalProps) {
  const { t, i18n } = useTranslation();
  const [section, setSection] = useState<SettingsSection>("general");
  const navigation: Array<{ id: SettingsSection; label: string; icon: typeof GearSix }> = [
    { id: "general", label: t("general"), icon: GearSix },
    { id: "editor", label: t("editor"), icon: PencilSimple },
    { id: "files", label: t("filesFolders"), icon: FolderSimple },
    { id: "backup", label: t("backupRecovery"), icon: CloudArrowUp },
    { id: "appearance", label: t("appearance"), icon: PaintBrush },
    { id: "updates", label: t("updates"), icon: ArrowsClockwise },
    { id: "about", label: t("about"), icon: Info },
  ];

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
            <h3>{navigation.find((item) => item.id === section)?.label}</h3>
            <button type="button" className="icon-button close-settings" disabled={applying} onClick={onCancel} aria-label={t("close")}>
              <X size={19} />
            </button>
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
                </section>
              </div>
            )}

            {section === "editor" && (
              <div className="settings-grid">
                <section className="settings-card settings-card-wide">
                  <h4>{t("editor")}</h4>
                  <div className="field-grid">
                    <label className="field-label">
                      <span>{t("fontFamily")}</span>
                      <select value={settings.fontFamily} onChange={(event) => onChange({ fontFamily: event.target.value })}>
                        <option value="ui-monospace">System monospace</option>
                        <option value="Cascadia Mono">Cascadia Mono</option>
                        <option value="SFMono-Regular">SF Mono</option>
                        <option value="Consolas">Consolas</option>
                      </select>
                    </label>
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
                </section>
              </div>
            )}

            {section === "files" && (
              <div className="settings-grid">
                <section className="settings-card settings-card-wide">
                  <h4>{t("filesFolders")}</h4>
                  {(["defaultSaveFolder", "cloudSyncFolder"] as const).map((field) => (
                    <div className="field-label" key={field}>
                      <span>{t(field === "defaultSaveFolder" ? "defaultFolder" : "cloudFolder")}</span>
                      <div className="path-field">
                        <input aria-label={t(field === "defaultSaveFolder" ? "defaultFolder" : "cloudFolder")} value={settings[field] ?? ""} readOnly />
                        <button type="button" className="button-secondary" disabled={applying} aria-label={t("chooseFolder")} onClick={() => onChooseDirectory(field)}>…</button>
                        {settings[field] && <button type="button" className="button-secondary clear-path" disabled={applying} onClick={() => onClearDirectory(field)}>{t("clear")}</button>}
                      </div>
                      <small className="directory-hint">{t(field === "defaultSaveFolder" ? "defaultFolderHint" : "cloudFolderHint")}</small>
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
                      <span>{t("encoding")}</span>
                      <select value={settings.defaultEncoding} onChange={(event) => onChange({ defaultEncoding: event.target.value as Encoding })}><option value="utf-8">UTF-8</option><option value="utf-8-bom">UTF-8 BOM</option><option value="utf-16le">UTF-16 LE</option><option value="utf-16be">UTF-16 BE</option></select>
                    </label>
                    <label className="field-label">
                      <span>{t("lineEnding")}</span>
                      <select value={settings.defaultLineEnding} onChange={(event) => onChange({ defaultLineEnding: event.target.value as LineEnding })}><option value="lf">LF</option><option value="crlf">CRLF</option><option value="cr">CR</option></select>
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
                  <h4>{t("backupRecovery")}</h4>
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
                    <span>{t("language")}</span>
                    <select
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

            {section === "updates" && (
              <div className="settings-grid">
                <section className="settings-card settings-card-wide update-card">
                  <ArrowsClockwise size={36} color="var(--accent-primary)" />
                  <div><h4>{t("currentVersion")} {currentVersion}</h4><p>{t("updateReadyDescription")}</p></div>
                  <button type="button" className="button-secondary" disabled={checkingForUpdates} onClick={onCheckUpdates}>
                    {checkingForUpdates ? t("checkingUpdates") : t("checkUpdates")}
                  </button>
                </section>
              </div>
            )}

            {section === "about" && (
              <div className="about-panel">
                <img src="/plainmint-icon-source.png" alt="" />
                <h3>{t("productName")}</h3>
                <p>{t("productDescription")}</p>
                <p className="privacy-copy">{t("privacy")}</p>
                <div className="about-actions">
                  <button type="button" className="button-secondary" onClick={onOpenSource}>{t("sourceCode")}</button>
                  <span>{t("license")}</span>
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
