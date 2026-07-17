import type { ChangeSet } from "@codemirror/state";

export type PaneId = "left" | "right";
export type Encoding = "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be";
export type LineEnding = "lf" | "crlf" | "cr";
export type AppearanceMode = "system" | "light" | "dark";
export type AccentTheme = "tiffany" | "graphite" | "amber" | "coral" | "iris";
export type AppLocale = "system" | "zh-CN" | "en";
export type LanguageId =
  | "plain"
  | "markdown"
  | "json"
  | "yaml"
  | "xml"
  | "html"
  | "css"
  | "scss"
  | "less"
  | "javascript"
  | "jsx"
  | "typescript"
  | "tsx"
  | "python"
  | "sql"
  | "shell"
  | "powershell"
  | "cpp"
  | "csharp"
  | "java"
  | "go"
  | "rust"
  | "php";
export type LanguageMode = "auto" | LanguageId;

export interface FileFingerprint {
  modifiedAt: number;
  size: number;
  hash: string;
}

export interface FileMetadataSnapshot {
  exists: boolean;
  modifiedAt: number;
  size: number;
  readOnly: boolean;
}

export interface FileWatchStatus {
  available: boolean;
  watchedFiles: number;
  watchedDirectories: number;
  failedDirectories: string[];
}

export interface DocumentRecord {
  id: string;
  filePath?: string;
  fileName: string;
  content: string;
  encoding: Encoding;
  lineEnding: LineEnding;
  languageMode: LanguageMode;
  detectedLanguage: LanguageId;
  autoLanguageDetectionComplete: boolean;
  dirty: boolean;
  readOnly: boolean;
  missing: boolean;
  externalModified: boolean;
  revision: number;
  fingerprint?: FileFingerprint;
  createdAt: number;
  lastSavedAt?: number;
  patch?: {
    sequence: number;
    origin: string;
    changes: ChangeSet;
  };
}

export interface EditorTab {
  id: string;
  documentId: string;
  pane: PaneId;
  order: number;
}

export interface RecentlyClosedTab {
  path: string;
  fileName: string;
  closedAt: number;
}

export interface CursorStats {
  line: number;
  column: number;
  selected: number;
}

export interface SearchState {
  open: boolean;
  replaceOpen: boolean;
  query: string;
  replacement: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
}

export interface UserSettings {
  locale: AppLocale;
  appearanceMode: AppearanceMode;
  accentTheme: AccentTheme;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  tabSize: number;
  showLineNumbers: boolean;
  wordWrapByDefault: boolean;
  highlightCurrentLine: boolean;
  spellCheckEnabled: boolean;
  autoBackupEnabled: boolean;
  backupDebounceSeconds: number;
  backupRetentionDays: number;
  maxBackupVersionsPerFile: number;
  autoSaveMode: "off" | "idle" | "interval" | "blur" | "tab-switch";
  defaultEncoding: Encoding;
  defaultLineEnding: LineEnding;
  sessionRecoveryMode: "ask" | "auto" | "empty";
  defaultSaveFolder?: string;
  cloudSyncFolder?: string;
  recentFileLimit: number;
  autoCheckUpdates: boolean;
}

export interface OpenedDocument {
  path: string;
  name: string;
  content: string;
  encoding: Encoding;
  lineEnding: LineEnding;
  readOnly: boolean;
  fingerprint?: FileFingerprint;
  recovered?: boolean;
}

export interface SaveResult {
  path: string;
  fingerprint: FileFingerprint;
  savedAt: number;
}

export type DirectoryValidationErrorCode =
  | "not-found"
  | "not-directory"
  | "not-readable"
  | "not-writable"
  | "insufficient-space"
  | "unavailable";

export interface DirectoryValidationResult {
  valid: boolean;
  exists: boolean;
  isDirectory: boolean;
  readable: boolean;
  writable: boolean;
  availableBytes: number;
  errorCode?: DirectoryValidationErrorCode;
}

export interface RecoveryEntry {
  id: string;
  documentId: string;
  fileName: string;
  originalPath?: string;
  createdAt: number;
  size: number;
  encoding: Encoding;
  lineEnding: LineEnding;
  reason: RecoveryReason;
  status: "ready" | "corrupted";
}

export type RecoveryReason = "automatic" | "conflict-local" | "conflict-disk";

export interface BatchRecoveryResult {
  documents: OpenedDocument[];
  failures: Array<{
    id: string;
    code: string;
    messageKey: string;
  }>;
}

export interface StartupStatus {
  previousExitWasUnclean: boolean;
  previousStartedAt?: number;
}

export interface WorkspaceSession {
  savedAt: number;
  split: boolean;
  splitRatio?: number;
  activeTab: Record<PaneId, string | null>;
  tabs: Record<PaneId, EditorTab[]>;
  documents: DocumentRecord[];
}

export interface AppError {
  code: string;
  messageKey: string;
  details?: string;
}
