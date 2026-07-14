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
import { needsSaveConfirmation } from "./closePolicy";
import { SettingsModal } from "./components/SettingsModal";
import {
  findNextInPane,
  findPreviousInPane,
  focusEditor,
  TextEditor,
} from "./components/TextEditor";
import {
  checkForUpdates,
  chooseAndOpenDocuments,
  chooseDirectory,
  closeWindow,
  deleteRecovery,
  inspectFile,
  listRecoveries,
  loadRecentFiles,
  loadSession,
  loadSettings,
  minimizeWindow,
  persistSession,
  persistRecentFiles,
  persistSettings,
  openDocumentPath,
  restoreRecovery,
  saveDocument,
  showSourceCode,
  toggleMaximizeWindow,
  writeRecovery,
} from "./services/runtime";
import { useAppStore } from "./store";
import type { DocumentRecord, PaneId, RecoveryEntry, UserSettings, WorkspaceSession } from "./types";

type ModalState =
  | { type: "none" }
  | { type: "settings"; snapshot: UserSettings }
  | { type: "recovery" }
  | { type: "exit"; documents: DocumentRecord[] }
  | { type: "close-tab"; pane: PaneId; tabId: string; document: DocumentRecord };

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
  useEffect(() => { void listRecoveries().then(setEntries); }, []);
  return (
    <div className="modal-backdrop">
      <section className="recovery-modal" role="dialog" aria-modal="true" aria-label={t("recoveryTitle")}>
        <header><h2>{t("recoveryTitle")}</h2><IconButton label={t("close")} onClick={onClose}><X size={19} /></IconButton></header>
        <div className="recovery-list">
          {entries.length === 0 && <p className="empty-copy">{t("recoveryEmpty")}</p>}
          {entries.map((entry) => (
            <article key={entry.id}>
              <FileText size={22} />
              <div><strong>{entry.fileName}</strong><span>{new Date(entry.createdAt).toLocaleString()} · {Math.max(1, Math.round(entry.size / 1024))} KB</span></div>
              <button type="button" className="button-secondary" onClick={() => void restoreRecovery(entry.id).then((document) => { addOpenedDocument(document); onClose(); })}>{t("recover")}</button>
              <button type="button" className="icon-button" aria-label={t("delete")} onClick={() => void deleteRecovery(entry.id).then(() => setEntries((current) => current.filter((item) => item.id !== entry.id)))}><X size={17} /></button>
            </article>
          ))}
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
  const backupTimers = useRef<Record<string, number>>({});

  const activeDocumentId = tabs[activePane].find((tab) => tab.id === activeTab[activePane])?.documentId;
  const activeDocument = activeDocumentId ? documents[activeDocumentId] : undefined;
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

  const saveActive = useCallback(async (forceSaveAs = false) => {
    if (!activeDocument) return false;
    try {
      const result = await saveDocument(activeDocument, forceSaveAs);
      if (!result) return false;
      markSaved(activeDocument.id, result.path, result.fingerprint);
      rememberRecent([result.path]);
      flash(t("saved"));
      return true;
    } catch {
      flash(t("saveFailed"));
      return false;
    }
  }, [activeDocument, flash, markSaved, rememberRecent, t]);

  const requestCloseTab = useCallback((pane: PaneId, tabId: string) => {
    const tab = tabs[pane].find((item) => item.id === tabId);
    const document = tab ? documents[tab.documentId] : undefined;
    if (document && needsSaveConfirmation(document)) setModal({ type: "close-tab", pane, tabId, document });
    else closeTab(pane, tabId);
  }, [closeTab, documents, tabs]);

  useEffect(() => {
    void Promise.all([loadSettings(), loadSession(), loadRecentFiles()]).then(([storedSettings, storedSession, storedRecent]) => {
      if (storedSettings) loadSettingsIntoStore(storedSettings);
      const explicitPreviewState = new URLSearchParams(window.location.search).has("state");
      if (!explicitPreviewState && storedSession && storedSettings?.sessionRecoveryMode !== "empty") restoreSessionIntoStore(storedSession);
      setRecentFiles(storedRecent);
      setHydrated(true);
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
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      void persistSession({
        savedAt: Date.now(),
        split,
        activeTab,
        tabs,
        documents: Object.values(documents).map(({ patch, ...document }) => document),
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [activeTab, documents, hydrated, split, tabs]);

  const requestCloseWindow = useCallback(() => {
    const dirty = Object.values(documents).filter(needsSaveConfirmation);
    if (dirty.length) setModal({ type: "exit", documents: dirty });
    else void closeWindow();
  }, [documents]);

  const saveAllAndExit = useCallback(async (dirtyDocuments: DocumentRecord[]) => {
    for (const document of dirtyDocuments) {
      try {
        const result = await saveDocument(document);
        if (!result) return;
        markSaved(document.id, result.path, result.fingerprint);
        rememberRecent([result.path]);
      } catch {
        flash(t("saveFailed"));
        return;
      }
    }
    await closeWindow();
  }, [flash, markSaved, rememberRecent, t]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      Object.values(documents).forEach((document) => {
        if (!document.filePath || !document.fingerprint) return;
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
          onChange={updateSettings}
          onApply={() => { void persistSettings(settings); setModal({ type: "none" }); flash(t("settingsSaved")); }}
          onCancel={() => { loadSettingsIntoStore(modal.snapshot); setModal({ type: "none" }); }}
          onChooseDirectory={(field) => void chooseDirectory().then((path) => path && updateSettings({ [field]: path }))}
          onOpenRecovery={() => setModal({ type: "recovery" })}
          onCheckUpdates={() => void checkForUpdates().then((result) => setUpdateMessage(result.available ? "PlainMint " + result.version : t("latestVersion")))}
          onOpenSource={() => void showSourceCode()}
        />
      )}
      {modal.type === "recovery" && <RecoveryModal onClose={() => setModal({ type: "none" })} />}
      {modal.type === "exit" && (
        <ExitModal
          documents={modal.documents}
          onCancel={() => setModal({ type: "none" })}
          onDiscard={() => void closeWindow()}
          onSave={() => void saveAllAndExit(modal.documents)}
        />
      )}
      {modal.type === "close-tab" && (
        <CloseTabModal
          modal={modal}
          onCancel={() => setModal({ type: "none" })}
          onDiscard={() => { closeTab(modal.pane, modal.tabId); setModal({ type: "none" }); }}
          onSave={() => void saveDocument(modal.document).then((result) => {
            if (!result) return;
            markSaved(modal.document.id, result.path, result.fingerprint);
            closeTab(modal.pane, modal.tabId);
            setModal({ type: "none" });
          })}
        />
      )}
    </main>
  );
}
