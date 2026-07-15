import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type {
  BatchRecoveryResult,
  DirectoryValidationResult,
  DocumentRecord,
  FileFingerprint,
  OpenedDocument,
  RecoveryEntry,
  SaveResult,
  StartupStatus,
  UserSettings,
  WorkspaceSession,
} from "../types";

export interface SaveDocumentOptions {
  forceSaveAs?: boolean;
  defaultSaveFolder?: string;
}

export const isTauri = () => Boolean(window.__TAURI_INTERNALS__);

let webStartupStatus: StartupStatus | undefined;

const filters = [{
  name: "Plain text",
  extensions: ["txt", "log", "md", "json", "xml", "csv", "ini", "conf", "yaml", "yml", "properties", "sql", "*"],
}];

function webFingerprint(content: string): FileFingerprint {
  return { modifiedAt: Date.now(), size: new TextEncoder().encode(content).length, hash: "web-preview" };
}

export async function chooseAndOpenDocuments(): Promise<OpenedDocument[]> {
  if (!isTauri()) return [];
  const selected = await open({ multiple: true, directory: false, filters });
  const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
  return Promise.all(paths.map((path) =>
    invoke<OpenedDocument>("open_file", { request: { path, encodingOverride: null } }),
  ));
}

export async function openDocumentPath(path: string): Promise<OpenedDocument> {
  if (!isTauri()) {
    return {
      path,
      name: path.split(/[\\/]/).at(-1) ?? "preview.txt",
      content: "",
      encoding: "utf-8",
      lineEnding: "lf",
      readOnly: false,
      fingerprint: webFingerprint(""),
    };
  }
  return invoke<OpenedDocument>("open_file", { request: { path, encodingOverride: null } });
}

export function encodedByteLength(document: Pick<DocumentRecord, "content" | "encoding" | "lineEnding">): number {
  const normalized = document.content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lineSeparator = document.lineEnding === "crlf" ? "\r\n" : document.lineEnding === "cr" ? "\r" : "\n";
  const converted = document.lineEnding === "lf" ? normalized : normalized.replace(/\n/g, lineSeparator);
  if (document.encoding === "utf-16le" || document.encoding === "utf-16be") return 2 + converted.length * 2;
  return new TextEncoder().encode(converted).length + (document.encoding === "utf-8-bom" ? 3 : 0);
}

export async function saveDocument(document: DocumentRecord, options: SaveDocumentOptions = {}): Promise<SaveResult | null> {
  const { forceSaveAs = false, defaultSaveFolder } = options;
  let path = forceSaveAs ? undefined : document.filePath;
  if (isTauri() && !path) {
    const fileName = document.fileName === "Untitled" ? "untitled.txt" : document.fileName;
    const defaultPath = forceSaveAs && document.filePath
      ? document.filePath
      : defaultSaveFolder
        ? await join(defaultSaveFolder, fileName)
        : fileName;
    path = await save({
      defaultPath,
      filters,
    }) ?? undefined;
  }
  if (!path && !isTauri()) path = document.fileName;
  if (!path) return null;
  if (!isTauri()) {
    return { path, fingerprint: webFingerprint(document.content), savedAt: Date.now() };
  }
  return invoke<SaveResult>("save_file", {
    request: {
      path,
      content: document.content,
      encoding: document.encoding,
      lineEnding: document.lineEnding,
      expectedFingerprint: forceSaveAs ? null : document.fingerprint ?? null,
    },
  });
}

export async function inspectFile(path: string): Promise<FileFingerprint | null> {
  if (!isTauri()) return null;
  return invoke<FileFingerprint>("inspect_file", { path });
}

export async function chooseDirectory(): Promise<string | null> {
  if (!isTauri()) return null;
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

export async function validateDirectory(path: string, requiredBytes = 0): Promise<DirectoryValidationResult> {
  if (!isTauri()) {
    return {
      valid: false,
      exists: false,
      isDirectory: false,
      readable: false,
      writable: false,
      availableBytes: 0,
      errorCode: "unavailable",
    };
  }
  return invoke<DirectoryValidationResult>("validate_directory", { path, requiredBytes });
}

export function appErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error && "code" in error && typeof error.code === "string") return error.code;
  if (typeof error === "string") {
    try {
      const parsed = JSON.parse(error) as { code?: unknown };
      return typeof parsed.code === "string" ? parsed.code : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export async function loadSettings(): Promise<Partial<UserSettings> | null> {
  if (!isTauri()) {
    const raw = localStorage.getItem("plainmint.settings");
    return raw ? JSON.parse(raw) as Partial<UserSettings> : null;
  }
  return invoke<Partial<UserSettings> | null>("load_settings");
}

export async function persistSettings(settings: UserSettings) {
  if (!isTauri()) {
    localStorage.setItem("plainmint.settings", JSON.stringify(settings));
    return;
  }
  await invoke("save_settings", { settings });
}

export async function persistSession(payload: unknown) {
  if (!isTauri()) {
    localStorage.setItem("plainmint.session", JSON.stringify(payload));
    return;
  }
  await invoke("save_session", { session: payload });
}

export async function beginAppSession(): Promise<StartupStatus> {
  if (!isTauri()) {
    if (webStartupStatus) return webStartupStatus;
    const raw = localStorage.getItem("plainmint.lifecycle");
    const previous = raw ? JSON.parse(raw) as { running?: boolean; startedAt?: number } : null;
    webStartupStatus = {
      previousExitWasUnclean: Boolean(previous?.running),
      previousStartedAt: previous?.startedAt,
    };
    localStorage.setItem("plainmint.lifecycle", JSON.stringify({ running: true, startedAt: Date.now() }));
    return webStartupStatus;
  }
  return invoke<StartupStatus>("begin_app_session");
}

export async function loadSession(): Promise<WorkspaceSession | null> {
  if (!isTauri()) {
    const raw = localStorage.getItem("plainmint.session");
    return raw ? JSON.parse(raw) as WorkspaceSession : null;
  }
  return invoke<WorkspaceSession | null>("load_session");
}

export async function loadRecentFiles(): Promise<string[]> {
  if (!isTauri()) {
    const raw = localStorage.getItem("plainmint.recent-files");
    return raw ? JSON.parse(raw) as string[] : [];
  }
  return invoke<string[]>("load_recent_files");
}

export async function persistRecentFiles(paths: string[]) {
  if (!isTauri()) {
    localStorage.setItem("plainmint.recent-files", JSON.stringify(paths));
    return;
  }
  await invoke("save_recent_files", { paths });
}

export async function writeRecovery(document: DocumentRecord, settings: UserSettings) {
  if (!settings.autoBackupEnabled || !document.dirty) return;
  if (!isTauri()) return;
  await invoke("write_backup", {
    request: {
      documentId: document.id,
      fileName: document.fileName,
      originalPath: document.filePath ?? null,
      content: document.content,
      encoding: document.encoding,
      lineEnding: document.lineEnding,
      retentionDays: settings.backupRetentionDays,
      maxVersions: settings.maxBackupVersionsPerFile,
    },
  });
}

export async function pruneRecoveries(settings: UserSettings) {
  if (!isTauri()) return;
  await invoke("prune_backups", {
    retentionDays: settings.backupRetentionDays,
    maxVersions: settings.maxBackupVersionsPerFile,
  });
}

export async function listRecoveries(): Promise<RecoveryEntry[]> {
  if (!isTauri()) return [];
  return invoke<RecoveryEntry[]>("list_recoveries");
}

export async function restoreRecoveries(ids: string[]): Promise<BatchRecoveryResult> {
  if (!isTauri()) return { documents: [], failures: [] };
  return invoke<BatchRecoveryResult>("restore_recoveries", { ids });
}

export async function deleteRecovery(id: string) {
  if (isTauri()) await invoke("delete_recovery", { id });
}

export async function checkForUpdates() {
  if (!isTauri()) return { available: false as const };
  try {
    const update = await check();
    if (!update) return { available: false as const };
    return {
      available: true as const,
      version: update.version,
      body: update.body,
      install: async () => {
        await update.downloadAndInstall();
        await relaunch();
      },
    };
  } catch {
    return { available: false as const, notConfigured: true as const };
  }
}

export async function showSourceCode() {
  await openUrl("https://github.com/isunky/PlainMint");
}

export async function minimizeWindow() {
  if (isTauri()) await getCurrentWindow().minimize();
}

export async function toggleMaximizeWindow() {
  if (isTauri()) await getCurrentWindow().toggleMaximize();
}

export async function listenForWindowClose(handler: () => void): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  return getCurrentWindow().onCloseRequested((event) => {
    event.preventDefault();
    handler();
  });
}

export async function closeWindow() {
  if (!isTauri()) {
    localStorage.setItem("plainmint.lifecycle", JSON.stringify({ running: false, closedAt: Date.now() }));
    return;
  }
  await invoke("close_app_window");
}
