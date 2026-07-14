import type { ChangeSet } from "@codemirror/state";

export type PaneId = "left" | "right";
export type Encoding = "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be";
export type LineEnding = "lf" | "crlf" | "cr";
export type AppearanceMode = "system" | "light" | "dark";
export type AccentTheme = "tiffany" | "graphite" | "amber" | "coral" | "iris";
export type AppLocale = "system" | "zh-CN" | "en";

export interface FileFingerprint {
  modifiedAt: number;
  size: number;
  hash: string;
}

export interface DocumentRecord {
  id: string;
  filePath?: string;
  fileName: string;
  content: string;
  encoding: Encoding;
  lineEnding: LineEnding;
  dirty: boolean;
  readOnly: boolean;
  missing: boolean;
  externalModified: boolean;
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
  autoBackupEnabled: boolean;
  backupDebounceSeconds: number;
  backupRetentionDays: number;
  maxBackupVersionsPerFile: number;
  autoSaveMode: "off" | "idle" | "interval" | "blur" | "tab-switch";
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
  fingerprint: FileFingerprint;
}

export interface SaveResult {
  path: string;
  fingerprint: FileFingerprint;
  savedAt: number;
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
}

export interface WorkspaceSession {
  savedAt: number;
  split: boolean;
  activeTab: Record<PaneId, string | null>;
  tabs: Record<PaneId, EditorTab[]>;
  documents: DocumentRecord[];
}

export interface AppError {
  code: string;
  messageKey: string;
  details?: string;
}
