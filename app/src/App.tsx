import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  CaretDown,
  CaretUp,
  Columns,
  DotsThree,
  FilePlus,
  FileText,
  FloppyDisk,
  FolderOpen,
  GearSix,
  MagnifyingGlass,
  Minus,
  Plus,
  Square,
  TextAlignLeft,
  X,
} from "@phosphor-icons/react";
import i18n, { resolveLocale } from "./i18n";
import { isAutoSaveEligible, isAutoSaveRevisionSuppressed } from "./autoSavePolicy";
import { needsSaveConfirmation } from "./closePolicy";
import { createWorkspaceSession, decideStartupRecovery } from "./recoveryPolicy";
import { SettingsModal } from "./components/SettingsModal";
import {
  findNextInPane,
  findPreviousInPane,
  focusEditor,
  TextEditor,
} from "./components/TextEditor";
import {
  beginAppSession,
  appErrorCode,
  checkForUpdates,
  chooseAndOpenDocuments,
  chooseDirectory,
  closeWindow,
  deleteRecovery,
  inspectFile,
  encodedByteLength,
  listenForWindowClose,
  listRecoveries,
  loadRecentFiles,
  loadSession,
  loadSettings,
  minimizeWindow,
  persistSession,
  persistRecentFiles,
  persistSettings,
  pruneRecoveries,
  openDocumentPath,
  restoreRecoveries,
  saveDocument,
  showSourceCode,
  toggleMaximizeWindow,
  validateDirectory,
  writeRecovery,
} from "./services/runtime";
import { useAppStore } from "./store";
import type { DirectoryValidationResult, DocumentRecord, PaneId, RecoveryEntry, UserSettings, WorkspaceSession } from "./types";

type ModalState =
  | { type: "none" }
  | { type: "settings"; snapshot: UserSettings }
  | { type: "recovery" }
  | { type: "startup-recovery"; session: WorkspaceSession }
  | { type: "exit"; documents: DocumentRecord[] }
  | { type: "close-tab"; pane: PaneId; tabId: string; document: DocumentRecord };

type DirectoryField = "defaultSaveFolder" | "cloudSyncFolder";
type DirectoryCheck = {
  status: "idle" | "checking" | "valid" | "invalid";
  result?: DirectoryValidationResult;
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

const accentMap = {
  tiffany: "#18B7AA",
  graphite: "#4B5563",
  amber: "#E59A20",
  coral: "#E96F61",
  iris: "#8B6FD6",
};

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

function findMatches(content: string, query: string, caseSensitive: boolean, wholeWord: boolean) {
  if (!query) return [] as Array<{ from: number; to: number }>;
  const haystack = caseSensitive ? content : content.toLocaleLowerCase();
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  const matches: Array<{ from: number; to: number }> = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    const before = index > 0 ? haystack[index - 1] : "";
    const after = haystack[index + needle.length] ?? "";
    const wordCharacter = /[\p{L}\p{N}_]/u;
    const isWhole = !wholeWord || (!wordCharacter.test(before) && !wordCharacter.test(after));
    if (isWhole) matches.push({ from: index, to: index + needle.length });
    from = index + Math.max(needle.length, 1);
  }
  return matches;
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
  onRecovery,
  onRestoreSession,
}: {
  recentFiles: string[];
  onNew: () => void;
  onOpen: () => void;
  onOpenRecent: (path: string) => void;
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
        <h2>{t("recentFiles")}</h2>
        {recentFiles.length === 0 ? <p>{t("recentEmpty")}</p> : (
          <div className="recent-list">
            {recentFiles.slice(0, 8).map((path) => (
              <button type="button" key={path} onClick={() => onOpenRecent(path)}>
                <FileText size={19} />
                <span><strong>{path.split(/[\\/]/).at(-1)}</strong><small>{path}</small></span>
              </button>
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
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onFind: () => void;
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
}: {
  pane: PaneId;
  onClose: (pane: PaneId, tabId: string) => void;
}) {
  const { t } = useTranslation();
  const tabs = useAppStore((state) => state.tabs[pane]);
  const activeTab = useAppStore((state) => state.activeTab[pane]);
  const documents = useAppStore((state) => state.documents);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const createDocument = useAppStore((state) => state.createDocument);
  return (
    <div className="tabbar" role="tablist" aria-label={pane === "left" ? t("leftPane") : t("rightPane")}>
      <div className="tabs-scroll">
        {tabs.map((tab) => {
          const document = documents[tab.documentId];
          if (!document) return null;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={"tab " + (activeTab === tab.id ? "active" : "")}
              key={tab.id}
              onClick={() => setActiveTab(pane, tab.id)}
              onAuxClick={(event) => event.button === 1 && onClose(pane, tab.id)}
            >
              <FileText size={19} />
              <span className="tab-name">{document.fileName === "Untitled" ? t("untitled") : document.fileName}</span>
              {document.dirty && <span className="dirty-dot" aria-label="Unsaved" />}
              <span className="tab-close" role="button" aria-label={t("close")} onClick={(event) => { event.stopPropagation(); onClose(pane, tab.id); }}>
                <X size={16} />
              </span>
            </button>
          );
        })}
        <IconButton label={t("new")} className="new-tab" onClick={() => createDocument(pane)}><Plus size={20} /></IconButton>
      </div>
    </div>
  );
}

function SearchBar({
  pane,
  matches,
  matchIndex,
  onMatchIndex,
}: {
  pane: PaneId;
  matches: Array<{ from: number; to: number }>;
  matchIndex: number;
  onMatchIndex: (index: number) => void;
}) {
  const { t } = useTranslation();
  const search = useAppStore((state) => state.search);
  const setSearch = useAppStore((state) => state.setSearch);
  const documents = useAppStore((state) => state.documents);
  const tabs = useAppStore((state) => state.tabs);
  const activeTab = useAppStore((state) => state.activeTab);
  const replaceCurrent = useAppStore((state) => state.replaceCurrent);
  const replaceAll = useAppStore((state) => state.replaceAll);
  const documentId = tabs[pane].find((tab) => tab.id === activeTab[pane])?.documentId;
  const document = documentId ? documents[documentId] : undefined;
  const go = (direction: -1 | 1) => {
    if (matches.length === 0) return;
    const next = (matchIndex + direction + matches.length) % matches.length;
    onMatchIndex(next);
    direction > 0 ? findNextInPane(pane) : findPreviousInPane(pane);
  };
  return (
    <div className="searchbar" role="search">
      <div className={"search-input-wrap " + (search.query && matches.length === 0 ? "no-match" : "")}>
        <MagnifyingGlass size={21} />
        <input
          autoFocus
          value={search.query}
          placeholder={t("find")}
          onChange={(event) => { setSearch({ query: event.target.value }); onMatchIndex(0); }}
          onKeyDown={(event) => { if (event.key === "Enter") go(event.shiftKey ? -1 : 1); if (event.key === "Escape") setSearch({ open: false }); }}
        />
      </div>
      <IconButton label={t("previousMatch")} onClick={() => go(-1)} disabled={!matches.length}><CaretUp size={18} /></IconButton>
      <IconButton label={t("nextMatch")} onClick={() => go(1)} disabled={!matches.length}><CaretDown size={18} /></IconButton>
      <span className="match-count">{matches.length ? t("matchCount", { current: Math.min(matchIndex + 1, matches.length), total: matches.length }) : t("noMatches")}</span>
      {search.replaceOpen && (
        <>
          <input className="replace-input" value={search.replacement} placeholder={t("replaceWith")} onChange={(event) => setSearch({ replacement: event.target.value })} />
          <label className="check-control"><input type="checkbox" checked={search.caseSensitive} onChange={(event) => setSearch({ caseSensitive: event.target.checked })} /><span>{t("caseSensitive")}</span></label>
          <label className="check-control"><input type="checkbox" checked={search.wholeWord} onChange={(event) => setSearch({ wholeWord: event.target.checked })} /><span>{t("wholeWord")}</span></label>
          <button type="button" className="button-secondary search-action" disabled={!document || !matches.length} onClick={() => {
            if (!document) return;
            const match = matches[Math.min(matchIndex, matches.length - 1)];
            replaceCurrent(document.id, match.from, match.to, search.replacement);
          }}>{t("replace")}</button>
          <button type="button" className="button-primary search-action" disabled={!document || !matches.length} onClick={() => document && replaceAll(document.id, matches, search.replacement)}>{t("replaceAll")}</button>
        </>
      )}
      <IconButton label={t("closeSearch")} onClick={() => setSearch({ open: false })}><X size={19} /></IconButton>
    </div>
  );
}

function StatusBar({ pane, document }: { pane: PaneId; document?: DocumentRecord }) {
  const { t } = useTranslation();
  const cursor = useAppStore((state) => state.cursor[pane]);
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
      <span>{document.encoding.toUpperCase()}</span>
      <span>{document.lineEnding.toUpperCase()}</span>
      <span>{document.fileName.endsWith(".md") ? t("markdown") : t("plainText")}</span>
    </div>
  );
}

function EditorPane({ pane, onCloseTab }: { pane: PaneId; onCloseTab: (pane: PaneId, tabId: string) => void }) {
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
  if (!document) return <div className="editor-empty" />;
  return (
    <section className="editor-pane" onPointerDown={() => setActivePane(pane)}>
      <TabBar pane={pane} onClose={onCloseTab} />
      <div className="editor-region">
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
      </div>
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
                <span>{entry.status === "corrupted" ? t("damagedBackupDescription") : `${new Date(entry.createdAt).toLocaleString()} · ${Math.max(1, Math.round(entry.size / 1024))} KB`}</span>
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

export function App() {
  const { t } = useTranslation();
  const documents = useAppStore((state) => state.documents);
  const tabs = useAppStore((state) => state.tabs);
  const activeTab = useAppStore((state) => state.activeTab);
  const activePane = useAppStore((state) => state.activePane);
  const split = useAppStore((state) => state.split);
  const search = useAppStore((state) => state.search);
  const settings = useAppStore((state) => state.settings);
  const histories = useAppStore((state) => state.histories);
  const createDocument = useAppStore((state) => state.createDocument);
  const addOpenedDocument = useAppStore((state) => state.addOpenedDocument);
  const closeTab = useAppStore((state) => state.closeTab);
  const toggleSplit = useAppStore((state) => state.toggleSplit);
  const undoDocument = useAppStore((state) => state.undoDocument);
  const redoDocument = useAppStore((state) => state.redoDocument);
  const markSaved = useAppStore((state) => state.markSaved);
  const setSearch = useAppStore((state) => state.setSearch);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const loadSettingsIntoStore = useAppStore((state) => state.loadSettings);
  const restoreSessionIntoStore = useAppStore((state) => state.restoreSession);
  const updateDocumentFlags = useAppStore((state) => state.updateDocumentFlags);
  const [modal, setModal] = useState<ModalState>(() => new URLSearchParams(window.location.search).get("state") === "settings" ? { type: "settings", snapshot: settings } : { type: "none" });
  const [toast, setToast] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [updateMessage, setUpdateMessage] = useState("");
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [directoryChecks, setDirectoryChecks] = useState<Record<DirectoryField, DirectoryCheck>>(emptyDirectoryChecks);
  const [settingsApplying, setSettingsApplying] = useState(false);
  const [autoSaveFailures, setAutoSaveFailures] = useState<Record<string, number>>({});
  const backupTimers = useRef<Record<string, number>>({});
  const idleSaveTimers = useRef<Record<string, { revision: number; timer: number }>>({});
  const saveInFlight = useRef(new Map<string, Promise<boolean>>());
  const failedAutoSaveRevisions = useRef<Record<string, number>>({});
  const previousActiveDocuments = useRef<Record<PaneId, string | undefined>>({ left: undefined, right: undefined });
  const previousAutoSaveMode = useRef(settings.autoSaveMode);
  const directoryCheckTokens = useRef<Record<DirectoryField, number>>({ defaultSaveFolder: 0, cloudSyncFolder: 0 });
  const closingRef = useRef(false);

  const activeDocumentId = tabs[activePane].find((tab) => tab.id === activeTab[activePane])?.documentId;
  const activeDocument = activeDocumentId ? documents[activeDocumentId] : undefined;
  const paneActiveDocumentIds: Record<PaneId, string | undefined> = {
    left: tabs.left.find((tab) => tab.id === activeTab.left)?.documentId,
    right: tabs.right.find((tab) => tab.id === activeTab.right)?.documentId,
  };
  const matches = useMemo(() => findMatches(
    activeDocument?.content ?? "",
    search.query,
    search.caseSensitive,
    search.wholeWord,
  ), [activeDocument?.content, search.query, search.caseSensitive, search.wholeWord]);
  const history = activeDocument ? histories[activeDocument.id] : undefined;

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }, []);

  const rememberRecent = useCallback((paths: string[]) => {
    setRecentFiles((current) => {
      const next = [...paths, ...current].filter((path, index, all) => path && all.indexOf(path) === index).slice(0, settings.recentFileLimit);
      void persistRecentFiles(next);
      return next;
    });
  }, [settings.recentFileLimit]);

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
      if (!snapshot.filePath && currentSettings.defaultSaveFolder) {
        try {
          const check = await validateDirectory(currentSettings.defaultSaveFolder, encodedByteLength(snapshot));
          if (check.valid) defaultSaveFolder = currentSettings.defaultSaveFolder;
          else flash(t("defaultFolderFallback"));
        } catch {
          flash(t("defaultFolderFallback"));
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
          if (!intent.automatic) flash(t("externalChanged"));
          return false;
        }
        if (intent.automatic) {
          failedAutoSaveRevisions.current[snapshot.id] = snapshot.revision;
          setAutoSaveFailures((current) => ({ ...current, [snapshot.id]: snapshot.revision }));
        } else {
          flash(t("saveFailed"));
        }
        return false;
      }
    })();
    saveInFlight.current.set(documentId, task);
    void task.finally(() => {
      if (saveInFlight.current.get(documentId) === task) saveInFlight.current.delete(documentId);
    });
    return task;
  }, [flash, markSaved, rememberRecent, t, updateDocumentFlags]);

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

  const saveActive = useCallback((forceSaveAs = false) => (
    activeDocument ? saveDocumentById(activeDocument.id, { forceSaveAs }) : Promise.resolve(false)
  ), [activeDocument, saveDocumentById]);

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

  const requestCloseTab = useCallback((pane: PaneId, tabId: string) => {
    const tab = tabs[pane].find((item) => item.id === tabId);
    const document = tab ? documents[tab.documentId] : undefined;
    if (document && needsSaveConfirmation(document)) setModal({ type: "close-tab", pane, tabId, document });
    else closeTab(pane, tabId);
  }, [closeTab, documents, tabs]);

  useEffect(() => {
    void Promise.all([
      beginAppSession(),
      loadSettings().catch(() => null),
      loadSession().catch(() => null),
      loadRecentFiles().catch(() => []),
    ]).then(([startupStatus, storedSettings, storedSession, storedRecent]) => {
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
      void pruneRecoveries(effectiveSettings).catch(() => undefined);
      if (decision !== "ask") setHydrated(true);
    }).catch(() => setHydrated(true));
  }, [loadSettingsIntoStore, restoreSessionIntoStore]);

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
      void persistSession(createWorkspaceSession({ split, activeTab, tabs, documents }));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [activeTab, documents, hydrated, split, tabs]);

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
    const timer = window.setInterval(() => {
      Object.values(documents).forEach((document) => {
        if (!document.filePath || !document.fingerprint || saveInFlight.current.has(document.id)) return;
        void inspectFile(document.filePath).then((fingerprint) => {
          if (!fingerprint) return;
          if (fingerprint.hash !== document.fingerprint?.hash) {
            updateDocumentFlags(document.id, { externalModified: true });
          }
        }).catch(() => updateDocumentFlags(document.id, { missing: true }));
      });
    }, 4000);
    return () => window.clearInterval(timer);
  }, [documents, updateDocumentFlags]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === "n") { event.preventDefault(); createDocument(activePane); }
      if (key === "o") { event.preventDefault(); void openFiles(); }
      if (key === "s") { event.preventDefault(); void saveActive(event.shiftKey); }
      if (key === "f") { event.preventDefault(); setSearch({ open: true, replaceOpen: false }); }
      if (key === "h") { event.preventDefault(); setSearch({ open: true, replaceOpen: true }); }
      if (key === "\\") { event.preventDefault(); toggleSplit(); }
      if (key === ",") { event.preventDefault(); setModal({ type: "settings", snapshot: settings }); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePane, createDocument, openFiles, saveActive, setSearch, settings, toggleSplit]);

  return (
    <main className="app-shell">
      <TitleBar onClose={requestCloseWindow} />
      <Toolbar
        canUndo={Boolean(history?.undo.length)}
        canRedo={Boolean(history?.redo.length)}
        split={split}
        wrap={settings.wordWrapByDefault}
        onNew={() => createDocument(activePane)}
        onOpen={() => void openFiles()}
        onSave={() => void saveActive()}
        onUndo={() => activeDocument && undoDocument(activeDocument.id)}
        onRedo={() => activeDocument && redoDocument(activeDocument.id)}
        onFind={() => { setSearch({ open: true, replaceOpen: false }); window.setTimeout(() => focusEditor(activePane), 0); }}
        onWrap={() => updateSettings({ wordWrapByDefault: !settings.wordWrapByDefault })}
        onSplit={toggleSplit}
        onSettings={() => setModal({ type: "settings", snapshot: settings })}
      />

      {search.open && <SearchBar pane={activePane} matches={matches} matchIndex={matchIndex} onMatchIndex={setMatchIndex} />}

      {activeDocument?.externalModified && (
        <div className="notice-bar">
          <div><strong>{t("externalChanged")}</strong><span>{t("externalChangedBody")}</span></div>
          <button type="button" className="button-secondary" onClick={() => updateDocumentFlags(activeDocument.id, { externalModified: false })}>{t("keepEditing")}</button>
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

      <div className={"workspace " + (split ? "split" : "")}>
        {tabs.left.length === 0 && tabs.right.length === 0 ? (
          <Welcome
            recentFiles={recentFiles}
            onNew={() => createDocument("left")}
            onOpen={() => void openFiles()}
            onOpenRecent={(path) => void openRecent(path)}
            onRecovery={() => setModal({ type: "recovery" })}
            onRestoreSession={() => void loadSession().then((session) => session && restoreSessionIntoStore(session))}
          />
        ) : <EditorPane pane="left" onCloseTab={requestCloseTab} />}
        {split && tabs.left.length > 0 && (
          <>
            <div className="split-divider"><DotsThree size={20} weight="bold" /></div>
            <EditorPane pane="right" onCloseTab={requestCloseTab} />
          </>
        )}
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
      {updateMessage && <div className="toast" role="status">{updateMessage}</div>}

      {modal.type === "settings" && (
        <SettingsModal
          settings={settings}
          directoryChecks={directoryChecks}
          applying={settingsApplying}
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
          onCheckUpdates={() => void checkForUpdates().then((result) => setUpdateMessage(result.available ? "PlainMint " + result.version : t("latestVersion")))}
          onOpenSource={() => void showSourceCode()}
        />
      )}
      {modal.type === "recovery" && <RecoveryModal onClose={() => setModal({ type: "none" })} />}
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
      {modal.type === "close-tab" && (
        <CloseTabModal
          modal={modal}
          onCancel={() => setModal({ type: "none" })}
          onDiscard={() => { closeTab(modal.pane, modal.tabId); setModal({ type: "none" }); }}
          onSave={() => void saveDocumentById(modal.document.id, { notifySuccess: false }).then((saved) => {
            if (!saved) return;
            closeTab(modal.pane, modal.tabId);
            setModal({ type: "none" });
          })}
        />
      )}
    </main>
  );
}
