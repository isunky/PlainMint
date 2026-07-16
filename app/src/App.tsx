import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowRight,
  ArrowsLeftRight,
  ArrowsClockwise,
  CaretDown,
  CaretUp,
  Columns,
  Copy,
  DotsThree,
  FilePlus,
  FileText,
  FloppyDisk,
  FolderOpen,
  GearSix,
  MagnifyingGlass,
  Lock,
  Minus,
  Plus,
  Square,
  TextAlignLeft,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import i18n, { resolveLocale } from "./i18n";
import { isAutoSaveEligible, isAutoSaveRevisionSuppressed } from "./autoSavePolicy";
import { needsSaveConfirmation } from "./closePolicy";
import { createWorkspaceSession, decideStartupRecovery } from "./recoveryPolicy";
import { resolveInitialSaveFolder } from "./saveFolderPolicy";
import { findSearchMatches } from "./searchPolicy";
import { ConflictCompareView, type ComparisonSide } from "./components/ConflictCompareView";
import { SettingsModal } from "./components/SettingsModal";
import {
  findNextInPane,
  findPreviousInPane,
  focusEditor,
  goToLineInPane,
  replaceAllSearchMatchesInPane,
  replaceCurrentSearchMatchInPane,
  TextEditor,
} from "./components/TextEditor";
import {
  beginAppSession,
  appErrorCode,
  checkForUpdates,
  chooseAndOpenDocuments,
  chooseDirectory,
  closeWindow,
  copyText,
  deleteRecovery,
  inspectFileMetadata,
  encodedByteLength,
  getAppVersion,
  listenForWindowClose,
  listenForFileWatchChanges,
  listRecoveries,
  loadRecentFiles,
  loadRecentlyClosedTabs,
  loadSession,
  loadSettings,
  minimizeWindow,
  persistSession,
  persistRecentFiles,
  persistRecentlyClosedTabs,
  persistSettings,
  pruneRecoveries,
  openDocumentPath,
  revealFileInDirectory,
  restoreRecoveries,
  saveDocument,
  syncFileWatches,
  showSourceCode,
  showAuthorWebsite,
  toggleMaximizeWindow,
  validateDirectory,
  writeRecovery,
  writeSafetyRecovery,
} from "./services/runtime";
import type { UpdateCheckResult, UpdateInstallProgress } from "./services/runtime";
import { useAppStore } from "./store";
import type { DirectoryValidationResult, DocumentRecord, Encoding, FileFingerprint, LineEnding, OpenedDocument, PaneId, RecoveryEntry, RecentlyClosedTab, UserSettings, WorkspaceSession } from "./types";

type ModalState =
  | { type: "none" }
  | { type: "settings"; snapshot: UserSettings }
  | { type: "recovery" }
  | { type: "startup-recovery"; session: WorkspaceSession }
  | { type: "exit"; documents: DocumentRecord[] }
  | { type: "bulk-close"; targets: TabCloseTarget[]; documents: DocumentRecord[] }
  | { type: "close-tab"; pane: PaneId; tabId: string; document: DocumentRecord }
  | { type: "compare"; left: ComparisonDocument; right: ComparisonDocument }
  | {
    type: "conflict";
    documentId: string;
    revision: number;
    disk: OpenedDocument;
    phase: "compare" | "confirm-overwrite";
    busy?: "save-copy" | "reload" | "overwrite";
    message?: "disk-changed" | "backup-failed" | "same-path" | "action-failed";
  };

type TabCloseTarget = { pane: PaneId; tabId: string };
type ComparisonDocument = Pick<DocumentRecord, "filePath" | "fileName" | "content" | "encoding" | "lineEnding">;

type TabDragView = {
  tabId: string;
  sourcePane: PaneId;
  x: number;
  y: number;
  dragging: boolean;
  targetPane?: PaneId;
  targetIndex?: number;
  beforeTabId?: string;
  rightEdge?: boolean;
};

type TabContextMenuState = {
  pane: PaneId;
  tabId?: string;
  x: number;
  y: number;
};

type DirectoryField = "defaultSaveFolder" | "cloudSyncFolder";
type DirectoryCheck = {
  status: "idle" | "checking" | "valid" | "invalid";
  result?: DirectoryValidationResult;
};

type AvailableUpdate = Extract<UpdateCheckResult, { available: true }>;
type UpdateDialogState = {
  update: AvailableUpdate;
  status: "ready" | "downloading" | "installing" | "error";
  progress: number;
};

const emptyDirectoryChecks: Record<DirectoryField, DirectoryCheck> = {
  defaultSaveFolder: { status: "idle" },
  cloudSyncFolder: { status: "idle" },
};

interface SaveIntent {
  forceSaveAs?: boolean;
  automatic?: boolean;
  bypassFailure?: boolean;
  notifySuccess?: boolean;
}

function comparisonSnapshot(document: DocumentRecord): ComparisonDocument {
  return {
    filePath: document.filePath,
    fileName: document.fileName,
    content: document.content,
    encoding: document.encoding,
    lineEnding: document.lineEnding,
  };
}

function comparisonSide(document: ComparisonDocument, unsavedLabel: string): ComparisonSide {
  const encoding = document.encoding === "utf-8-bom" ? "UTF-8 BOM"
    : document.encoding === "utf-16le" ? "UTF-16 LE"
      : document.encoding === "utf-16be" ? "UTF-16 BE"
        : "UTF-8";
  return {
    label: document.fileName ?? unsavedLabel,
    detail: `${document.filePath ?? unsavedLabel} · ${encoding} · ${document.lineEnding.toUpperCase()}`,
  };
}

const accentMap = {
  tiffany: "#18B7AA",
  graphite: "#4B5563",
  amber: "#E59A20",
  coral: "#E96F61",
  iris: "#8B6FD6",
};

function sameFingerprint(left?: FileFingerprint | null, right?: FileFingerprint | null) {
  return Boolean(left && right && left.hash === right.hash);
}

function normalizedWindowsPath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/$/, "").toLocaleLowerCase();
}

function recoverySnapshot(document: DocumentRecord) {
  return {
    documentId: document.id,
    fileName: document.fileName,
    originalPath: document.filePath,
    content: document.content,
    encoding: document.encoding,
    lineEnding: document.lineEnding,
  };
}

function IconButton({
  label,
  children,
  active,
  disabled,
  onClick,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={"icon-button " + (active ? "active " : "") + className}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function AppLogo({ dragRegion = false }: { dragRegion?: boolean }) {
  return (
    <img
      className="app-logo"
      src="/plainmint-icon-source.png"
      alt=""
      data-tauri-drag-region={dragRegion ? "" : undefined}
    />
  );
}

function TitleBar({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <AppLogo dragRegion />
        <span data-tauri-drag-region>{t("appName")}</span>
      </div>
      <div className="window-controls">
        <IconButton label={t("minimize")} onClick={() => void minimizeWindow()}><Minus size={18} /></IconButton>
        <IconButton label={t("maximize")} onClick={() => void toggleMaximizeWindow()}><Square size={15} /></IconButton>
        <IconButton label={t("close")} className="window-close" onClick={onClose}><X size={19} /></IconButton>
      </div>
    </header>
  );
}

function Welcome({
  recentFiles,
  onNew,
  onOpen,
  onOpenRecent,
  onRemoveRecent,
  onClearRecent,
  onRecovery,
  onRestoreSession,
}: {
  recentFiles: string[];
  onNew: () => void;
  onOpen: () => void;
  onOpenRecent: (path: string) => void;
  onRemoveRecent: (path: string) => void;
  onClearRecent: () => void;
  onRecovery: () => void;
  onRestoreSession: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <div className="welcome-hero">
        <AppLogo />
        <div>
          <h1 id="welcome-title">{t("welcomeTitle")}</h1>
          <p>{t("welcomeBody")}</p>
        </div>
      </div>
      <div className="welcome-actions">
        <button type="button" className="welcome-action primary" onClick={onNew}><FilePlus size={24} /><span><strong>{t("createFile")}</strong><small>Ctrl / ⌘ + N</small></span></button>
        <button type="button" className="welcome-action" onClick={onOpen}><FolderOpen size={24} /><span><strong>{t("openFile")}</strong><small>Ctrl / ⌘ + O</small></span></button>
        <button type="button" className="welcome-action" onClick={onRestoreSession}><ArrowCounterClockwise size={24} /><span><strong>{t("restoreSession")}</strong><small>{t("sessionRecovery")}</small></span></button>
        <button type="button" className="welcome-action" onClick={onRecovery}><FloppyDisk size={24} /><span><strong>{t("openRecovery")}</strong><small>{t("backupRecovery")}</small></span></button>
      </div>
      <div className="recent-panel">
        <div className="recent-panel-header">
          <h2>{t("recentFiles")}</h2>
          {recentFiles.length > 0 && <button type="button" className="recent-clear" onClick={onClearRecent}>{t("clearRecentFiles")}</button>}
        </div>
        {recentFiles.length === 0 ? <p>{t("recentEmpty")}</p> : (
          <div className="recent-list">
            {recentFiles.slice(0, 8).map((path) => (
              <div className="recent-item" key={path}>
                <button type="button" className="recent-open" onClick={() => onOpenRecent(path)}>
                  <FileText size={19} />
                  <span><strong>{path.split(/[\\/]/).at(-1)}</strong><small>{path}</small></span>
                </button>
                <IconButton label={t("removeRecentFile", { name: path.split(/[\\/]/).at(-1) })} className="recent-remove" onClick={() => onRemoveRecent(path)}><X size={17} /></IconButton>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

interface ToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  split: boolean;
  wrap: boolean;
  canCompare: boolean;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onFind: () => void;
  onCompare: () => void;
  onWrap: () => void;
  onSplit: () => void;
  onSettings: () => void;
}

function Toolbar(props: ToolbarProps) {
  const { t } = useTranslation();
  const actions = [
    { key: "new", label: t("new"), icon: FilePlus, action: props.onNew },
    { key: "open", label: t("open"), icon: FolderOpen, action: props.onOpen },
    { key: "save", label: t("save"), icon: FloppyDisk, action: props.onSave },
    { key: "undo", label: t("undo"), icon: ArrowCounterClockwise, action: props.onUndo, disabled: !props.canUndo },
    { key: "redo", label: t("redo"), icon: ArrowClockwise, action: props.onRedo, disabled: !props.canRedo },
    { key: "find", label: t("find"), icon: MagnifyingGlass, action: props.onFind },
    { key: "compare", label: t("compare"), icon: ArrowsLeftRight, action: props.onCompare, disabled: !props.canCompare },
    { key: "wrap", label: t("wrap"), icon: TextAlignLeft, action: props.onWrap, active: props.wrap },
    { key: "split", label: t("split"), icon: Columns, action: props.onSplit, active: props.split },
  ];
  return (
    <div className="toolbar" role="toolbar" aria-label={t("toolbar")}>
      {actions.map(({ key, label, icon: Icon, action, disabled, active }, index) => (
        <div className={"toolbar-action-wrap " + ([3, 5].includes(index) ? "with-divider" : "")} key={key}>
          <button type="button" className={"toolbar-action " + (active ? "active" : "")} disabled={disabled} onClick={action} title={label}>
            <Icon size={23} weight="regular" />
            <span>{label}</span>
          </button>
        </div>
      ))}
      <button type="button" className="toolbar-action toolbar-more" onClick={props.onSettings} title={t("settings")}>
        <GearSix size={22} />
        <span>{t("settings")}</span>
      </button>
    </div>
  );
}

function TabBar({
  pane,
  onClose,
  onActivate,
  onPointerDown,
  onContextMenu,
  drag,
}: {
  pane: PaneId;
  onClose: (pane: PaneId, tabId: string) => void;
  onActivate: (pane: PaneId, tabId: string) => void;
  onPointerDown: (pane: PaneId, tabId: string, event: React.PointerEvent<HTMLElement>) => void;
  onContextMenu: (menu: TabContextMenuState) => void;
  drag: TabDragView | null;
}) {
  const { t } = useTranslation();
  const tabs = useAppStore((state) => state.tabs[pane]);
  const activeTab = useAppStore((state) => state.activeTab[pane]);
  const documents = useAppStore((state) => state.documents);
  const createDocument = useAppStore((state) => state.createDocument);
  return (
    <div className="tabbar" role="tablist" aria-label={pane === "left" ? t("leftPane") : t("rightPane")}>
      <div
        className={"tabs-scroll " + (drag?.dragging && drag.targetPane === pane ? "drag-target" : "")}
        data-tabbar-pane={pane}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest(".tab, .new-tab")) return;
          createDocument(pane);
        }}
        onContextMenu={(event) => {
          if ((event.target as HTMLElement).closest(".tab")) return;
          event.preventDefault();
          onContextMenu({ pane, x: event.clientX, y: event.clientY });
        }}
      >
        {tabs.map((tab) => {
          const document = documents[tab.documentId];
          if (!document) return null;
          const statusLabel = document.missing
            ? t("tabFileMissing")
            : document.externalModified
              ? t("tabExternalModified")
              : document.readOnly
                ? t("tabReadOnly")
                : undefined;
          const StatusIcon = document.missing
            ? WarningCircle
            : document.externalModified
              ? ArrowsClockwise
              : document.readOnly
                ? Lock
                : FileText;
          return (
            <div
              role="tab"
              tabIndex={activeTab === tab.id ? 0 : -1}
              aria-selected={activeTab === tab.id}
              aria-label={[document.fileName === "Untitled" ? t("untitled") : document.fileName, document.dirty ? t("tabUnsaved") : "", statusLabel ?? ""].filter(Boolean).join(", ")}
              className={"tab " + (activeTab === tab.id ? "active " : "") + (drag?.dragging && drag.tabId === tab.id ? "dragging " : "") + (drag?.dragging && drag.targetPane === pane && drag.beforeTabId === tab.id ? "drop-before" : "")}
              key={tab.id}
              data-tab-id={tab.id}
              data-tab-pane={pane}
              onClick={() => onActivate(pane, tab.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onActivate(pane, tab.id);
                }
              }}
              onPointerDown={(event) => onPointerDown(pane, tab.id, event)}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                onClose(pane, tab.id);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                onContextMenu({ pane, tabId: tab.id, x: event.clientX, y: event.clientY });
              }}
            >
              <span className="tab-status-icon" title={statusLabel}><StatusIcon size={18} /></span>
              <span className="tab-name">{document.fileName === "Untitled" ? t("untitled") : document.fileName}</span>
              {document.dirty && <span className="dirty-dot" aria-label={t("tabUnsaved")} />}
              <button type="button" className="tab-close" aria-label={t("closeTab", { name: document.fileName })} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onClose(pane, tab.id); }}>
                <X size={16} />
              </button>
            </div>
          );
        })}
        {drag?.dragging && drag.targetPane === pane && !drag.beforeTabId && <span className="tab-drop-end" aria-hidden="true" />}
        <IconButton label={t("new")} className="new-tab" onClick={() => createDocument(pane)}><Plus size={20} /></IconButton>
      </div>
    </div>
  );
}

function SearchBar({
  pane,
  matches,
  searchValid,
  matchIndex,
  onMatchIndex,
}: {
  pane: PaneId;
  matches: Array<{ from: number; to: number }>;
  searchValid: boolean;
  matchIndex: number;
  onMatchIndex: (index: number) => void;
}) {
  const { t } = useTranslation();
  const search = useAppStore((state) => state.search);
  const setSearch = useAppStore((state) => state.setSearch);
  const hasMatches = searchValid && matches.length > 0;
  const go = (direction: -1 | 1) => {
    if (!hasMatches) return;
    const next = (matchIndex + direction + matches.length) % matches.length;
    onMatchIndex(next);
    direction > 0 ? findNextInPane(pane) : findPreviousInPane(pane);
  };
  return (
    <div className="searchbar" role="search">
      <div className={"search-input-wrap " + (search.query && !searchValid ? "invalid-query" : search.query && !hasMatches ? "no-match" : "")}>
        <MagnifyingGlass size={21} />
        <input
          autoFocus
          value={search.query}
          placeholder={t("find")}
          onChange={(event) => { setSearch({ query: event.target.value }); onMatchIndex(0); }}
          onKeyDown={(event) => { if (event.key === "Enter") go(event.shiftKey ? -1 : 1); if (event.key === "Escape") setSearch({ open: false }); }}
        />
      </div>
      <IconButton label={t("previousMatch")} onClick={() => go(-1)} disabled={!hasMatches}><CaretUp size={18} /></IconButton>
      <IconButton label={t("nextMatch")} onClick={() => go(1)} disabled={!hasMatches}><CaretDown size={18} /></IconButton>
      <span className="match-count">{search.query && !searchValid ? t("invalidRegularExpression") : hasMatches ? t("matchCount", { current: Math.min(matchIndex + 1, matches.length), total: matches.length }) : t("noMatches")}</span>
      <label className="check-control"><input type="checkbox" checked={search.caseSensitive} onChange={(event) => setSearch({ caseSensitive: event.target.checked })} /><span>{t("caseSensitive")}</span></label>
      <label className="check-control"><input type="checkbox" checked={search.wholeWord} onChange={(event) => setSearch({ wholeWord: event.target.checked })} /><span>{t("wholeWord")}</span></label>
      <label className="check-control"><input type="checkbox" checked={search.regexp} onChange={(event) => setSearch({ regexp: event.target.checked })} /><span>{t("regularExpression")}</span></label>
      {search.replaceOpen && (
        <>
          <input className="replace-input" value={search.replacement} placeholder={t("replaceWith")} onChange={(event) => setSearch({ replacement: event.target.value })} />
          <button type="button" className="button-secondary search-action" disabled={!hasMatches} onClick={() => {
            const match = matches[Math.min(matchIndex, matches.length - 1)];
            if (replaceCurrentSearchMatchInPane(pane, match)) onMatchIndex(0);
          }}>{t("replace")}</button>
          <button type="button" className="button-primary search-action" disabled={!hasMatches} onClick={() => { if (replaceAllSearchMatchesInPane(pane)) onMatchIndex(0); }}>{t("replaceAll")}</button>
        </>
      )}
      <IconButton label={t("closeSearch")} onClick={() => setSearch({ open: false })}><X size={19} /></IconButton>
    </div>
  );
}

function StatusBar({ pane, document }: { pane: PaneId; document?: DocumentRecord }) {
  const { t } = useTranslation();
  const cursor = useAppStore((state) => state.cursor[pane]);
  const updateDocumentFormat = useAppStore((state) => state.updateDocumentFormat);
  if (!document) return <div className="statusbar" />;
  const characters = Array.from(document.content).length;
  const lines = document.content.split("\n").length;
  return (
    <div className="statusbar" aria-label={t("statusbar")}>
      <span>{t("cursor", { line: cursor.line, column: cursor.column })}</span>
      <span>{t("selectedCharacters", { count: cursor.selected })}</span>
      <span>{t("characters", { count: characters })}</span>
      <span className="status-spacer" />
      <span>{t("lines", { count: lines })}</span>
      <select className="status-format-select" aria-label={t("fileEncoding")} value={document.encoding} disabled={document.readOnly} onChange={(event) => updateDocumentFormat(document.id, { encoding: event.target.value as Encoding })}>
        <option value="utf-8">UTF-8</option>
        <option value="utf-8-bom">UTF-8 BOM</option>
        <option value="utf-16le">UTF-16 LE</option>
        <option value="utf-16be">UTF-16 BE</option>
      </select>
      <select className="status-format-select" aria-label={t("fileLineEnding")} value={document.lineEnding} disabled={document.readOnly} onChange={(event) => updateDocumentFormat(document.id, { lineEnding: event.target.value as LineEnding })}>
        <option value="lf">LF</option>
        <option value="crlf">CRLF</option>
        <option value="cr">CR</option>
      </select>
      <span>{document.fileName.endsWith(".md") ? t("markdown") : t("plainText")}</span>
    </div>
  );
}

function EditorPane({ pane, onCloseTab, onActivateTab, onTabPointerDown, onTabContextMenu, drag }: {
  pane: PaneId;
  onCloseTab: (pane: PaneId, tabId: string) => void;
  onActivateTab: (pane: PaneId, tabId: string) => void;
  onTabPointerDown: (pane: PaneId, tabId: string, event: React.PointerEvent<HTMLElement>) => void;
  onTabContextMenu: (menu: TabContextMenuState) => void;
  drag: TabDragView | null;
}) {
  const { t } = useTranslation();
  const tabs = useAppStore((state) => state.tabs[pane]);
  const activeTabId = useAppStore((state) => state.activeTab[pane]);
  const documents = useAppStore((state) => state.documents);
  const settings = useAppStore((state) => state.settings);
  const search = useAppStore((state) => state.search);
  const applyChanges = useAppStore((state) => state.applyChanges);
  const setCursor = useAppStore((state) => state.setCursor);
  const setActivePane = useAppStore((state) => state.setActivePane);
  const undoDocument = useAppStore((state) => state.undoDocument);
  const redoDocument = useAppStore((state) => state.redoDocument);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const document = activeTab ? documents[activeTab.documentId] : undefined;
  return (
    <section className="editor-pane" data-pane-drop={pane} onPointerDown={() => setActivePane(pane)}>
      <TabBar pane={pane} onClose={onCloseTab} onActivate={onActivateTab} onPointerDown={onTabPointerDown} onContextMenu={onTabContextMenu} drag={drag} />
      {document ? <div className="editor-region">
        <TextEditor
          pane={pane}
          document={document}
          settings={settings}
          searchState={search}
          onChange={(changes, origin) => applyChanges(document.id, changes, origin)}
          onCursor={(line, column, selected) => setCursor(pane, { line, column, selected })}
          onFocus={() => setActivePane(pane)}
          onUndo={() => undoDocument(document.id)}
          onRedo={() => redoDocument(document.id)}
        />
      </div> : <div className="editor-empty"><span>{t("emptyPaneHint")}</span></div>}
      <StatusBar pane={pane} document={document} />
    </section>
  );
}

function RecoveryModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const addOpenedDocument = useAppStore((state) => state.addOpenedDocument);
  const [entries, setEntries] = useState<RecoveryEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void listRecoveries()
      .then(setEntries)
      .catch(() => setMessage(t("recoveryLoadFailed")));
  }, [t]);

  const toggleSelected = (entry: RecoveryEntry) => {
    setSelected((current) => {
      const next = new Set(current);
      const wasSelected = next.has(entry.id);
      entries
        .filter((candidate) => candidate.documentId === entry.documentId)
        .forEach((candidate) => next.delete(candidate.id));
      if (!wasSelected) next.add(entry.id);
      return next;
    });
  };

  const selectLatestForEveryDocument = () => {
    const documentIds = new Set<string>();
    const next = new Set<string>();
    entries.forEach((entry) => {
      if (entry.status === "ready" && !documentIds.has(entry.documentId)) {
        documentIds.add(entry.documentId);
        next.add(entry.id);
      }
    });
    setSelected(next);
  };

  const recover = async (ids: string[]) => {
    if (!ids.length || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await restoreRecoveries(ids);
      result.documents.forEach((document) => addOpenedDocument(document));
      if (result.failures.length) {
        setMessage(t("recoveryPartial", { restored: result.documents.length, failed: result.failures.length }));
        setSelected(new Set(result.failures.map((failure) => failure.id)));
      } else if (result.documents.length) {
        onClose();
      }
    } catch {
      setMessage(t("recoveryLoadFailed"));
    } finally {
      setBusy(false);
    }
  };

  const recoverableCount = new Set(entries.filter((entry) => entry.status === "ready").map((entry) => entry.documentId)).size;
  return (
    <div className="modal-backdrop">
      <section className="recovery-modal" role="dialog" aria-modal="true" aria-label={t("recoveryTitle")}>
        <header><h2>{t("recoveryTitle")}</h2><IconButton label={t("close")} onClick={onClose}><X size={19} /></IconButton></header>
        <div className="recovery-toolbar">
          <button type="button" className="button-secondary" disabled={!recoverableCount || busy} onClick={selectLatestForEveryDocument}>{t("selectLatestBackups")}</button>
          <span>{t("selectedBackups", { count: selected.size })}</span>
          <button type="button" className="button-primary" disabled={!selected.size || busy} onClick={() => void recover([...selected])}>{t("recoverSelected")}</button>
        </div>
        {message && <p className="recovery-message" role="status">{message}</p>}
        <div className="recovery-list">
          {entries.length === 0 && <p className="empty-copy">{t("recoveryEmpty")}</p>}
          {entries.map((entry) => (
            <article key={entry.id} className={entry.status === "corrupted" ? "corrupted" : ""}>
              <input
                type="checkbox"
                checked={selected.has(entry.id)}
                disabled={entry.status === "corrupted" || busy}
                aria-label={t("selectBackup", { name: entry.fileName })}
                onChange={() => toggleSelected(entry)}
              />
              <FileText size={22} />
              <div>
                <strong>{entry.status === "corrupted" ? t("damagedBackup") : entry.fileName}</strong>
                <span>{entry.status === "corrupted" ? t("damagedBackupDescription") : `${new Date(entry.createdAt).toLocaleString()} · ${t(`recoveryReason_${entry.reason}`)} · ${Math.max(1, Math.round(entry.size / 1024))} KB`}</span>
              </div>
              {entry.status === "ready" && <button type="button" className="button-secondary" disabled={busy} onClick={() => void recover([entry.id])}>{t("recover")}</button>}
              <button type="button" className="icon-button" disabled={busy} aria-label={t("delete")} onClick={() => {
                if (!window.confirm(t("deleteBackupConfirm"))) return;
                void deleteRecovery(entry.id).then(() => {
                  setEntries((current) => current.filter((item) => item.id !== entry.id));
                  setSelected((current) => { const next = new Set(current); next.delete(entry.id); return next; });
                });
              }}><X size={17} /></button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function StartupRecoveryModal({ session, onRestore, onStartFresh }: {
  session: WorkspaceSession;
  onRestore: () => void;
  onStartFresh: () => void;
}) {
  const { t } = useTranslation();
  const dirtyDocuments = session.documents.filter((document) => document.dirty);
  return (
    <div className="modal-backdrop">
      <section className="confirm-modal startup-recovery-modal" role="alertdialog" aria-modal="true">
        <h2>{t("unexpectedExitTitle")}</h2>
        <p>{t("unexpectedExitBody", { count: session.documents.length, dirty: dirtyDocuments.length })}</p>
        {dirtyDocuments.length > 0 && (
          <div className="unsaved-file-list">
            {dirtyDocuments.slice(0, 6).map((document) => <span key={document.id}><FileText size={16} />{document.fileName}</span>)}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="button-secondary" onClick={onStartFresh}>{t("startFresh")}</button>
          <button type="button" className="button-primary" autoFocus onClick={onRestore}>{t("restoreWorkspace")}</button>
        </div>
      </section>
    </div>
  );
}

function CloseTabModal({ modal, onCancel, onDiscard, onSave }: {
  modal: Extract<ModalState, { type: "close-tab" }>;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="modal-backdrop">
      <section className="confirm-modal" role="alertdialog" aria-modal="true">
        <h2>{t("unsavedTitle")}</h2>
        <p>{t("unsavedBody", { name: modal.document.fileName })}</p>
        <div className="modal-actions">
          <button type="button" className="button-secondary" onClick={onCancel}>{t("cancel")}</button>
          <button type="button" className="button-danger" onClick={onDiscard}>{t("discardAndClose")}</button>
          <button type="button" className="button-primary" onClick={onSave}>{t("saveAndClose")}</button>
        </div>
      </section>
    </div>
  );
}

function ExitModal({ documents, onCancel, onDiscard, onSave }: {
  documents: DocumentRecord[];
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="modal-backdrop">
      <section className="confirm-modal" role="alertdialog" aria-modal="true">
        <h2>{t("unsavedTitle")}</h2>
        <p>{t("unsavedExitBody", { count: documents.length })}</p>
        <div className="unsaved-file-list">{documents.map((document) => <span key={document.id}><FileText size={16} />{document.fileName}</span>)}</div>
        <div className="modal-actions">
          <button type="button" className="button-secondary" onClick={onCancel}>{t("cancel")}</button>
          <button type="button" className="button-danger" onClick={onDiscard}>{t("discardAndExit")}</button>
          <button type="button" className="button-primary" onClick={onSave}>{t("saveAndExit")}</button>
        </div>
      </section>
    </div>
  );
}

function BulkCloseModal({ documents, onCancel, onDiscard, onSave }: {
  documents: DocumentRecord[];
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="modal-backdrop">
      <section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="bulk-close-title">
        <h2 id="bulk-close-title">{t("bulkCloseTitle")}</h2>
        <p>{t("bulkCloseBody", { count: documents.length })}</p>
        <div className="unsaved-file-list">{documents.map((document) => <span key={document.id}><FileText size={16} />{document.fileName}</span>)}</div>
        <div className="modal-actions">
          <button type="button" className="button-secondary" onClick={onCancel}>{t("cancel")}</button>
          <button type="button" className="button-danger" onClick={onDiscard}>{t("discardAllAndClose")}</button>
          <button type="button" className="button-primary" onClick={onSave}>{t("saveAllAndClose")}</button>
        </div>
      </section>
    </div>
  );
}

function UpdateModal({ state, onClose, onInstall }: {
  state: UpdateDialogState;
  onClose: () => void;
  onInstall: () => void;
}) {
  const { t } = useTranslation();
  const busy = state.status === "downloading" || state.status === "installing";
  const statusText = state.status === "downloading"
    ? t("updateDownloading", { progress: state.progress })
    : state.status === "installing"
      ? t("updateInstalling")
      : state.status === "error"
        ? t("updateInstallFailed")
        : undefined;
  return (
    <div className="modal-backdrop update-modal-backdrop">
      <section className="confirm-modal update-modal" role="dialog" aria-modal="true" aria-labelledby="update-title">
        <div className="update-modal-heading">
          <span className="update-modal-icon"><ArrowsClockwise size={26} weight="bold" /></span>
          <div>
            <h2 id="update-title">{t("updateAvailableTitle", { version: state.update.version })}</h2>
            <p>{t("updateAvailableBody")}</p>
          </div>
        </div>
        <div className="update-release-notes">
          <strong>{t("updateNotes")}</strong>
          <p>{state.update.body?.trim() || t("updateNotesEmpty")}</p>
        </div>
        {busy && (
          <div className="update-progress" aria-live="polite">
            <div><span style={{ width: `${state.status === "installing" ? 100 : state.progress}%` }} /></div>
            <p>{statusText}</p>
          </div>
        )}
        {state.status === "error" && <p className="update-error" role="alert">{statusText}</p>}
        <div className="modal-actions">
          <button type="button" className="button-secondary" disabled={busy} onClick={onClose}>{t("updateLater")}</button>
          <button type="button" className="button-primary" disabled={busy} onClick={onInstall}>
            {state.status === "error" ? t("tryAgain") : t("updateDownload")}
          </button>
        </div>
      </section>
    </div>
  );
}

function ConflictModal({
  modal,
  document,
  onLater,
  onSaveCopy,
  onReload,
  onRequestOverwrite,
  onCancelOverwrite,
  onConfirmOverwrite,
}: {
  modal: Extract<ModalState, { type: "conflict" }>;
  document: DocumentRecord;
  onLater: () => void;
  onSaveCopy: () => void;
  onReload: () => void;
  onRequestOverwrite: () => void;
  onCancelOverwrite: () => void;
  onConfirmOverwrite: () => void;
}) {
  const { t } = useTranslation();
  const busy = Boolean(modal.busy);
  if (modal.phase === "confirm-overwrite") {
    return (
      <div className="modal-backdrop">
        <section className="confirm-modal conflict-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="conflict-overwrite-title">
          <h2 id="conflict-overwrite-title">{t("conflictOverwriteTitle")}</h2>
          <p>{t("conflictOverwriteBody", { name: document.fileName })}</p>
          <div className="modal-actions">
            <button type="button" className="button-secondary" disabled={busy} onClick={onCancelOverwrite}>{t("cancel")}</button>
            <button type="button" className="button-danger" disabled={busy} onClick={onConfirmOverwrite}>{t("conflictOverwrite")}</button>
          </div>
        </section>
      </div>
    );
  }

  const message = modal.message ? t(`conflictMessage_${modal.message}`) : undefined;
  return (
    <div className="modal-backdrop">
      <section className="conflict-modal" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
        <header>
          <div>
            <h2 id="conflict-title">{t("conflictTitle")}</h2>
            <p>{t("conflictBody", { name: document.fileName })}</p>
          </div>
        </header>
        {message && <p className="conflict-message" role="status">{message}</p>}
        <ConflictCompareView
          localContent={document.content}
          diskContent={modal.disk.content}
          localLabel={{ label: t("conflictLocalVersion") }}
          diskLabel={{ label: t("conflictDiskVersion") }}
          largeFileMessage={t("conflictLargeFile")}
          noDifferencesLabel={t("compareNoDifferences")}
          differencePositionLabel={(current, total) => t("compareDifferencePosition", { current, total })}
          previousDifferenceLabel={t("comparePreviousDifference")}
          nextDifferenceLabel={t("compareNextDifference")}
        />
        <div className="modal-actions conflict-actions">
          <button type="button" className="button-secondary" disabled={busy} onClick={onLater}>{t("conflictLater")}</button>
          <button type="button" className="button-secondary" disabled={busy} onClick={onSaveCopy}>{t("conflictSaveCopy")}</button>
          <button type="button" className="button-danger" disabled={busy} onClick={onReload}>{t("conflictReload")}</button>
          <button type="button" className="button-danger" disabled={busy || !modal.disk.fingerprint} onClick={onRequestOverwrite}>{t("conflictOverwrite")}</button>
        </div>
      </section>
    </div>
  );
}

function CompareModal({ modal, onClose }: { modal: Extract<ModalState, { type: "compare" }>; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="modal-backdrop">
      <section className="conflict-modal file-compare-modal" role="dialog" aria-modal="true" aria-labelledby="compare-title">
        <header>
          <div>
            <h2 id="compare-title">{t("compareTitle")}</h2>
            <p>{t("compareBody")}</p>
          </div>
        </header>
        <ConflictCompareView
          localContent={modal.left.content}
          diskContent={modal.right.content}
          localLabel={comparisonSide(modal.left, t("compareUnsavedDocument"))}
          diskLabel={comparisonSide(modal.right, t("compareUnsavedDocument"))}
          largeFileMessage={t("compareLargeFile")}
          noDifferencesLabel={t("compareNoDifferences")}
          differencePositionLabel={(current, total) => t("compareDifferencePosition", { current, total })}
          previousDifferenceLabel={t("comparePreviousDifference")}
          nextDifferenceLabel={t("compareNextDifference")}
        />
        <div className="modal-actions">
          <button type="button" className="button-primary" onClick={onClose}>{t("close")}</button>
        </div>
      </section>
    </div>
  );
}

function TabContextMenu({ menu, filePath, hasTabsToRight, hasOtherTabs, recent, showCloseSplit, onDismiss, onNew, onClose, onCloseOthers, onCloseRight, onMove, onCopyPath, onRevealInFolder, onCloseSplit, onReopen }: {
  menu: TabContextMenuState;
  filePath?: string;
  hasTabsToRight: boolean;
  hasOtherTabs: boolean;
  recent?: RecentlyClosedTab;
  showCloseSplit: boolean;
  onDismiss: () => void;
  onNew: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseRight: () => void;
  onMove: () => void;
  onCopyPath: () => void;
  onRevealInFolder: () => void;
  onCloseSplit: () => void;
  onReopen: () => void;
}) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const run = (action: () => void) => () => {
    onDismiss();
    action();
  };
  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onDismiss();
    };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [onDismiss]);
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") { event.preventDefault(); onDismiss(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || items.length === 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - 284));
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - 410));
  return (
    <div ref={menuRef} className="tab-context-menu" role="menu" style={{ left, top }} onKeyDown={onKeyDown} onContextMenu={(event) => event.preventDefault()}>
      {!menu.tabId && <button type="button" role="menuitem" onClick={run(onNew)}><FilePlus size={17} /><span>{t("newTab")}</span></button>}
      {menu.tabId && <>
        <button type="button" role="menuitem" onClick={run(onClose)}><X size={17} /><span>{t("closeCurrentTab")}</span><kbd>Ctrl+W</kbd></button>
        <button type="button" role="menuitem" disabled={!hasOtherTabs} onClick={run(onCloseOthers)}><span className="menu-icon-text">×</span><span>{t("closeOtherTabs")}</span></button>
        <button type="button" role="menuitem" disabled={!hasTabsToRight} onClick={run(onCloseRight)}><ArrowRight size={17} /><span>{t("closeTabsToRight")}</span></button>
        <div className="menu-separator" role="separator" />
        <button type="button" role="menuitem" onClick={run(onMove)}>{menu.pane === "left" ? <ArrowRight size={17} /> : <ArrowLeft size={17} />}<span>{menu.pane === "left" ? t("moveTabRight") : t("moveTabLeft")}</span></button>
        <button type="button" role="menuitem" disabled={!filePath} onClick={run(onCopyPath)}><Copy size={17} /><span>{t("copyFilePath")}</span></button>
        <button type="button" role="menuitem" disabled={!filePath} onClick={run(onRevealInFolder)}><FolderOpen size={17} /><span>{t("revealInFolder")}</span></button>
      </>}
      {showCloseSplit && <button type="button" role="menuitem" onClick={run(onCloseSplit)}><Columns size={17} /><span>{t("closeSplitPane")}</span></button>}
      <div className="menu-separator" role="separator" />
      <button type="button" role="menuitem" disabled={!recent} onClick={run(onReopen)}><ArrowCounterClockwise size={17} /><span className="menu-label-stack"><span>{t("reopenClosedTab")}</span>{recent && <small>{recent.fileName}</small>}</span><kbd>Ctrl+Shift+T</kbd></button>
    </div>
  );
}

export function App() {
  const { t } = useTranslation();
  const documents = useAppStore((state) => state.documents);
  const tabs = useAppStore((state) => state.tabs);
  const activeTab = useAppStore((state) => state.activeTab);
  const activePane = useAppStore((state) => state.activePane);
  const split = useAppStore((state) => state.split);
  const splitRatio = useAppStore((state) => state.splitRatio);
  const recentlyClosedTabs = useAppStore((state) => state.recentlyClosedTabs);
  const search = useAppStore((state) => state.search);
  const settings = useAppStore((state) => state.settings);
  const histories = useAppStore((state) => state.histories);
  const createDocument = useAppStore((state) => state.createDocument);
  const addOpenedDocument = useAppStore((state) => state.addOpenedDocument);
  const closeTabs = useAppStore((state) => state.closeTabs);
  const moveTab = useAppStore((state) => state.moveTab);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const toggleSplit = useAppStore((state) => state.toggleSplit);
  const setSplitRatio = useAppStore((state) => state.setSplitRatio);
  const loadRecentlyClosedTabsIntoStore = useAppStore((state) => state.loadRecentlyClosedTabs);
  const rememberClosedTab = useAppStore((state) => state.rememberClosedTab);
  const removeRecentlyClosedTab = useAppStore((state) => state.removeRecentlyClosedTab);
  const undoDocument = useAppStore((state) => state.undoDocument);
  const redoDocument = useAppStore((state) => state.redoDocument);
  const markSaved = useAppStore((state) => state.markSaved);
  const replaceDocumentFromDisk = useAppStore((state) => state.replaceDocumentFromDisk);
  const refreshDocumentDiskState = useAppStore((state) => state.refreshDocumentDiskState);
  const setSearch = useAppStore((state) => state.setSearch);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const loadSettingsIntoStore = useAppStore((state) => state.loadSettings);
  const restoreSessionIntoStore = useAppStore((state) => state.restoreSession);
  const updateDocumentFlags = useAppStore((state) => state.updateDocumentFlags);
  const [modal, setModal] = useState<ModalState>(() => new URLSearchParams(window.location.search).get("state") === "settings" ? { type: "settings", snapshot: settings } : { type: "none" });
  const [toast, setToast] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [appVersion, setAppVersion] = useState("0.1.0");
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);
  const [updateCheckStatus, setUpdateCheckStatus] = useState<"idle" | "latest" | "failed">("idle");
  const [updateDialog, setUpdateDialog] = useState<UpdateDialogState | null>(null);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [directoryChecks, setDirectoryChecks] = useState<Record<DirectoryField, DirectoryCheck>>(emptyDirectoryChecks);
  const [settingsApplying, setSettingsApplying] = useState(false);
  const [tabDrag, setTabDrag] = useState<TabDragView | null>(null);
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null);
  const [resizingSplit, setResizingSplit] = useState(false);
  const [autoSaveFailures, setAutoSaveFailures] = useState<Record<string, number>>({});
  const [fileWatchListenerReady, setFileWatchListenerReady] = useState(false);
  const backupTimers = useRef<Record<string, number>>({});
  const idleSaveTimers = useRef<Record<string, { revision: number; timer: number }>>({});
  const saveInFlight = useRef(new Map<string, Promise<boolean>>());
  const diskCheckInFlight = useRef(new Set<string>());
  const pendingDiskChecks = useRef(new Set<string>());
  const diskCheckRunner = useRef<(documentId: string) => void>(() => undefined);
  const conflictReadInFlight = useRef(new Set<string>());
  const failedAutoSaveRevisions = useRef<Record<string, number>>({});
  const previousActiveDocuments = useRef<Record<PaneId, string | undefined>>({ left: undefined, right: undefined });
  const previousAutoSaveMode = useRef(settings.autoSaveMode);
  const directoryCheckTokens = useRef<Record<DirectoryField, number>>({ defaultSaveFolder: 0, cloudSyncFolder: 0 });
  const closingRef = useRef(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ tabId: string; sourcePane: PaneId; pointerId: number; x: number; y: number } | null>(null);
  const dragViewRef = useRef<TabDragView | null>(null);
  const suppressTabClickRef = useRef<{ tabId: string; until: number } | null>(null);
  const splitResizePointerRef = useRef<number | null>(null);
  const updateCheckInFlight = useRef(false);
  const automaticUpdateCheckStarted = useRef(false);

  const activeDocumentId = tabs[activePane].find((tab) => tab.id === activeTab[activePane])?.documentId;
  const activeDocument = activeDocumentId ? documents[activeDocumentId] : undefined;
  const conflictDocument = modal.type === "conflict" ? documents[modal.documentId] : undefined;
  const paneActiveDocumentIds: Record<PaneId, string | undefined> = {
    left: tabs.left.find((tab) => tab.id === activeTab.left)?.documentId,
    right: tabs.right.find((tab) => tab.id === activeTab.right)?.documentId,
  };
  const leftComparisonDocument = paneActiveDocumentIds.left ? documents[paneActiveDocumentIds.left] : undefined;
  const rightComparisonDocument = paneActiveDocumentIds.right ? documents[paneActiveDocumentIds.right] : undefined;
  const canCompareSplitPanes = split && Boolean(leftComparisonDocument && rightComparisonDocument);
  const searchResult = useMemo(
    () => findSearchMatches(activeDocument?.content ?? "", search),
    [activeDocument?.content, search.query, search.replacement, search.caseSensitive, search.wholeWord, search.regexp],
  );
  const matches = searchResult.matches;
  const history = activeDocument ? histories[activeDocument.id] : undefined;
  const watchedFilePaths = useMemo(() => {
    const unique = new Map<string, string>();
    Object.values(documents).forEach((document) => {
      if (document.filePath) unique.set(normalizedWindowsPath(document.filePath), document.filePath);
    });
    return [...unique.values()].sort((left, right) => normalizedWindowsPath(left).localeCompare(normalizedWindowsPath(right)));
  }, [documents]);
  const watchedFileSignature = watchedFilePaths.map(normalizedWindowsPath).join("\0");

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }, []);

  const requestUpdateCheck = useCallback(async (automatic = false) => {
    if (updateCheckInFlight.current) return;
    updateCheckInFlight.current = true;
    setCheckingForUpdates(true);
    if (!automatic) setUpdateCheckStatus("idle");
    try {
      const result = await checkForUpdates();
      if (result.available) {
        setUpdateDialog({ update: result, status: "ready", progress: 0 });
      } else {
        setUpdateCheckStatus(result.error ? "failed" : "latest");
      }
    } finally {
      updateCheckInFlight.current = false;
      setCheckingForUpdates(false);
    }
  }, [flash, t]);

  const installAvailableUpdate = useCallback(async () => {
    if (!updateDialog || updateDialog.status === "downloading" || updateDialog.status === "installing") return;
    if (Object.values(documents).some((document) => document.dirty)) {
      flash(t("updateSaveFirst"));
      return;
    }
    const update = updateDialog.update;
    setUpdateDialog({ update, status: "downloading", progress: 0 });
    try {
      await update.install((progress: UpdateInstallProgress) => {
        if (progress.phase === "installing") {
          setUpdateDialog({ update, status: "installing", progress: 100 });
          return;
        }
        const percent = progress.total
          ? Math.min(99, Math.round((progress.downloaded / progress.total) * 100))
          : 0;
        setUpdateDialog({ update, status: "downloading", progress: percent });
      });
    } catch {
      setUpdateDialog({ update, status: "error", progress: 0 });
    }
  }, [documents, flash, t, updateDialog]);

  const rememberRecent = useCallback((paths: string[]) => {
    setRecentFiles((current) => {
      const next = [...paths, ...current].filter((path, index, all) => path && all.indexOf(path) === index).slice(0, settings.recentFileLimit);
      void persistRecentFiles(next);
      return next;
    });
  }, [settings.recentFileLimit]);

  const removeRecent = useCallback((path: string) => {
    setRecentFiles((current) => {
      const next = current.filter((item) => item !== path);
      void persistRecentFiles(next);
      return next;
    });
  }, []);

  const clearRecent = useCallback(() => {
    setRecentFiles((current) => {
      if (current.length === 0) return current;
      void persistRecentFiles([]);
      return [];
    });
    flash(t("recentFilesCleared"));
  }, []);

  const closeTargetsNow = useCallback((targets: TabCloseTarget[]) => {
    const state = useAppStore.getState();
    targets.forEach(({ pane, tabId }) => {
      const tab = state.tabs[pane].find((candidate) => candidate.id === tabId);
      const document = tab ? state.documents[tab.documentId] : undefined;
      if (document?.filePath) {
        rememberClosedTab({ path: document.filePath, fileName: document.fileName, closedAt: Date.now() });
      }
    });
    closeTabs(targets);
  }, [closeTabs, rememberClosedTab]);

  const validateSettingsDirectory = useCallback(async (field: DirectoryField, path?: string) => {
    const token = ++directoryCheckTokens.current[field];
    if (!path) {
      setDirectoryChecks((current) => ({ ...current, [field]: { status: "idle" } }));
      return true;
    }
    setDirectoryChecks((current) => ({ ...current, [field]: { status: "checking" } }));
    let result: DirectoryValidationResult;
    try {
      result = await validateDirectory(path);
    } catch {
      result = {
        valid: false,
        exists: false,
        isDirectory: false,
        readable: false,
        writable: false,
        availableBytes: 0,
        errorCode: "unavailable",
      };
    }
    if (directoryCheckTokens.current[field] === token) {
      setDirectoryChecks((current) => ({
        ...current,
        [field]: { status: result.valid ? "valid" : "invalid", result },
      }));
    }
    return result.valid;
  }, []);

  const openConflictModal = useCallback(async (documentId: string) => {
    if (conflictReadInFlight.current.has(documentId)) return;
    const snapshot = useAppStore.getState().documents[documentId];
    if (!snapshot?.filePath) return;
    const { filePath } = snapshot;
    conflictReadInFlight.current.add(documentId);
    try {
      const disk = await openDocumentPath(filePath);
      const current = useAppStore.getState().documents[documentId];
      if (!current || current.filePath !== filePath) return;
      updateDocumentFlags(documentId, { externalModified: true, missing: false });
      setModal({ type: "conflict", documentId, revision: current.revision, disk, phase: "compare" });
    } catch {
      updateDocumentFlags(documentId, { missing: true });
      flash(t("openFailed"));
    } finally {
      conflictReadInFlight.current.delete(documentId);
    }
  }, [flash, t, updateDocumentFlags]);

  const saveDocumentById = useCallback((documentId: string, intent: SaveIntent = {}) => {
    const existing = saveInFlight.current.get(documentId);
    if (existing) return existing;
    const task = (async () => {
      const snapshot = useAppStore.getState().documents[documentId];
      if (!snapshot) return false;
      if (intent.automatic) {
        if (!isAutoSaveEligible(snapshot)) return false;
        if (!intent.bypassFailure && isAutoSaveRevisionSuppressed(snapshot, failedAutoSaveRevisions.current[documentId])) return false;
      }

      let defaultSaveFolder: string | undefined;
      const currentSettings = useAppStore.getState().settings;
      if (!snapshot.filePath) {
        const resolution = await resolveInitialSaveFolder(
          currentSettings,
          encodedByteLength(snapshot),
          validateDirectory,
        );
        defaultSaveFolder = resolution.path;
        if (resolution.fallbackFrom) {
          flash(t(resolution.fallbackFrom === "cloud" ? "cloudFolderFallback" : "defaultFolderFallback"));
        }
      }

      try {
        const result = await saveDocument(snapshot, {
          forceSaveAs: intent.forceSaveAs,
          defaultSaveFolder,
        });
        if (!result) return false;
        markSaved(snapshot.id, result.path, snapshot.revision, result.fingerprint);
        if (intent.forceSaveAs) updateDocumentFlags(snapshot.id, { readOnly: false, missing: false });
        if (!intent.automatic || !snapshot.filePath) rememberRecent([result.path]);
        delete failedAutoSaveRevisions.current[snapshot.id];
        setAutoSaveFailures((current) => {
          if (!(snapshot.id in current)) return current;
          const next = { ...current };
          delete next[snapshot.id];
          return next;
        });
        if (intent.notifySuccess ?? !intent.automatic) flash(t("saved"));
        return true;
      } catch (error) {
        if (appErrorCode(error) === "external_conflict") {
          updateDocumentFlags(snapshot.id, { externalModified: true });
          if (!intent.automatic) void openConflictModal(snapshot.id);
          return false;
        }
        if (intent.automatic) {
          failedAutoSaveRevisions.current[snapshot.id] = snapshot.revision;
          setAutoSaveFailures((current) => ({ ...current, [snapshot.id]: snapshot.revision }));
        } else {
          const code = appErrorCode(error);
          flash(code ? t("saveFailedWithCode", { code }) : t("saveFailed"));
        }
        return false;
      }
    })();
    saveInFlight.current.set(documentId, task);
    void task.finally(() => {
      if (saveInFlight.current.get(documentId) === task) saveInFlight.current.delete(documentId);
    });
    return task;
  }, [flash, markSaved, openConflictModal, rememberRecent, t, updateDocumentFlags]);

  const openFiles = useCallback(async () => {
    try {
      const opened = await chooseAndOpenDocuments();
      opened.forEach((document) => addOpenedDocument(document, activePane));
      if (opened.length) {
        rememberRecent(opened.map((document) => document.path));
        flash(t("opened"));
      }
    } catch {
      flash(t("openFailed"));
    }
  }, [activePane, addOpenedDocument, flash, rememberRecent, t]);

  const openComparison = useCallback(() => {
    const state = useAppStore.getState();
    if (!state.split) return;
    const leftDocumentId = state.tabs.left.find((tab) => tab.id === state.activeTab.left)?.documentId;
    const rightDocumentId = state.tabs.right.find((tab) => tab.id === state.activeTab.right)?.documentId;
    const leftDocument = leftDocumentId ? state.documents[leftDocumentId] : undefined;
    const rightDocument = rightDocumentId ? state.documents[rightDocumentId] : undefined;
    if (!leftDocument || !rightDocument) return;
    setModal({ type: "compare", left: comparisonSnapshot(leftDocument), right: comparisonSnapshot(rightDocument) });
  }, []);

  const openRecent = useCallback(async (path: string) => {
    try {
      const opened = await openDocumentPath(path);
      addOpenedDocument(opened, activePane);
      rememberRecent([opened.path]);
      flash(t("opened"));
    } catch {
      setRecentFiles((current) => current.filter((item) => item !== path));
      flash(t("openFailed"));
    }
  }, [activePane, addOpenedDocument, flash, rememberRecent, t]);

  const reopenClosedTab = useCallback(async () => {
    const entry = useAppStore.getState().recentlyClosedTabs[0];
    if (!entry) return;
    try {
      const opened = await openDocumentPath(entry.path);
      addOpenedDocument(opened, useAppStore.getState().activePane);
      removeRecentlyClosedTab(entry.path);
      rememberRecent([opened.path]);
      flash(t("tabReopened"));
    } catch {
      flash(t("reopenClosedFailed"));
    }
  }, [addOpenedDocument, flash, rememberRecent, removeRecentlyClosedTab, t]);

  const saveActive = useCallback((forceSaveAs = false) => (
    activeDocument ? saveDocumentById(activeDocument.id, { forceSaveAs }) : Promise.resolve(false)
  ), [activeDocument, saveDocumentById]);

  const refreshConflictWithLatestDisk = useCallback(async (
    conflict: Extract<ModalState, { type: "conflict" }>,
    message: Extract<ModalState, { type: "conflict" }> ["message"] = "disk-changed",
  ) => {
    const document = useAppStore.getState().documents[conflict.documentId];
    if (!document?.filePath) return;
    try {
      const disk = await openDocumentPath(document.filePath);
      const current = useAppStore.getState().documents[conflict.documentId];
      if (!current || current.filePath !== document.filePath) return;
      setModal({ type: "conflict", documentId: current.id, revision: current.revision, disk, phase: "compare", message });
    } catch {
      updateDocumentFlags(conflict.documentId, { missing: true });
      setModal((current) => current.type === "conflict" && current.documentId === conflict.documentId
        ? { ...current, busy: undefined, message: "action-failed" }
        : current);
    }
  }, [updateDocumentFlags]);

  const handleConflictSaveCopy = useCallback(async () => {
    if (modal.type !== "conflict") return;
    const conflict = modal;
    const document = useAppStore.getState().documents[conflict.documentId];
    if (!document?.filePath || document.revision !== conflict.revision) return void refreshConflictWithLatestDisk(conflict);
    setModal({ ...conflict, busy: "save-copy" });
    try {
      const result = await saveDocument(document, { forceSaveAs: true, requireDifferentPath: document.filePath });
      if (!result) {
        setModal((current) => current.type === "conflict" && current.documentId === conflict.documentId
          ? { ...current, busy: undefined }
          : current);
        return;
      }
      markSaved(document.id, result.path, document.revision, result.fingerprint);
      updateDocumentFlags(document.id, { externalModified: false, missing: false, readOnly: false });
      rememberRecent([result.path]);
      flash(t("saved"));
      setModal({ type: "none" });
    } catch (error) {
      setModal((current) => current.type === "conflict" && current.documentId === conflict.documentId
        ? { ...current, busy: undefined, message: appErrorCode(error) === "same_file_path" ? "same-path" : "action-failed" }
        : current);
    }
  }, [flash, markSaved, modal, refreshConflictWithLatestDisk, rememberRecent, t, updateDocumentFlags]);

  const handleConflictReload = useCallback(async () => {
    if (modal.type !== "conflict") return;
    const conflict = modal;
    const document = useAppStore.getState().documents[conflict.documentId];
    if (!document?.filePath || document.revision !== conflict.revision) return void refreshConflictWithLatestDisk(conflict);
    setModal({ ...conflict, busy: "reload" });
    try {
      const latest = await openDocumentPath(document.filePath);
      if (!sameFingerprint(latest.fingerprint, conflict.disk.fingerprint)) return void refreshConflictWithLatestDisk(conflict);
      await writeSafetyRecovery(recoverySnapshot(document), useAppStore.getState().settings, "conflict-local");
      if (!replaceDocumentFromDisk(document.id, latest, document.revision)) return void refreshConflictWithLatestDisk(conflict);
      flash(t("fileReloaded"));
      setModal({ type: "none" });
    } catch {
      setModal((current) => current.type === "conflict" && current.documentId === conflict.documentId
        ? { ...current, busy: undefined, message: "backup-failed" }
        : current);
    }
  }, [flash, modal, refreshConflictWithLatestDisk, replaceDocumentFromDisk, t]);

  const handleConflictOverwrite = useCallback(async () => {
    if (modal.type !== "conflict") return;
    const conflict = modal;
    const document = useAppStore.getState().documents[conflict.documentId];
    if (!document?.filePath || document.revision !== conflict.revision) return void refreshConflictWithLatestDisk(conflict);
    setModal({ ...conflict, busy: "overwrite" });
    try {
      const latest = await openDocumentPath(document.filePath);
      if (!sameFingerprint(latest.fingerprint, conflict.disk.fingerprint)) return void refreshConflictWithLatestDisk(conflict);
      await writeSafetyRecovery({
        documentId: document.id,
        fileName: latest.name,
        originalPath: latest.path,
        content: latest.content,
        encoding: latest.encoding,
        lineEnding: latest.lineEnding,
      }, useAppStore.getState().settings, "conflict-disk");
      const result = await saveDocument(document, { acceptedExternalFingerprint: latest.fingerprint ?? undefined });
      if (!result) throw new Error("save-cancelled");
      markSaved(document.id, result.path, document.revision, result.fingerprint);
      updateDocumentFlags(document.id, { externalModified: false, missing: false });
      flash(t("saved"));
      setModal({ type: "none" });
    } catch (error) {
      if (appErrorCode(error) === "external_conflict") return void refreshConflictWithLatestDisk(conflict);
      setModal((current) => current.type === "conflict" && current.documentId === conflict.documentId
        ? { ...current, busy: undefined, message: "backup-failed" }
        : current);
    }
  }, [flash, markSaved, modal, refreshConflictWithLatestDisk, t, updateDocumentFlags]);

  const checkDocumentOnDisk = useCallback((documentId: string) => {
    const saveTask = saveInFlight.current.get(documentId);
    if (saveTask) {
      if (!pendingDiskChecks.current.has(documentId)) {
        pendingDiskChecks.current.add(documentId);
        void saveTask.finally(() => {
          if (pendingDiskChecks.current.delete(documentId)) diskCheckRunner.current(documentId);
        });
      }
      return;
    }
    if (diskCheckInFlight.current.has(documentId)) {
      pendingDiskChecks.current.add(documentId);
      return;
    }
    const snapshot = useAppStore.getState().documents[documentId];
    if (!snapshot?.filePath || !snapshot.fingerprint) return;
    const filePath = snapshot.filePath;
    diskCheckInFlight.current.add(documentId);
    void openDocumentPath(filePath).then((disk) => {
      const current = useAppStore.getState().documents[documentId];
      if (!current || current.filePath !== filePath || !disk.fingerprint) return;
      if (disk.fingerprint.hash === current.fingerprint?.hash) {
        refreshDocumentDiskState(documentId, filePath, disk.fingerprint, disk.readOnly);
        return;
      }
      if (current.dirty || current.revision !== snapshot.revision) {
        updateDocumentFlags(documentId, { externalModified: true, missing: false, readOnly: disk.readOnly });
        return;
      }
      if (replaceDocumentFromDisk(documentId, disk, snapshot.revision)) flash(t("fileReloaded"));
    }).catch(() => updateDocumentFlags(documentId, { missing: true })).finally(() => {
      diskCheckInFlight.current.delete(documentId);
      if (pendingDiskChecks.current.delete(documentId)) diskCheckRunner.current(documentId);
    });
  }, [flash, refreshDocumentDiskState, replaceDocumentFromDisk, t, updateDocumentFlags]);
  diskCheckRunner.current = checkDocumentOnDisk;

  const checkDocumentMetadata = useCallback((documentId: string) => {
    const snapshot = useAppStore.getState().documents[documentId];
    if (!snapshot?.filePath || !snapshot.fingerprint || snapshot.externalModified || saveInFlight.current.has(documentId)) return;
    const filePath = snapshot.filePath;
    void inspectFileMetadata(filePath).then((metadata) => {
      if (!metadata) return;
      const current = useAppStore.getState().documents[documentId];
      if (!current || current.filePath !== filePath || !current.fingerprint) return;
      if (!metadata.exists) {
        updateDocumentFlags(documentId, { missing: true });
        return;
      }
      if (metadata.modifiedAt !== current.fingerprint.modifiedAt || metadata.size !== current.fingerprint.size) {
        checkDocumentOnDisk(documentId);
        return;
      }
      if (current.readOnly !== metadata.readOnly || current.missing) {
        updateDocumentFlags(documentId, { readOnly: metadata.readOnly, missing: false });
      }
    }).catch(() => undefined);
  }, [checkDocumentOnDisk, updateDocumentFlags]);

  useEffect(() => {
    if (modal.type !== "settings") return;
    void validateSettingsDirectory("defaultSaveFolder", settings.defaultSaveFolder);
    void validateSettingsDirectory("cloudSyncFolder", settings.cloudSyncFolder);
  }, [modal.type, settings.defaultSaveFolder, settings.cloudSyncFolder, validateSettingsDirectory]);

  const applySettings = useCallback(async () => {
    if (settingsApplying) return;
    setSettingsApplying(true);
    const nextSettings = useAppStore.getState().settings;
    try {
      const [defaultValid, cloudValid] = await Promise.all([
        validateSettingsDirectory("defaultSaveFolder", nextSettings.defaultSaveFolder),
        validateSettingsDirectory("cloudSyncFolder", nextSettings.cloudSyncFolder),
      ]);
      if (!defaultValid || !cloudValid) return;
      await Promise.all([persistSettings(nextSettings), pruneRecoveries(nextSettings)]);
      setModal({ type: "none" });
      flash(t("settingsSaved"));
    } catch {
      flash(t("settingsSaveFailed"));
    } finally {
      setSettingsApplying(false);
    }
  }, [flash, settingsApplying, t, validateSettingsDirectory]);

  const requestCloseTabs = useCallback((targets: TabCloseTarget[], bulk = false) => {
    const state = useAppStore.getState();
    const seenTabs = new Set<string>();
    const validTargets = targets.filter(({ pane, tabId }) => {
      if (seenTabs.has(tabId) || !state.tabs[pane].some((tab) => tab.id === tabId)) return false;
      seenTabs.add(tabId);
      return true;
    });
    if (validTargets.length === 0) return;
    const dirtyDocuments = validTargets.reduce<DocumentRecord[]>((result, { pane, tabId }) => {
      const tab = state.tabs[pane].find((candidate) => candidate.id === tabId);
      const document = tab ? state.documents[tab.documentId] : undefined;
      if (document && needsSaveConfirmation(document) && !result.some((candidate) => candidate.id === document.id)) result.push(document);
      return result;
    }, []);
    if (dirtyDocuments.length === 0) {
      closeTargetsNow(validTargets);
      return;
    }
    if (!bulk && validTargets.length === 1) {
      const target = validTargets[0];
      setModal({ type: "close-tab", ...target, document: dirtyDocuments[0] });
      return;
    }
    setModal({ type: "bulk-close", targets: validTargets, documents: dirtyDocuments });
  }, [closeTargetsNow]);

  const requestCloseTab = useCallback((pane: PaneId, tabId: string) => {
    requestCloseTabs([{ pane, tabId }]);
  }, [requestCloseTabs]);

  const saveAllAndCloseTabs = useCallback(async (targets: TabCloseTarget[], dirtyDocuments: DocumentRecord[]) => {
    for (const document of dirtyDocuments) {
      const saved = await saveDocumentById(document.id, { notifySuccess: false });
      if (!saved) return;
    }
    closeTargetsNow(targets);
    setModal({ type: "none" });
  }, [closeTargetsNow, saveDocumentById]);

  useEffect(() => {
    void Promise.all([
      beginAppSession(),
      loadSettings().catch(() => null),
      loadSession().catch(() => null),
      loadRecentFiles().catch(() => []),
      loadRecentlyClosedTabs().catch(() => []),
    ]).then(([startupStatus, storedSettings, storedSession, storedRecent, storedClosedTabs]) => {
      if (storedSettings) loadSettingsIntoStore(storedSettings);
      const effectiveSettings = useAppStore.getState().settings;
      const explicitPreviewState = new URLSearchParams(window.location.search).has("state");
      const decision = decideStartupRecovery(
        effectiveSettings.sessionRecoveryMode,
        startupStatus,
        storedSession,
        explicitPreviewState,
      );
      if (decision === "restore" && storedSession) restoreSessionIntoStore(storedSession);
      if (decision === "ask" && storedSession) setModal({ type: "startup-recovery", session: storedSession });
      setRecentFiles(storedRecent);
      loadRecentlyClosedTabsIntoStore(storedClosedTabs);
      void pruneRecoveries(effectiveSettings).catch(() => undefined);
      if (decision !== "ask") setHydrated(true);
    }).catch(() => setHydrated(true));
  }, [loadRecentlyClosedTabsIntoStore, loadSettingsIntoStore, restoreSessionIntoStore]);

  useEffect(() => {
    void getAppVersion().then(setAppVersion).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!hydrated || !settings.autoCheckUpdates || automaticUpdateCheckStarted.current) return;
    automaticUpdateCheckStarted.current = true;
    const timer = window.setTimeout(() => void requestUpdateCheck(true), 1_500);
    return () => window.clearTimeout(timer);
  }, [hydrated, requestUpdateCheck, settings.autoCheckUpdates]);

  useEffect(() => {
    const resolved = resolveLocale(settings.locale);
    void i18n.changeLanguage(resolved);
    document.documentElement.dataset.appearance = settings.appearanceMode;
    document.documentElement.dataset.accent = settings.accentTheme;
    document.documentElement.style.setProperty("--editor-font", settings.fontFamily === "ui-monospace"
      ? '"Cascadia Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace'
      : settings.fontFamily + ", monospace");
    document.documentElement.style.setProperty("--accent-primary", accentMap[settings.accentTheme]);
  }, [settings.locale, settings.appearanceMode, settings.accentTheme, settings.fontFamily]);

  useEffect(() => {
    Object.values(documents).forEach((document) => {
      window.clearTimeout(backupTimers.current[document.id]);
      if (!document.dirty || !settings.autoBackupEnabled) return;
      backupTimers.current[document.id] = window.setTimeout(
        () => void writeRecovery(document, settings),
        settings.backupDebounceSeconds * 1000,
      );
    });
    return () => Object.values(backupTimers.current).forEach(window.clearTimeout);
  }, [documents, settings]);

  useEffect(() => {
    if (previousAutoSaveMode.current === settings.autoSaveMode) return;
    previousAutoSaveMode.current = settings.autoSaveMode;
    Object.values(idleSaveTimers.current).forEach(({ timer }) => window.clearTimeout(timer));
    idleSaveTimers.current = {};
    failedAutoSaveRevisions.current = {};
    setAutoSaveFailures({});
  }, [settings.autoSaveMode]);

  useEffect(() => {
    const timers = idleSaveTimers.current;
    const liveIds = new Set(Object.keys(documents));
    Object.keys(timers).forEach((documentId) => {
      if (!liveIds.has(documentId) || settings.autoSaveMode !== "idle") {
        window.clearTimeout(timers[documentId].timer);
        delete timers[documentId];
      }
    });
    if (!hydrated || settings.autoSaveMode !== "idle") return;
    Object.values(documents).forEach((document) => {
      const existing = timers[document.id];
      const eligible = isAutoSaveEligible(document)
        && !isAutoSaveRevisionSuppressed(document, failedAutoSaveRevisions.current[document.id]);
      if (!eligible) {
        if (existing) window.clearTimeout(existing.timer);
        delete timers[document.id];
        return;
      }
      if (existing?.revision === document.revision) return;
      if (existing) window.clearTimeout(existing.timer);
      timers[document.id] = {
        revision: document.revision,
        timer: window.setTimeout(() => {
          delete idleSaveTimers.current[document.id];
          void saveDocumentById(document.id, { automatic: true });
        }, 10_000),
      };
    });
  }, [documents, hydrated, saveDocumentById, settings.autoSaveMode]);

  useEffect(() => {
    if (!hydrated || settings.autoSaveMode !== "interval") return;
    const timer = window.setInterval(() => {
      Object.values(useAppStore.getState().documents).forEach((document) => {
        if (isAutoSaveEligible(document)) void saveDocumentById(document.id, { automatic: true });
      });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [hydrated, saveDocumentById, settings.autoSaveMode]);

  useEffect(() => {
    if (!hydrated || settings.autoSaveMode !== "blur") return;
    const onBlur = () => {
      Object.values(useAppStore.getState().documents).forEach((document) => {
        if (isAutoSaveEligible(document)) void saveDocumentById(document.id, { automatic: true });
      });
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [hydrated, saveDocumentById, settings.autoSaveMode]);

  useEffect(() => {
    const previous = previousActiveDocuments.current;
    if (hydrated && settings.autoSaveMode === "tab-switch") {
      (["left", "right"] as PaneId[]).forEach((pane) => {
        const previousId = previous[pane];
        const currentId = paneActiveDocumentIds[pane];
        if (previousId && previousId !== currentId && useAppStore.getState().documents[previousId]) {
          void saveDocumentById(previousId, { automatic: true });
        }
      });
    }
    previousActiveDocuments.current = paneActiveDocumentIds;
  }, [hydrated, paneActiveDocumentIds.left, paneActiveDocumentIds.right, saveDocumentById, settings.autoSaveMode]);

  useEffect(() => {
    const documentIds = new Set(Object.keys(documents));
    setAutoSaveFailures((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([documentId]) => documentIds.has(documentId)));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
    Object.keys(failedAutoSaveRevisions.current).forEach((documentId) => {
      if (!documentIds.has(documentId)) delete failedAutoSaveRevisions.current[documentId];
    });
  }, [documents]);

  useEffect(() => () => {
    Object.values(idleSaveTimers.current).forEach(({ timer }) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      if (closingRef.current) return;
      void persistSession(createWorkspaceSession({ split, splitRatio, activeTab, tabs, documents }));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [activeTab, documents, hydrated, split, splitRatio, tabs]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => void persistRecentlyClosedTabs(recentlyClosedTabs), 200);
    return () => window.clearTimeout(timer);
  }, [hydrated, recentlyClosedTabs]);

  const finishClose = useCallback(async (discardDirty = false) => {
    closingRef.current = true;
    const state = useAppStore.getState();
    await persistSession(createWorkspaceSession(state, discardDirty)).catch(() => undefined);
    await closeWindow();
  }, []);

  const requestCloseWindow = useCallback(() => {
    const dirty = Object.values(documents).filter(needsSaveConfirmation);
    if (dirty.length) setModal({ type: "exit", documents: dirty });
    else void finishClose();
  }, [documents, finishClose]);

  const saveAllAndExit = useCallback(async (dirtyDocuments: DocumentRecord[]) => {
    for (const document of dirtyDocuments) {
      const saved = await saveDocumentById(document.id, { notifySuccess: false });
      if (!saved) return;
    }
    await finishClose();
  }, [finishClose, saveDocumentById]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: () => void = () => undefined;
    void listenForWindowClose(requestCloseWindow).then((dispose) => {
      if (cancelled) dispose();
      else unlisten = dispose;
    });
    return () => {
      cancelled = true;
      unlisten();
    };
  }, [requestCloseWindow]);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    let unlisten: () => void = () => undefined;
    void listenForFileWatchChanges((paths) => {
      const changed = new Set(paths.map(normalizedWindowsPath));
      Object.values(useAppStore.getState().documents).forEach((document) => {
        if (document.filePath && changed.has(normalizedWindowsPath(document.filePath))) {
          checkDocumentOnDisk(document.id);
        }
      });
    }).then((dispose) => {
      if (cancelled) dispose();
      else {
        unlisten = dispose;
        setFileWatchListenerReady(true);
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten();
    };
  }, [checkDocumentOnDisk, hydrated]);

  useEffect(() => {
    if (!hydrated || !fileWatchListenerReady) return;
    void syncFileWatches(watchedFilePaths).catch(() => undefined);
  }, [fileWatchListenerReady, hydrated, watchedFileSignature]);

  useEffect(() => () => {
    void syncFileWatches([]).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setInterval(() => {
      Object.values(useAppStore.getState().documents).forEach((document) => checkDocumentMetadata(document.id));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [checkDocumentMetadata, hydrated]);

  const updateTabDrag = useCallback((next: TabDragView | null) => {
    dragViewRef.current = next;
    setTabDrag(next);
  }, []);

  const beginTabDrag = useCallback((pane: PaneId, tabId: string, event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest(".tab-close")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = { tabId, sourcePane: pane, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    updateTabDrag({ tabId, sourcePane: pane, x: event.clientX, y: event.clientY, dragging: false });
    setTabContextMenu(null);
  }, [updateTabDrag]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const start = dragStartRef.current;
      if (!start || start.pointerId !== event.pointerId) return;
      const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (distance < 6 && !dragViewRef.current?.dragging) return;
      event.preventDefault();
      const state = useAppStore.getState();
      const workspace = workspaceRef.current?.getBoundingClientRect();
      let targetPane: PaneId | undefined;
      let rightEdge = false;
      if (!state.split && workspace && event.clientX >= workspace.right - Math.max(120, workspace.width * 0.18)) {
        targetPane = "right";
        rightEdge = true;
      } else {
        const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
        const paneElement = element?.closest<HTMLElement>("[data-pane-drop]");
        const candidate = paneElement?.dataset.paneDrop;
        if (candidate === "left" || candidate === "right") targetPane = candidate;
      }
      let targetIndex: number | undefined;
      let beforeTabId: string | undefined;
      if (targetPane) {
        const candidates = state.tabs[targetPane].filter((tab) => tab.id !== start.tabId);
        const tabbar = document.querySelector<HTMLElement>(`[data-tabbar-pane="${targetPane}"]`);
        const overTabbar = tabbar?.getBoundingClientRect();
        const withinTabbar = Boolean(overTabbar && event.clientY >= overTabbar.top && event.clientY <= overTabbar.bottom);
        if (withinTabbar) {
          const before = candidates.find((tab) => {
            const element = document.querySelector<HTMLElement>(`[data-tab-id="${tab.id}"]`);
            if (!element) return false;
            const rect = element.getBoundingClientRect();
            return event.clientX < rect.left + rect.width / 2;
          });
          beforeTabId = before?.id;
          targetIndex = before ? candidates.findIndex((tab) => tab.id === before.id) : candidates.length;
        } else {
          targetIndex = candidates.length;
        }
      }
      updateTabDrag({
        tabId: start.tabId,
        sourcePane: start.sourcePane,
        x: event.clientX,
        y: event.clientY,
        dragging: true,
        targetPane,
        targetIndex,
        beforeTabId,
        rightEdge,
      });
    };
    const finish = (event: PointerEvent) => {
      const start = dragStartRef.current;
      if (!start || start.pointerId !== event.pointerId) return;
      const view = dragViewRef.current;
      if (view?.dragging) {
        suppressTabClickRef.current = { tabId: start.tabId, until: Date.now() + 300 };
        if (view.targetPane && view.targetIndex !== undefined) moveTab(start.tabId, view.targetPane, view.targetIndex);
      }
      dragStartRef.current = null;
      updateTabDrag(null);
    };
    const cancel = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (typeof PointerEvent !== "undefined" && event instanceof PointerEvent && dragStartRef.current?.pointerId !== event.pointerId) return;
      dragStartRef.current = null;
      updateTabDrag(null);
    };
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", cancel);
    };
  }, [moveTab, updateTabDrag]);

  const activateTab = useCallback((pane: PaneId, tabId: string) => {
    const suppressed = suppressTabClickRef.current;
    if (suppressed?.tabId === tabId && suppressed.until > Date.now()) return;
    setActiveTab(pane, tabId);
  }, [setActiveTab]);

  const ratioFromPointer = useCallback((clientX: number) => {
    const rect = workspaceRef.current?.getBoundingClientRect();
    if (!rect) return splitRatio;
    const usable = Math.max(1, rect.width - 12);
    const minimum = Math.min(0.5, 320 / usable);
    return Math.min(1 - minimum, Math.max(minimum, (clientX - rect.left) / usable));
  }, [splitRatio]);

  const onSplitPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    splitResizePointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizingSplit(true);
  }, []);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (splitResizePointerRef.current !== event.pointerId) return;
      event.preventDefault();
      setSplitRatio(ratioFromPointer(event.clientX));
    };
    const finish = (event: PointerEvent) => {
      if (splitResizePointerRef.current !== event.pointerId) return;
      splitResizePointerRef.current = null;
      setResizingSplit(false);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [ratioFromPointer, setSplitRatio]);

  const onSplitKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const step = event.shiftKey ? 0.05 : 0.02;
    const rect = workspaceRef.current?.getBoundingClientRect();
    const usable = Math.max(1, (rect?.width ?? 652) - 12);
    const minimum = Math.min(0.5, 320 / usable);
    setSplitRatio(Math.min(1 - minimum, Math.max(minimum, splitRatio + direction * step)));
  }, [setSplitRatio, splitRatio]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (event.key === "Escape" && modal.type === "compare") {
        event.preventDefault();
        setModal({ type: "none" });
        return;
      }
      if (!mod || modal.type !== "none") return;
      const key = event.key.toLowerCase();
      if (key === "w") {
        const tabId = useAppStore.getState().activeTab[useAppStore.getState().activePane];
        if (tabId) { event.preventDefault(); requestCloseTab(useAppStore.getState().activePane, tabId); }
      }
      if (key === "tab") {
        const state = useAppStore.getState();
        const paneTabs = state.tabs[state.activePane];
        const index = paneTabs.findIndex((tab) => tab.id === state.activeTab[state.activePane]);
        if (paneTabs.length) {
          event.preventDefault();
          const direction = event.shiftKey ? -1 : 1;
          const next = paneTabs[(Math.max(0, index) + direction + paneTabs.length) % paneTabs.length];
          setActiveTab(state.activePane, next.id);
        }
      }
      if (key === "t" && event.shiftKey) { event.preventDefault(); void reopenClosedTab(); }
      if (key === "n") { event.preventDefault(); createDocument(activePane); }
      if (key === "o") { event.preventDefault(); void openFiles(); }
      if (key === "d" && event.shiftKey && canCompareSplitPanes) { event.preventDefault(); openComparison(); }
      if (key === "s") { event.preventDefault(); void saveActive(event.shiftKey); }
      if (key === "f") { event.preventDefault(); setSearch({ open: true, replaceOpen: false }); }
      if (key === "h") { event.preventDefault(); setSearch({ open: true, replaceOpen: true }); }
      if (key === "g" && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement)) { event.preventDefault(); goToLineInPane(activePane); }
      if (key === "\\") { event.preventDefault(); toggleSplit(); }
      if (key === ",") { event.preventDefault(); setModal({ type: "settings", snapshot: settings }); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePane, canCompareSplitPanes, createDocument, modal.type, openComparison, openFiles, reopenClosedTab, requestCloseTab, saveActive, setActiveTab, setSearch, settings, toggleSplit]);

  const contextTabs = tabContextMenu ? tabs[tabContextMenu.pane] : [];
  const contextTabIndex = tabContextMenu?.tabId ? contextTabs.findIndex((tab) => tab.id === tabContextMenu.tabId) : -1;
  const contextTab = contextTabIndex >= 0 ? contextTabs[contextTabIndex] : undefined;
  const contextDocument = contextTab ? documents[contextTab.documentId] : undefined;
  const dragTab = tabDrag ? tabs[tabDrag.sourcePane].find((tab) => tab.id === tabDrag.tabId) : undefined;
  const dragDocument = dragTab ? documents[dragTab.documentId] : undefined;

  return (
    <main className="app-shell">
      <TitleBar onClose={requestCloseWindow} />
      <Toolbar
        canUndo={Boolean(history?.undo.length)}
        canRedo={Boolean(history?.redo.length)}
        split={split}
        wrap={settings.wordWrapByDefault}
        canCompare={canCompareSplitPanes}
        onNew={() => createDocument(activePane)}
        onOpen={() => void openFiles()}
        onSave={() => void saveActive()}
        onUndo={() => activeDocument && undoDocument(activeDocument.id)}
        onRedo={() => activeDocument && redoDocument(activeDocument.id)}
        onFind={() => { setSearch({ open: true, replaceOpen: false }); window.setTimeout(() => focusEditor(activePane), 0); }}
        onCompare={() => void openComparison()}
        onWrap={() => updateSettings({ wordWrapByDefault: !settings.wordWrapByDefault })}
        onSplit={toggleSplit}
        onSettings={() => setModal({ type: "settings", snapshot: settings })}
      />

      {search.open && <SearchBar pane={activePane} matches={matches} searchValid={searchResult.valid} matchIndex={matchIndex} onMatchIndex={setMatchIndex} />}

      {activeDocument?.externalModified && (
        <div className="notice-bar">
          <div><strong>{t("externalChanged")}</strong><span>{t("externalChangedBody")}</span></div>
          <button type="button" className="button-secondary" onClick={() => void openConflictModal(activeDocument.id)}>{t("handleConflict")}</button>
        </div>
      )}
      {activeDocument?.missing && <div className="notice-bar warning"><span>{t("missingFile")}</span><button type="button" className="button-secondary" onClick={() => void saveActive(true)}>{t("saveAs")}</button></div>}
      {activeDocument?.readOnly && <div className="notice-bar"><span>{t("readonlyNotice")}</span><button type="button" className="button-secondary" onClick={() => void saveActive(true)}>{t("saveAs")}</button></div>}
      {activeDocument && autoSaveFailures[activeDocument.id] !== undefined && (
        <div className="notice-bar warning" role="alert">
          <div><strong>{t("autoSaveFailed")}</strong><span>{t("autoSaveFailedBody")}</span></div>
          <div className="notice-actions">
            <button type="button" className="button-secondary" onClick={() => void saveDocumentById(activeDocument.id, { automatic: true, bypassFailure: true })}>{t("retry")}</button>
            <button type="button" className="button-secondary" onClick={() => void saveDocumentById(activeDocument.id, { forceSaveAs: true })}>{t("saveAs")}</button>
          </div>
        </div>
      )}

      <div
        ref={workspaceRef}
        className={"workspace " + (split ? "split " : "") + (resizingSplit ? "resizing " : "")}
        style={split ? { gridTemplateColumns: `minmax(320px, ${splitRatio}fr) 12px minmax(320px, ${1 - splitRatio}fr)` } : undefined}
      >
        {tabs.left.length === 0 && tabs.right.length === 0 && !split ? (
          <Welcome
            recentFiles={recentFiles}
            onNew={() => createDocument("left")}
            onOpen={() => void openFiles()}
            onOpenRecent={(path) => void openRecent(path)}
            onRemoveRecent={removeRecent}
            onClearRecent={clearRecent}
            onRecovery={() => setModal({ type: "recovery" })}
            onRestoreSession={() => void loadSession().then((session) => session && restoreSessionIntoStore(session))}
          />
        ) : <EditorPane pane="left" onCloseTab={requestCloseTab} onActivateTab={activateTab} onTabPointerDown={beginTabDrag} onTabContextMenu={setTabContextMenu} drag={tabDrag} />}
        {split && (
          <>
            <div
              className="split-divider"
              role="separator"
              aria-label={t("resizeSplit")}
              aria-orientation="vertical"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(splitRatio * 100)}
              tabIndex={0}
              onPointerDown={onSplitPointerDown}
              onKeyDown={onSplitKeyDown}
            ><DotsThree size={20} weight="bold" /></div>
            <EditorPane pane="right" onCloseTab={requestCloseTab} onActivateTab={activateTab} onTabPointerDown={beginTabDrag} onTabContextMenu={setTabContextMenu} drag={tabDrag} />
          </>
        )}
        {tabDrag?.dragging && tabDrag.rightEdge && <div className="split-drop-overlay" aria-hidden="true"><Columns size={28} /><span>{t("dropToSplit")}</span></div>}
      </div>

      {tabDrag?.dragging && dragDocument && <div className="tab-drag-ghost" style={{ left: tabDrag.x + 12, top: tabDrag.y + 12 }}><FileText size={16} /><span>{dragDocument.fileName === "Untitled" ? t("untitled") : dragDocument.fileName}</span></div>}

      {tabContextMenu && (
        <TabContextMenu
          menu={tabContextMenu}
          filePath={contextDocument?.filePath}
          hasOtherTabs={Boolean(contextTab && contextTabs.length > 1)}
          hasTabsToRight={contextTabIndex >= 0 && contextTabIndex < contextTabs.length - 1}
          recent={recentlyClosedTabs[0]}
          showCloseSplit={split && tabContextMenu.pane === "right"}
          onDismiss={() => setTabContextMenu(null)}
          onNew={() => createDocument(tabContextMenu.pane)}
          onClose={() => contextTab && requestCloseTab(tabContextMenu.pane, contextTab.id)}
          onCloseOthers={() => contextTab && requestCloseTabs(contextTabs.filter((tab) => tab.id !== contextTab.id).map((tab) => ({ pane: tabContextMenu.pane, tabId: tab.id })), true)}
          onCloseRight={() => contextTab && requestCloseTabs(contextTabs.slice(contextTabIndex + 1).map((tab) => ({ pane: tabContextMenu.pane, tabId: tab.id })), true)}
          onMove={() => contextTab && moveTab(contextTab.id, tabContextMenu.pane === "left" ? "right" : "left", tabs[tabContextMenu.pane === "left" ? "right" : "left"].length)}
          onCopyPath={() => contextDocument?.filePath && void copyText(contextDocument.filePath).then(() => flash(t("filePathCopied"))).catch(() => flash(t("copyFilePathFailed")))}
          onRevealInFolder={() => contextDocument?.filePath && void revealFileInDirectory(contextDocument.filePath).catch(() => flash(t("revealInFolderFailed")))}
          onCloseSplit={toggleSplit}
          onReopen={() => void reopenClosedTab()}
        />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}

      {modal.type === "settings" && (
        <SettingsModal
          settings={settings}
          directoryChecks={directoryChecks}
          applying={settingsApplying}
          currentVersion={appVersion}
          checkingForUpdates={checkingForUpdates}
          updateCheckStatus={updateCheckStatus}
          canApply={(["defaultSaveFolder", "cloudSyncFolder"] as DirectoryField[]).every((field) => (
            !settings[field] || directoryChecks[field].status === "valid"
          ))}
          onChange={updateSettings}
          onApply={() => void applySettings()}
          onCancel={() => { loadSettingsIntoStore(modal.snapshot); setModal({ type: "none" }); }}
          onChooseDirectory={(field) => void chooseDirectory().then((path) => {
            if (!path) return;
            setDirectoryChecks((current) => ({ ...current, [field]: { status: "checking" } }));
            updateSettings({ [field]: path });
          })}
          onClearDirectory={(field) => updateSettings({ [field]: undefined })}
          onOpenRecovery={() => setModal({ type: "recovery" })}
          onCheckUpdates={() => void requestUpdateCheck(false)}
          onOpenSource={() => void showSourceCode()}
          onOpenAuthorWebsite={() => void showAuthorWebsite()}
        />
      )}
      {modal.type === "recovery" && <RecoveryModal onClose={() => setModal({ type: "none" })} />}
      {modal.type === "conflict" && conflictDocument && (
        <ConflictModal
          modal={modal}
          document={conflictDocument}
          onLater={() => setModal({ type: "none" })}
          onSaveCopy={() => void handleConflictSaveCopy()}
          onReload={() => void handleConflictReload()}
          onRequestOverwrite={() => setModal((current) => current.type === "conflict" ? { ...current, phase: "confirm-overwrite", message: undefined } : current)}
          onCancelOverwrite={() => setModal((current) => current.type === "conflict" ? { ...current, phase: "compare" } : current)}
          onConfirmOverwrite={() => void handleConflictOverwrite()}
        />
      )}
      {modal.type === "compare" && <CompareModal modal={modal} onClose={() => setModal({ type: "none" })} />}
      {modal.type === "startup-recovery" && (
        <StartupRecoveryModal
          session={modal.session}
          onStartFresh={() => { setModal({ type: "none" }); setHydrated(true); }}
          onRestore={() => {
            restoreSessionIntoStore(modal.session);
            setModal({ type: "none" });
            setHydrated(true);
          }}
        />
      )}
      {modal.type === "exit" && (
        <ExitModal
          documents={modal.documents}
          onCancel={() => setModal({ type: "none" })}
          onDiscard={() => void finishClose(true)}
          onSave={() => void saveAllAndExit(modal.documents)}
        />
      )}
      {modal.type === "bulk-close" && (
        <BulkCloseModal
          documents={modal.documents}
          onCancel={() => setModal({ type: "none" })}
          onDiscard={() => { closeTargetsNow(modal.targets); setModal({ type: "none" }); }}
          onSave={() => void saveAllAndCloseTabs(modal.targets, modal.documents)}
        />
      )}
      {modal.type === "close-tab" && (
        <CloseTabModal
          modal={modal}
          onCancel={() => setModal({ type: "none" })}
          onDiscard={() => { closeTargetsNow([{ pane: modal.pane, tabId: modal.tabId }]); setModal({ type: "none" }); }}
          onSave={() => void saveDocumentById(modal.document.id, { notifySuccess: false }).then((saved) => {
            if (!saved) return;
            closeTargetsNow([{ pane: modal.pane, tabId: modal.tabId }]);
            setModal({ type: "none" });
          })}
        />
      )}
      {updateDialog && (
        <UpdateModal
          state={updateDialog}
          onClose={() => setUpdateDialog(null)}
          onInstall={() => void installAvailableUpdate()}
        />
      )}
    </main>
  );
}
