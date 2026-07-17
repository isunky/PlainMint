#[cfg(target_os = "windows")]
use notify::{event::ModifyKind, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
#[cfg(target_os = "windows")]
use std::process::Command;
#[cfg(target_os = "windows")]
use std::{
    collections::{HashMap, HashSet},
    sync::{mpsc, Arc, RwLock},
    thread,
    time::{Duration, Instant},
};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
#[cfg(target_os = "windows")]
use tauri::Emitter;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const DIRECTORY_SPACE_RESERVE: u64 = 1024 * 1024;
#[cfg(target_os = "windows")]
const FILE_WATCH_EVENT: &str = "plainmint-file-watch-change";
#[cfg(target_os = "windows")]
const FILE_WATCH_DEBOUNCE: Duration = Duration::from_millis(750);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppError {
    code: String,
    message_key: String,
    details: Option<String>,
}

impl AppError {
    fn new(code: &str, message_key: &str, details: impl Into<Option<String>>) -> Self {
        Self {
            code: code.to_string(),
            message_key: message_key.to_string(),
            details: details.into(),
        }
    }

    fn io(code: &str, error: std::io::Error) -> Self {
        Self::new(code, "saveFailed", Some(error.to_string()))
    }
}

type CommandResult<T> = Result<T, AppError>;

#[derive(Clone, Debug, Deserialize, Serialize)]
enum Encoding {
    #[serde(rename = "utf-8", alias = "utf8")]
    Utf8,
    #[serde(rename = "utf-8-bom", alias = "utf8-bom")]
    Utf8Bom,
    #[serde(rename = "utf-16le", alias = "utf16le")]
    Utf16le,
    #[serde(rename = "utf-16be", alias = "utf16be")]
    Utf16be,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum LineEnding {
    Lf,
    Crlf,
    Cr,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenFileRequest {
    path: String,
    encoding_override: Option<Encoding>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileFingerprint {
    modified_at: u64,
    size: u64,
    hash: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileMetadataSnapshot {
    exists: bool,
    modified_at: u64,
    size: u64,
    read_only: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileWatchStatus {
    available: bool,
    watched_files: usize,
    watched_directories: usize,
    failed_directories: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileWatchEventPayload {
    paths: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContextMenuStatus {
    supported: bool,
    enabled: bool,
}

#[cfg(target_os = "windows")]
const CONTEXT_MENU_KEY: &str = r"HKCU\Software\Classes\*\shell\PlainMint.Open";

#[cfg(target_os = "windows")]
fn context_menu_status() -> ContextMenuStatus {
    let enabled = Command::new("reg")
        .args(["query", CONTEXT_MENU_KEY])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    ContextMenuStatus {
        supported: true,
        enabled,
    }
}

#[cfg(not(target_os = "windows"))]
fn context_menu_status() -> ContextMenuStatus {
    ContextMenuStatus {
        supported: false,
        enabled: false,
    }
}

#[cfg(target_os = "windows")]
fn run_registry_command(arguments: &[String]) -> CommandResult<()> {
    let output = Command::new("reg")
        .args(arguments)
        .output()
        .map_err(|error| {
            AppError::new(
                "context_menu_failed",
                "contextMenuFailed",
                Some(error.to_string()),
            )
        })?;
    if output.status.success() {
        Ok(())
    } else {
        Err(AppError::new(
            "context_menu_failed",
            "contextMenuFailed",
            Some(String::from_utf8_lossy(&output.stderr).trim().to_string()),
        ))
    }
}

#[cfg(target_os = "windows")]
#[derive(Clone, Debug)]
struct WatchedTarget {
    path: String,
    parent_key: String,
}

#[cfg(target_os = "windows")]
#[derive(Clone, Debug, Default)]
struct WatchTargets {
    by_path: HashMap<String, WatchedTarget>,
    by_parent: HashMap<String, Vec<String>>,
    directories: HashMap<String, PathBuf>,
}

#[cfg(target_os = "windows")]
struct WindowsFileWatchState {
    watcher: Option<RecommendedWatcher>,
    watched_directories: HashMap<String, PathBuf>,
}

struct FileWatchState {
    #[cfg(target_os = "windows")]
    inner: Mutex<WindowsFileWatchState>,
    #[cfg(target_os = "windows")]
    targets: Arc<RwLock<WatchTargets>>,
    #[cfg(target_os = "windows")]
    app: AppHandle,
}

#[cfg(target_os = "windows")]
#[derive(Default)]
struct DebounceQueue {
    deadlines: HashMap<String, Instant>,
}

#[cfg(target_os = "windows")]
impl DebounceQueue {
    fn schedule(&mut self, paths: Vec<String>, now: Instant) {
        let deadline = now + FILE_WATCH_DEBOUNCE;
        for path in paths {
            self.deadlines.insert(path, deadline);
        }
    }

    fn wait_duration(&self, now: Instant) -> Option<Duration> {
        self.deadlines
            .values()
            .min()
            .map(|deadline| deadline.saturating_duration_since(now))
    }

    fn take_due(&mut self, now: Instant) -> Vec<String> {
        let mut due = self
            .deadlines
            .iter()
            .filter_map(|(path, deadline)| (*deadline <= now).then_some(path.clone()))
            .collect::<Vec<_>>();
        for path in &due {
            self.deadlines.remove(path);
        }
        due.sort();
        due
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenedDocument {
    path: String,
    name: String,
    content: String,
    encoding: Encoding,
    line_ending: LineEnding,
    read_only: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    fingerprint: Option<FileFingerprint>,
    recovered: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveFileRequest {
    path: String,
    fallback_file_name: String,
    content: String,
    encoding: Encoding,
    line_ending: LineEnding,
    expected_fingerprint: Option<FileFingerprint>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveResult {
    path: String,
    fingerprint: FileFingerprint,
    saved_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentlyClosedTab {
    path: String,
    file_name: String,
    closed_at: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryValidationResult {
    valid: bool,
    exists: bool,
    is_directory: bool,
    readable: bool,
    writable: bool,
    available_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_code: Option<String>,
}

impl DirectoryValidationResult {
    fn invalid(
        error_code: &str,
        exists: bool,
        is_directory: bool,
        readable: bool,
        writable: bool,
        available_bytes: u64,
    ) -> Self {
        Self {
            valid: false,
            exists,
            is_directory,
            readable,
            writable,
            available_bytes,
            error_code: Some(error_code.to_string()),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupRequest {
    document_id: String,
    file_name: String,
    original_path: Option<String>,
    content: String,
    encoding: Encoding,
    line_ending: LineEnding,
    reason: Option<RecoveryReason>,
    retention_days: u64,
    max_versions: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupFile {
    id: String,
    document_id: String,
    file_name: String,
    original_path: Option<String>,
    created_at: u64,
    content: String,
    encoding: Encoding,
    line_ending: LineEnding,
    #[serde(default)]
    reason: RecoveryReason,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum RecoveryReason {
    #[default]
    Automatic,
    ConflictLocal,
    ConflictDisk,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryEntry {
    id: String,
    document_id: String,
    file_name: String,
    original_path: Option<String>,
    created_at: u64,
    size: usize,
    encoding: Encoding,
    line_ending: LineEnding,
    reason: RecoveryReason,
    status: RecoveryStatus,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
enum RecoveryStatus {
    Ready,
    Corrupted,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryFailure {
    id: String,
    code: String,
    message_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchRecoveryResult {
    documents: Vec<OpenedDocument>,
    failures: Vec<RecoveryFailure>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LifecycleMarker {
    running: bool,
    started_at: u64,
    closed_at: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupStatus {
    previous_exit_was_unclean: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    previous_started_at: Option<u64>,
}

static STARTUP_STATUS: OnceLock<Mutex<Option<StartupStatus>>> = OnceLock::new();

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn hash_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn metadata_modified_at(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn fingerprint_from_bytes(metadata: &fs::Metadata, bytes: &[u8]) -> FileFingerprint {
    FileFingerprint {
        modified_at: metadata_modified_at(metadata),
        size: bytes.len() as u64,
        hash: hash_bytes(bytes),
    }
}

fn file_metadata_snapshot(path: &Path) -> CommandResult<FileMetadataSnapshot> {
    match fs::metadata(path) {
        Ok(metadata) => Ok(FileMetadataSnapshot {
            exists: true,
            modified_at: metadata_modified_at(&metadata),
            size: metadata.len(),
            read_only: metadata.permissions().readonly() || metadata.len() > 100 * 1024 * 1024,
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(FileMetadataSnapshot {
            exists: false,
            modified_at: 0,
            size: 0,
            read_only: false,
        }),
        Err(error) => Err(AppError::io("file_metadata_failed", error)),
    }
}

#[cfg(target_os = "windows")]
fn normalized_path_key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_lowercase()
}

#[cfg(target_os = "windows")]
fn watch_targets_from_paths(paths: Vec<String>) -> WatchTargets {
    let mut targets = WatchTargets::default();
    for original_path in paths {
        let path = PathBuf::from(&original_path);
        let Some(parent) = path.parent().filter(|value| !value.as_os_str().is_empty()) else {
            continue;
        };
        let path_key = normalized_path_key(&path);
        if targets.by_path.contains_key(&path_key) {
            continue;
        }
        let parent = parent.to_path_buf();
        let parent_key = normalized_path_key(&parent);
        targets
            .directories
            .entry(parent_key.clone())
            .or_insert(parent);
        targets
            .by_parent
            .entry(parent_key.clone())
            .or_default()
            .push(original_path.clone());
        targets.by_path.insert(
            path_key,
            WatchedTarget {
                path: original_path,
                parent_key,
            },
        );
    }
    for paths in targets.by_parent.values_mut() {
        paths.sort();
    }
    targets
}

#[cfg(target_os = "windows")]
fn is_broad_directory_event(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Any
            | EventKind::Create(_)
            | EventKind::Remove(_)
            | EventKind::Other
            | EventKind::Modify(ModifyKind::Any | ModifyKind::Name(_) | ModifyKind::Other)
    )
}

#[cfg(target_os = "windows")]
fn affected_watch_targets(event: &Event, targets: &WatchTargets) -> Vec<String> {
    if matches!(event.kind, EventKind::Access(_)) {
        return Vec::new();
    }
    let broad = is_broad_directory_event(&event.kind);
    let mut affected = HashSet::new();
    for event_path in &event.paths {
        let event_key = normalized_path_key(event_path);
        if let Some(target) = targets.by_path.get(&event_key) {
            affected.insert(target.path.clone());
        }
        if let Some(paths) = targets.by_parent.get(&event_key) {
            affected.extend(paths.iter().cloned());
        }
        if broad {
            if let Some(parent) = event_path.parent() {
                if let Some(paths) = targets.by_parent.get(&normalized_path_key(parent)) {
                    affected.extend(paths.iter().cloned());
                }
            }
        }
    }
    let mut affected = affected.into_iter().collect::<Vec<_>>();
    affected.sort();
    affected
}

#[cfg(target_os = "windows")]
fn run_file_watch_debounce(rx: mpsc::Receiver<Vec<String>>, app: AppHandle) {
    let mut queue = DebounceQueue::default();
    loop {
        let received = match queue.wait_duration(Instant::now()) {
            Some(wait) => rx.recv_timeout(wait),
            None => match rx.recv() {
                Ok(paths) => {
                    queue.schedule(paths, Instant::now());
                    continue;
                }
                Err(_) => break,
            },
        };
        match received {
            Ok(paths) => queue.schedule(paths, Instant::now()),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let paths = queue.take_due(Instant::now());
                if !paths.is_empty() {
                    let _ = app.emit(FILE_WATCH_EVENT, FileWatchEventPayload { paths });
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

#[cfg(target_os = "windows")]
fn start_file_watcher(
    app: AppHandle,
    targets: Arc<RwLock<WatchTargets>>,
) -> Option<RecommendedWatcher> {
    let callback_targets = Arc::clone(&targets);
    let (tx, rx) = mpsc::channel::<Vec<String>>();
    let watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
        let Ok(event) = result else {
            return;
        };
        let Ok(targets) = callback_targets.read() else {
            return;
        };
        let affected = affected_watch_targets(&event, &targets);
        if !affected.is_empty() {
            let _ = tx.send(affected);
        }
    })
    .ok()?;
    thread::spawn(move || run_file_watch_debounce(rx, app));
    Some(watcher)
}

#[cfg(target_os = "windows")]
fn create_file_watch_state(app: AppHandle) -> FileWatchState {
    let targets = Arc::new(RwLock::new(WatchTargets::default()));
    FileWatchState {
        inner: Mutex::new(WindowsFileWatchState {
            watcher: None,
            watched_directories: HashMap::new(),
        }),
        targets,
        app,
    }
}

#[cfg(not(target_os = "windows"))]
fn create_file_watch_state(_app: AppHandle) -> FileWatchState {
    FileWatchState {}
}

fn fingerprint(path: &Path) -> CommandResult<FileFingerprint> {
    let metadata = fs::metadata(path).map_err(|error| AppError::io("file_missing", error))?;
    let mut file = File::open(path).map_err(|error| AppError::io("file_open_failed", error))?;
    let mut bytes = Vec::with_capacity(metadata.len().min(32 * 1024 * 1024) as usize);
    file.read_to_end(&mut bytes)
        .map_err(|error| AppError::io("file_read_failed", error))?;
    Ok(fingerprint_from_bytes(&metadata, &bytes))
}

fn detect_line_ending(content: &str) -> LineEnding {
    let crlf = content.matches("\r\n").count();
    let without_crlf = content.replace("\r\n", "");
    let cr = without_crlf.matches('\r').count();
    let lf = without_crlf.matches('\n').count();
    if crlf >= cr && crlf >= lf && crlf > 0 {
        LineEnding::Crlf
    } else if cr > lf && cr > 0 {
        LineEnding::Cr
    } else {
        LineEnding::Lf
    }
}

fn normalize_line_endings(content: String) -> String {
    content.replace("\r\n", "\n").replace('\r', "\n")
}

fn decode_bytes(
    bytes: &[u8],
    override_encoding: Option<Encoding>,
) -> CommandResult<(String, Encoding)> {
    let encoding = override_encoding.unwrap_or_else(|| {
        if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
            Encoding::Utf8Bom
        } else if bytes.starts_with(&[0xff, 0xfe]) {
            Encoding::Utf16le
        } else if bytes.starts_with(&[0xfe, 0xff]) {
            Encoding::Utf16be
        } else {
            Encoding::Utf8
        }
    });
    let content = match encoding {
        Encoding::Utf8 => std::str::from_utf8(bytes)
            .map_err(|error| {
                AppError::new("encoding_unknown", "encoding", Some(error.to_string()))
            })?
            .to_string(),
        Encoding::Utf8Bom => {
            let data = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
            std::str::from_utf8(data)
                .map_err(|error| {
                    AppError::new("encoding_unknown", "encoding", Some(error.to_string()))
                })?
                .to_string()
        }
        Encoding::Utf16le | Encoding::Utf16be => {
            let data = match encoding {
                Encoding::Utf16le => bytes.strip_prefix(&[0xff, 0xfe]).unwrap_or(bytes),
                Encoding::Utf16be => bytes.strip_prefix(&[0xfe, 0xff]).unwrap_or(bytes),
                _ => bytes,
            };
            if data.len() % 2 != 0 {
                return Err(AppError::new(
                    "encoding_unknown",
                    "encoding",
                    Some("Odd UTF-16 byte length".into()),
                ));
            }
            let units = data
                .chunks_exact(2)
                .map(|chunk| match encoding {
                    Encoding::Utf16le => u16::from_le_bytes([chunk[0], chunk[1]]),
                    _ => u16::from_be_bytes([chunk[0], chunk[1]]),
                })
                .collect::<Vec<_>>();
            String::from_utf16(&units).map_err(|error| {
                AppError::new("encoding_unknown", "encoding", Some(error.to_string()))
            })?
        }
    };
    Ok((content, encoding))
}

fn encode_content(content: &str, encoding: &Encoding, line_ending: &LineEnding) -> Vec<u8> {
    let line_separator = match line_ending {
        LineEnding::Lf => "\n",
        LineEnding::Crlf => "\r\n",
        LineEnding::Cr => "\r",
    };
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    let converted = if matches!(line_ending, LineEnding::Lf) {
        normalized
    } else {
        normalized.replace('\n', line_separator)
    };
    match encoding {
        Encoding::Utf8 => converted.into_bytes(),
        Encoding::Utf8Bom => {
            let mut bytes = vec![0xef, 0xbb, 0xbf];
            bytes.extend_from_slice(converted.as_bytes());
            bytes
        }
        Encoding::Utf16le => {
            let mut bytes = vec![0xff, 0xfe];
            for unit in converted.encode_utf16() {
                bytes.extend_from_slice(&unit.to_le_bytes());
            }
            bytes
        }
        Encoding::Utf16be => {
            let mut bytes = vec![0xfe, 0xff];
            for unit in converted.encode_utf16() {
                bytes.extend_from_slice(&unit.to_be_bytes());
            }
            bytes
        }
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> CommandResult<()> {
    let parent = path.parent().ok_or_else(|| {
        AppError::new(
            "invalid_path",
            "saveFailed",
            Some(path.display().to_string()),
        )
    })?;
    fs::create_dir_all(parent).map_err(|error| AppError::io("directory_create_failed", error))?;
    let temp_path = parent.join(format!(".plainmint-{}.tmp", Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp_path)
        .map_err(|error| AppError::io("temp_create_failed", error))?;
    file.write_all(bytes)
        .map_err(|error| AppError::io("temp_write_failed", error))?;
    file.sync_all()
        .map_err(|error| AppError::io("temp_sync_failed", error))?;
    drop(file);
    replace_file(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        AppError::io("atomic_replace_failed", error)
    })
}

fn resolve_save_target(path: &Path, fallback_file_name: &str) -> CommandResult<PathBuf> {
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_dir() => {
            let fallback_path = Path::new(fallback_file_name);
            let valid_file_name = fallback_path.components().count() == 1
                && fallback_path
                    .file_name()
                    .filter(|name| !name.is_empty())
                    .is_some();
            if !valid_file_name {
                return Err(AppError::new(
                    "invalid_file_name",
                    "saveFailed",
                    Some(fallback_file_name.to_string()),
                ));
            }
            Ok(path.join(fallback_file_name))
        }
        Ok(_) => Ok(path.to_path_buf()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(path.to_path_buf()),
        Err(error) => Err(AppError::io("save_target_inspect_failed", error)),
    }
}

fn validate_directory_path(path: &Path, required_bytes: u64) -> DirectoryValidationResult {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) => {
            let code = if error.kind() == std::io::ErrorKind::NotFound {
                "not-found"
            } else if error.kind() == std::io::ErrorKind::PermissionDenied {
                "not-readable"
            } else {
                "unavailable"
            };
            return DirectoryValidationResult::invalid(
                code,
                error.kind() != std::io::ErrorKind::NotFound,
                false,
                false,
                false,
                0,
            );
        }
    };
    if !metadata.is_dir() {
        return DirectoryValidationResult::invalid("not-directory", true, false, false, false, 0);
    }

    let readable = fs::read_dir(path)
        .and_then(|mut entries| entries.next().transpose().map(|_| ()))
        .is_ok();
    if !readable {
        return DirectoryValidationResult::invalid("not-readable", true, true, false, false, 0);
    }

    let probe = path.join(format!(".plainmint-write-test-{}", Uuid::new_v4()));
    let writable = match OpenOptions::new().write(true).create_new(true).open(&probe) {
        Ok(file) => {
            drop(file);
            fs::remove_file(&probe).is_ok()
        }
        Err(_) => {
            let _ = fs::remove_file(&probe);
            false
        }
    };
    if !writable {
        return DirectoryValidationResult::invalid("not-writable", true, true, true, false, 0);
    }

    let available_bytes = match fs4::available_space(path) {
        Ok(bytes) => bytes,
        Err(_) => {
            return DirectoryValidationResult::invalid("unavailable", true, true, true, true, 0)
        }
    };
    let minimum = required_bytes.saturating_add(DIRECTORY_SPACE_RESERVE);
    if available_bytes < minimum {
        return DirectoryValidationResult::invalid(
            "insufficient-space",
            true,
            true,
            true,
            true,
            available_bytes,
        );
    }

    DirectoryValidationResult {
        valid: true,
        exists: true,
        is_directory: true,
        readable: true,
        writable: true,
        available_bytes,
        error_code: None,
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::rename(source, target)
}

#[cfg(windows)]
fn replace_file(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source_wide = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let target_wide = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            target_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn app_data_file(app: &AppHandle, name: &str) -> CommandResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(name))
        .map_err(|error| {
            AppError::new(
                "app_data_unavailable",
                "saveFailed",
                Some(error.to_string()),
            )
        })
}

fn begin_lifecycle(path: &Path, now: u64) -> CommandResult<StartupStatus> {
    let previous = if path.exists() {
        match fs::read(path) {
            Ok(bytes) => serde_json::from_slice::<LifecycleMarker>(&bytes).ok(),
            Err(error) => return Err(AppError::io("lifecycle_read_failed", error)),
        }
    } else {
        None
    };
    let status = StartupStatus {
        previous_exit_was_unclean: path.exists()
            && previous
                .as_ref()
                .map(|marker| marker.running)
                .unwrap_or(true),
        previous_started_at: previous.as_ref().map(|marker| marker.started_at),
    };
    let marker = LifecycleMarker {
        running: true,
        started_at: now,
        closed_at: None,
    };
    let bytes = serde_json::to_vec_pretty(&marker).map_err(|error| {
        AppError::new(
            "lifecycle_invalid",
            "sessionRecovery",
            Some(error.to_string()),
        )
    })?;
    atomic_write(path, &bytes)?;
    Ok(status)
}

fn complete_lifecycle(path: &Path, now: u64) -> CommandResult<()> {
    let started_at = fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<LifecycleMarker>(&bytes).ok())
        .map(|marker| marker.started_at)
        .unwrap_or(now);
    let marker = LifecycleMarker {
        running: false,
        started_at,
        closed_at: Some(now),
    };
    let bytes = serde_json::to_vec_pretty(&marker).map_err(|error| {
        AppError::new(
            "lifecycle_invalid",
            "sessionRecovery",
            Some(error.to_string()),
        )
    })?;
    atomic_write(path, &bytes)
}

#[tauri::command]
fn begin_app_session(app: AppHandle) -> CommandResult<StartupStatus> {
    let slot = STARTUP_STATUS.get_or_init(|| Mutex::new(None));
    let mut stored = slot.lock().map_err(|error| {
        AppError::new(
            "lifecycle_lock_failed",
            "sessionRecovery",
            Some(error.to_string()),
        )
    })?;
    if let Some(status) = stored.as_ref() {
        return Ok(status.clone());
    }
    let status = begin_lifecycle(&app_data_file(&app, "lifecycle.json")?, now_millis())?;
    *stored = Some(status.clone());
    Ok(status)
}

#[tauri::command]
fn close_app_window(app: AppHandle, window: tauri::WebviewWindow) -> CommandResult<()> {
    complete_lifecycle(&app_data_file(&app, "lifecycle.json")?, now_millis())?;
    window
        .destroy()
        .map_err(|error| AppError::new("window_close_failed", "close", Some(error.to_string())))
}

#[tauri::command]
fn inspect_file_metadata(path: String) -> CommandResult<FileMetadataSnapshot> {
    file_metadata_snapshot(Path::new(&path))
}

#[tauri::command]
fn sync_file_watches(
    state: tauri::State<'_, FileWatchState>,
    paths: Vec<String>,
) -> FileWatchStatus {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (state, paths);
        FileWatchStatus {
            available: false,
            watched_files: 0,
            watched_directories: 0,
            failed_directories: Vec::new(),
        }
    }

    #[cfg(target_os = "windows")]
    {
        let next_targets = watch_targets_from_paths(paths);
        let desired_directories = next_targets.directories.clone();
        if let Ok(mut targets) = state.targets.write() {
            *targets = next_targets.clone();
        }
        let Ok(mut inner) = state.inner.lock() else {
            return FileWatchStatus {
                available: false,
                watched_files: 0,
                watched_directories: 0,
                failed_directories: desired_directories
                    .values()
                    .map(|path| path.to_string_lossy().to_string())
                    .collect(),
            };
        };
        if desired_directories.is_empty() {
            inner.watched_directories.clear();
            inner.watcher.take();
            return FileWatchStatus {
                available: false,
                watched_files: 0,
                watched_directories: 0,
                failed_directories: Vec::new(),
            };
        }
        if inner.watcher.is_none() {
            inner.watcher = start_file_watcher(state.app.clone(), Arc::clone(&state.targets));
        }
        let available = inner.watcher.is_some();
        let removed = inner
            .watched_directories
            .keys()
            .filter(|key| !desired_directories.contains_key(*key))
            .cloned()
            .collect::<Vec<_>>();
        for key in removed {
            if let Some(path) = inner.watched_directories.remove(&key) {
                if let Some(watcher) = inner.watcher.as_mut() {
                    let _ = watcher.unwatch(&path);
                }
            }
        }

        let mut failed_directories = Vec::new();
        for (key, path) in &desired_directories {
            if inner.watched_directories.contains_key(key) {
                continue;
            }
            let watched = inner
                .watcher
                .as_mut()
                .is_some_and(|watcher| watcher.watch(path, RecursiveMode::NonRecursive).is_ok());
            if watched {
                inner.watched_directories.insert(key.clone(), path.clone());
            } else {
                failed_directories.push(path.to_string_lossy().to_string());
            }
        }
        failed_directories.sort();
        let watched_directory_keys = inner
            .watched_directories
            .keys()
            .cloned()
            .collect::<HashSet<_>>();
        let watched_directories = watched_directory_keys.len();
        let watched_files = next_targets
            .by_path
            .values()
            .filter(|target| watched_directory_keys.contains(&target.parent_key))
            .count();
        FileWatchStatus {
            available,
            watched_files,
            watched_directories,
            failed_directories,
        }
    }
}

#[tauri::command]
fn validate_directory(path: String, required_bytes: u64) -> DirectoryValidationResult {
    validate_directory_path(Path::new(&path), required_bytes)
}

#[tauri::command]
fn get_context_menu_status() -> ContextMenuStatus {
    context_menu_status()
}

#[tauri::command]
fn set_context_menu_enabled(enabled: bool) -> CommandResult<ContextMenuStatus> {
    #[cfg(target_os = "windows")]
    {
        if enabled {
            let executable = std::env::current_exe().map_err(|error| {
                AppError::new(
                    "context_menu_failed",
                    "contextMenuFailed",
                    Some(error.to_string()),
                )
            })?;
            let command = format!("\"{}\" \"%1\"", executable.to_string_lossy());
            run_registry_command(&[
                "add".into(),
                CONTEXT_MENU_KEY.into(),
                "/ve".into(),
                "/d".into(),
                "Open with PlainMint".into(),
                "/f".into(),
            ])?;
            run_registry_command(&[
                "add".into(),
                format!("{}\\command", CONTEXT_MENU_KEY),
                "/ve".into(),
                "/d".into(),
                command,
                "/f".into(),
            ])?;
        } else {
            let output = Command::new("reg")
                .args(["delete", CONTEXT_MENU_KEY, "/f"])
                .output()
                .map_err(|error| {
                    AppError::new(
                        "context_menu_failed",
                        "contextMenuFailed",
                        Some(error.to_string()),
                    )
                })?;
            if !output.status.success() && context_menu_status().enabled {
                return Err(AppError::new(
                    "context_menu_failed",
                    "contextMenuFailed",
                    Some(String::from_utf8_lossy(&output.stderr).trim().to_string()),
                ));
            }
        }
        Ok(context_menu_status())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = enabled;
        Ok(context_menu_status())
    }
}

#[tauri::command]
fn get_startup_open_paths() -> Vec<String> {
    std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .filter(|path| {
            fs::metadata(path)
                .map(|metadata| metadata.is_file())
                .unwrap_or(false)
        })
        .map(|path| path.to_string_lossy().to_string())
        .collect()
}

#[tauri::command]
fn open_file(request: OpenFileRequest) -> CommandResult<OpenedDocument> {
    let path = PathBuf::from(&request.path);
    let metadata = fs::metadata(&path).map_err(|error| AppError::io("file_missing", error))?;
    if metadata.len() > 500 * 1024 * 1024 {
        return Err(AppError::new(
            "file_too_large",
            "saveFailed",
            Some("Files larger than 500 MB are not loaded.".into()),
        ));
    }
    let bytes = fs::read(&path).map_err(|error| AppError::io("file_read_failed", error))?;
    let (decoded, encoding) = decode_bytes(&bytes, request.encoding_override)?;
    let line_ending = detect_line_ending(&decoded);
    let content = normalize_line_endings(decoded);
    let read_only = metadata.permissions().readonly() || metadata.len() > 100 * 1024 * 1024;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Untitled")
        .to_string();
    Ok(OpenedDocument {
        path: path.to_string_lossy().to_string(),
        name,
        content,
        encoding,
        line_ending,
        read_only,
        fingerprint: Some(fingerprint_from_bytes(&metadata, &bytes)),
        recovered: false,
    })
}

#[tauri::command]
fn save_file(request: SaveFileRequest) -> CommandResult<SaveResult> {
    let path = resolve_save_target(Path::new(&request.path), &request.fallback_file_name)?;
    if let Some(expected) = &request.expected_fingerprint {
        if path.exists() {
            let current = fingerprint(&path)?;
            if current.hash != expected.hash {
                return Err(AppError::new(
                    "external_conflict",
                    "externalChanged",
                    Some(path.display().to_string()),
                ));
            }
        }
    }
    let bytes = encode_content(&request.content, &request.encoding, &request.line_ending);
    atomic_write(&path, &bytes)?;
    Ok(SaveResult {
        path: path.to_string_lossy().to_string(),
        fingerprint: fingerprint(&path)?,
        saved_at: now_millis(),
    })
}

#[tauri::command]
fn load_settings(app: AppHandle) -> CommandResult<Option<Value>> {
    let path = app_data_file(&app, "settings.json")?;
    if !path.exists() {
        return Ok(None);
    }
    let value = serde_json::from_slice(
        &fs::read(path).map_err(|error| AppError::io("settings_read_failed", error))?,
    )
    .map_err(|error| AppError::new("settings_invalid", "settings", Some(error.to_string())))?;
    Ok(Some(value))
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Value) -> CommandResult<()> {
    let path = app_data_file(&app, "settings.json")?;
    let bytes = serde_json::to_vec_pretty(&settings)
        .map_err(|error| AppError::new("settings_invalid", "settings", Some(error.to_string())))?;
    atomic_write(&path, &bytes)
}

#[tauri::command]
fn save_session(app: AppHandle, session: Value) -> CommandResult<()> {
    let path = app_data_file(&app, "session.json")?;
    let bytes = serde_json::to_vec_pretty(&session).map_err(|error| {
        AppError::new(
            "session_invalid",
            "sessionRecovery",
            Some(error.to_string()),
        )
    })?;
    atomic_write(&path, &bytes)
}

#[tauri::command]
fn load_session(app: AppHandle) -> CommandResult<Option<Value>> {
    let path = app_data_file(&app, "session.json")?;
    if !path.exists() {
        return Ok(None);
    }
    let value = serde_json::from_slice(
        &fs::read(path).map_err(|error| AppError::io("session_read_failed", error))?,
    )
    .map_err(|error| {
        AppError::new(
            "session_invalid",
            "sessionRecovery",
            Some(error.to_string()),
        )
    })?;
    Ok(Some(value))
}

#[tauri::command]
fn load_recent_files(app: AppHandle) -> CommandResult<Vec<String>> {
    let path = app_data_file(&app, "recent-files.json")?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    serde_json::from_slice(
        &fs::read(path).map_err(|error| AppError::io("recent_files_read_failed", error))?,
    )
    .map_err(|error| {
        AppError::new(
            "recent_files_invalid",
            "recentFiles",
            Some(error.to_string()),
        )
    })
}

#[tauri::command]
fn save_recent_files(app: AppHandle, paths: Vec<String>) -> CommandResult<()> {
    let path = app_data_file(&app, "recent-files.json")?;
    let bytes = serde_json::to_vec_pretty(&paths).map_err(|error| {
        AppError::new(
            "recent_files_invalid",
            "recentFiles",
            Some(error.to_string()),
        )
    })?;
    atomic_write(&path, &bytes)
}

fn recent_path_key(path: &str) -> String {
    let normalized = path.trim().replace('\\', "/");
    if cfg!(windows) {
        normalized.to_lowercase()
    } else {
        normalized
    }
}

fn normalize_recently_closed_tabs(entries: Vec<RecentlyClosedTab>) -> Vec<RecentlyClosedTab> {
    let mut seen = std::collections::HashSet::new();
    entries
        .into_iter()
        .filter(|entry| {
            let key = recent_path_key(&entry.path);
            !key.is_empty() && seen.insert(key)
        })
        .take(10)
        .collect()
}

#[tauri::command]
fn load_recently_closed_tabs(app: AppHandle) -> CommandResult<Vec<RecentlyClosedTab>> {
    let path = app_data_file(&app, "recently-closed-tabs.json")?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let entries = serde_json::from_slice(
        &fs::read(path).map_err(|error| AppError::io("recently_closed_read_failed", error))?,
    )
    .map_err(|error| {
        AppError::new(
            "recently_closed_invalid",
            "reopenClosedTab",
            Some(error.to_string()),
        )
    })?;
    Ok(normalize_recently_closed_tabs(entries))
}

#[tauri::command]
fn persist_recently_closed_tabs(
    app: AppHandle,
    entries: Vec<RecentlyClosedTab>,
) -> CommandResult<()> {
    let path = app_data_file(&app, "recently-closed-tabs.json")?;
    let normalized = normalize_recently_closed_tabs(entries);
    let bytes = serde_json::to_vec_pretty(&normalized).map_err(|error| {
        AppError::new(
            "recently_closed_invalid",
            "reopenClosedTab",
            Some(error.to_string()),
        )
    })?;
    atomic_write(&path, &bytes)
}

fn backup_root(app: &AppHandle) -> CommandResult<PathBuf> {
    app_data_file(app, "backups")
}

fn backup_timestamp(path: &Path) -> Option<u64> {
    read_backup(path)
        .ok()
        .map(|backup| backup.created_at)
        .or_else(|| {
            path.file_stem()
                .and_then(|value| value.to_str())
                .and_then(|value| value.split('-').next())
                .and_then(|value| value.parse::<u64>().ok())
        })
        .or_else(|| {
            fs::metadata(path)
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .map(|value| value.as_millis() as u64)
        })
}

fn remove_backup_file(path: &Path) -> CommandResult<()> {
    fs::remove_file(path).map_err(|error| AppError::io("backup_delete_failed", error))
}

fn prune_backup_directory(
    directory: &Path,
    retention_days: u64,
    max_versions: usize,
    now: u64,
) -> CommandResult<()> {
    if !directory.exists() {
        return Ok(());
    }
    let retention_millis = retention_days.max(1).saturating_mul(86_400_000);
    let cutoff = now.saturating_sub(retention_millis);
    let mut remaining = Vec::new();
    for entry in fs::read_dir(directory)
        .map_err(|error| AppError::io("backup_list_failed", error))?
        .flatten()
    {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        if backup_timestamp(&path)
            .map(|created_at| created_at < cutoff)
            .unwrap_or(false)
        {
            remove_backup_file(&path)?;
        } else {
            remaining.push(path);
        }
    }
    remaining.sort_by_key(|path| backup_timestamp(path).unwrap_or_default());
    let remove_count = remaining.len().saturating_sub(max_versions.max(1));
    for path in remaining.into_iter().take(remove_count) {
        remove_backup_file(&path)?;
    }
    Ok(())
}

fn prune_all_backups(
    app: &AppHandle,
    retention_days: u64,
    max_versions: usize,
) -> CommandResult<()> {
    let root = backup_root(app)?;
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(&root)
        .map_err(|error| AppError::io("backup_list_failed", error))?
        .flatten()
    {
        if entry.path().is_dir() {
            prune_backup_directory(&entry.path(), retention_days, max_versions, now_millis())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn prune_backups(app: AppHandle, retention_days: u64, max_versions: usize) -> CommandResult<()> {
    prune_all_backups(&app, retention_days, max_versions)
}

#[tauri::command]
fn write_backup(app: AppHandle, request: BackupRequest) -> CommandResult<()> {
    let directory = backup_root(&app)?.join(&request.document_id);
    fs::create_dir_all(&directory)
        .map_err(|error| AppError::io("backup_directory_failed", error))?;
    let backup = BackupFile {
        id: Uuid::new_v4().to_string(),
        document_id: request.document_id.clone(),
        file_name: request.file_name,
        original_path: request.original_path,
        created_at: now_millis(),
        content: request.content,
        encoding: request.encoding,
        line_ending: request.line_ending,
        reason: request.reason.unwrap_or_default(),
    };
    let path = directory.join(format!("{}-{}.json", backup.created_at, backup.id));
    let bytes = serde_json::to_vec(&backup).map_err(|error| {
        AppError::new("backup_invalid", "backupRecovery", Some(error.to_string()))
    })?;
    atomic_write(&path, &bytes)?;
    prune_backup_directory(
        &directory,
        request.retention_days,
        request.max_versions,
        now_millis(),
    )
}

fn all_backup_files(app: &AppHandle) -> CommandResult<Vec<PathBuf>> {
    let root = backup_root(app)?;
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut paths = Vec::new();
    for directory in fs::read_dir(root)
        .map_err(|error| AppError::io("backup_list_failed", error))?
        .flatten()
    {
        if !directory.path().is_dir() {
            continue;
        }
        for entry in fs::read_dir(directory.path())
            .map_err(|error| AppError::io("backup_list_failed", error))?
            .flatten()
        {
            if entry.path().extension().and_then(|value| value.to_str()) == Some("json") {
                paths.push(entry.path());
            }
        }
    }
    Ok(paths)
}

fn read_backup(path: &Path) -> CommandResult<BackupFile> {
    serde_json::from_slice(
        &fs::read(path).map_err(|error| AppError::io("backup_read_failed", error))?,
    )
    .map_err(|error| AppError::new("backup_invalid", "backupRecovery", Some(error.to_string())))
}

fn recovery_storage_id(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("damaged-backup")
        .to_string()
}

fn recovery_entry_from_path(path: &Path) -> RecoveryEntry {
    match read_backup(path) {
        Ok(backup) => RecoveryEntry {
            id: backup.id,
            document_id: backup.document_id,
            file_name: backup.file_name,
            original_path: backup.original_path,
            created_at: backup.created_at,
            size: backup.content.len(),
            encoding: backup.encoding,
            line_ending: backup.line_ending,
            reason: backup.reason,
            status: RecoveryStatus::Ready,
        },
        Err(_) => RecoveryEntry {
            id: recovery_storage_id(path),
            document_id: path
                .parent()
                .and_then(|value| value.file_name())
                .and_then(|value| value.to_str())
                .unwrap_or("unknown-document")
                .to_string(),
            file_name: path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("damaged-backup.json")
                .to_string(),
            original_path: None,
            created_at: backup_timestamp(path).unwrap_or_default(),
            size: fs::metadata(path)
                .map(|value| value.len() as usize)
                .unwrap_or_default(),
            encoding: Encoding::Utf8,
            line_ending: LineEnding::Lf,
            reason: RecoveryReason::Automatic,
            status: RecoveryStatus::Corrupted,
        },
    }
}

#[tauri::command]
fn list_recoveries(app: AppHandle) -> CommandResult<Vec<RecoveryEntry>> {
    let mut entries = all_backup_files(&app)?
        .into_iter()
        .map(|path| recovery_entry_from_path(&path))
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.created_at));
    Ok(entries)
}

fn find_recovery_path(app: &AppHandle, id: &str) -> CommandResult<PathBuf> {
    for path in all_backup_files(app)? {
        let matches_backup = read_backup(&path)
            .ok()
            .map(|backup| backup.id == id)
            .unwrap_or(false);
        if matches_backup || recovery_storage_id(&path) == id {
            return Ok(path);
        }
    }
    Err(AppError::new(
        "backup_missing",
        "recoveryEmpty",
        Some(id.to_string()),
    ))
}

fn restore_recovery_document(app: &AppHandle, id: &str) -> CommandResult<OpenedDocument> {
    let path = find_recovery_path(app, id)?;
    let backup = read_backup(&path)?;
    let original_path = backup.original_path.unwrap_or_default();
    let original_exists = !original_path.is_empty() && Path::new(&original_path).exists();
    let current_fingerprint = original_exists
        .then(|| fingerprint(Path::new(&original_path)).ok())
        .flatten();
    let read_only = original_exists
        && (current_fingerprint.is_none()
            || fs::metadata(&original_path)
                .map(|metadata| metadata.permissions().readonly())
                .unwrap_or(true));
    Ok(OpenedDocument {
        path: if original_exists {
            original_path
        } else {
            String::new()
        },
        name: backup.file_name,
        content: backup.content,
        encoding: backup.encoding,
        line_ending: backup.line_ending,
        read_only,
        fingerprint: current_fingerprint,
        recovered: true,
    })
}

#[tauri::command]
fn restore_recovery(app: AppHandle, id: String) -> CommandResult<OpenedDocument> {
    restore_recovery_document(&app, &id)
}

#[tauri::command]
fn restore_recoveries(app: AppHandle, ids: Vec<String>) -> BatchRecoveryResult {
    let mut result = BatchRecoveryResult {
        documents: Vec::new(),
        failures: Vec::new(),
    };
    for id in ids {
        match restore_recovery_document(&app, &id) {
            Ok(document) => result.documents.push(document),
            Err(error) => result.failures.push(RecoveryFailure {
                id,
                code: error.code,
                message_key: error.message_key,
            }),
        }
    }
    result
}

#[tauri::command]
fn delete_recovery(app: AppHandle, id: String) -> CommandResult<()> {
    let path = find_recovery_path(&app, &id)?;
    fs::remove_file(path).map_err(|error| AppError::io("backup_delete_failed", error))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(create_file_watch_state(app.handle().clone()));
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            inspect_file_metadata,
            sync_file_watches,
            validate_directory,
            get_context_menu_status,
            set_context_menu_enabled,
            get_startup_open_paths,
            open_file,
            save_file,
            load_settings,
            save_settings,
            begin_app_session,
            close_app_window,
            save_session,
            load_session,
            load_recent_files,
            save_recent_files,
            load_recently_closed_tabs,
            persist_recently_closed_tabs,
            write_backup,
            prune_backups,
            list_recoveries,
            restore_recovery,
            restore_recoveries,
            delete_recovery,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PlainMint");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "windows")]
    use notify::event::{AccessKind, DataChange, RenameMode};

    fn test_directory(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("plainmint-{label}-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn write_test_backup(directory: &Path, created_at: u64, id: &str) -> PathBuf {
        let backup = BackupFile {
            id: id.to_string(),
            document_id: "doc-test".into(),
            file_name: "notes.txt".into(),
            original_path: None,
            created_at,
            content: format!("content-{id}"),
            encoding: Encoding::Utf8,
            line_ending: LineEnding::Lf,
            reason: RecoveryReason::Automatic,
        };
        let path = directory.join(format!("{created_at}-{id}.json"));
        fs::write(&path, serde_json::to_vec(&backup).unwrap()).unwrap();
        path
    }

    #[test]
    fn preserves_utf8_bom_and_crlf() {
        let input = "alpha\nbeta";
        let bytes = encode_content(input, &Encoding::Utf8Bom, &LineEnding::Crlf);
        assert!(bytes.starts_with(&[0xef, 0xbb, 0xbf]));
        let (decoded, encoding) = decode_bytes(&bytes, None).unwrap();
        assert!(matches!(encoding, Encoding::Utf8Bom));
        assert_eq!(detect_line_ending(&decoded), LineEnding::Crlf);
        assert_eq!(normalize_line_endings(decoded), input);
    }

    #[test]
    fn encoding_values_match_the_frontend_contract_and_accept_legacy_data() {
        let expected = [
            (Encoding::Utf8, "utf-8", "utf8"),
            (Encoding::Utf8Bom, "utf-8-bom", "utf8-bom"),
            (Encoding::Utf16le, "utf-16le", "utf16le"),
            (Encoding::Utf16be, "utf-16be", "utf16be"),
        ];

        for (encoding, current, legacy) in expected {
            assert_eq!(
                serde_json::to_string(&encoding).unwrap(),
                format!("\"{current}\"")
            );
            assert!(matches!(
                serde_json::from_str::<Encoding>(&format!("\"{current}\"")),
                Ok(decoded) if std::mem::discriminant(&decoded) == std::mem::discriminant(&encoding)
            ));
            assert!(serde_json::from_str::<Encoding>(&format!("\"{legacy}\"")).is_ok());
        }
    }

    #[test]
    fn saves_a_frontend_utf8_request_end_to_end() {
        let directory = test_directory("frontend-utf8-save");
        let target = directory.join("notes.txt");
        let request = serde_json::from_value::<SaveFileRequest>(serde_json::json!({
            "path": target,
            "fallbackFileName": "notes.txt",
            "content": "PlainMint save probe",
            "encoding": "utf-8",
            "lineEnding": "lf",
            "expectedFingerprint": null
        }))
        .unwrap();

        let result = save_file(request).unwrap();

        assert_eq!(
            fs::read_to_string(&result.path).unwrap(),
            "PlainMint save probe"
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn normalizes_and_deduplicates_windows_watch_paths() {
        let targets = watch_targets_from_paths(vec![
            r"C:\Notes\Alpha.txt".into(),
            r"c:/notes/alpha.txt".into(),
            r"C:\Notes\Beta.txt".into(),
        ]);

        assert_eq!(
            normalized_path_key(Path::new(r"C:\Notes\Alpha.txt")),
            "c:/notes/alpha.txt"
        );
        assert_eq!(targets.by_path.len(), 2);
        assert_eq!(targets.directories.len(), 1);
        assert_eq!(targets.by_parent.values().next().unwrap().len(), 2);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn maps_exact_and_replacement_events_without_sibling_data_noise() {
        let targets = watch_targets_from_paths(vec![
            r"C:\Notes\Alpha.txt".into(),
            r"C:\Notes\Beta.txt".into(),
        ]);
        let exact = Event::new(EventKind::Modify(ModifyKind::Data(DataChange::Content)))
            .add_path(PathBuf::from(r"C:\Notes\Alpha.txt"));
        assert_eq!(
            affected_watch_targets(&exact, &targets),
            vec![r"C:\Notes\Alpha.txt"]
        );

        let sibling = Event::new(EventKind::Modify(ModifyKind::Data(DataChange::Content)))
            .add_path(PathBuf::from(r"C:\Notes\Other.txt"));
        assert!(affected_watch_targets(&sibling, &targets).is_empty());

        let replacement = Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
            .add_path(PathBuf::from(r"C:\Notes\.Alpha.tmp"));
        assert_eq!(
            affected_watch_targets(&replacement, &targets),
            vec![r"C:\Notes\Alpha.txt", r"C:\Notes\Beta.txt"]
        );

        let access = Event::new(EventKind::Access(AccessKind::Read))
            .add_path(PathBuf::from(r"C:\Notes\Alpha.txt"));
        assert!(affected_watch_targets(&access, &targets).is_empty());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn debounces_each_target_from_its_latest_event() {
        let start = Instant::now();
        let mut queue = DebounceQueue::default();
        queue.schedule(vec!["alpha".into(), "beta".into()], start);
        queue.schedule(vec!["alpha".into()], start + Duration::from_millis(500));

        assert_eq!(
            queue.take_due(start + Duration::from_millis(749)),
            Vec::<String>::new()
        );
        assert_eq!(
            queue.take_due(start + Duration::from_millis(750)),
            vec!["beta"]
        );
        assert_eq!(
            queue.take_due(start + Duration::from_millis(1_249)),
            Vec::<String>::new()
        );
        assert_eq!(
            queue.take_due(start + Duration::from_millis(1_250)),
            vec!["alpha"]
        );
    }

    #[test]
    fn metadata_inspection_reports_missing_files_without_reading_content() {
        let directory = test_directory("metadata-only");
        let path = directory.join("notes.txt");
        fs::write(&path, b"metadata only").unwrap();

        let present = file_metadata_snapshot(&path).unwrap();
        assert!(present.exists);
        assert_eq!(present.size, 13);
        let missing = file_metadata_snapshot(&directory.join("missing.txt")).unwrap();
        assert!(!missing.exists);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn validates_directory_access_and_cleans_probe_file() {
        let directory = test_directory("directory-validation");

        let result = validate_directory_path(&directory, 0);

        assert!(result.valid);
        assert!(result.readable);
        assert!(result.writable);
        assert!(result.available_bytes >= DIRECTORY_SPACE_RESERVE);
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 0);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn saves_a_new_file_when_the_dialog_returns_a_directory() {
        let directory = test_directory("directory-save-target");
        let target = resolve_save_target(&directory, "notes.txt").unwrap();

        assert_eq!(target, directory.join("notes.txt"));
        atomic_write(&target, b"PlainMint").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"PlainMint");

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_a_directory_save_target_with_a_path_like_file_name() {
        let directory = test_directory("invalid-directory-save-target");
        let error = resolve_save_target(&directory, "nested/notes.txt").unwrap_err();

        assert_eq!(error.code, "invalid_file_name");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_missing_files_and_insufficient_space() {
        let directory = test_directory("directory-errors");
        let file = directory.join("plainmint.txt");
        fs::write(&file, b"text").unwrap();

        let missing = validate_directory_path(&directory.join("missing"), 0);
        assert_eq!(missing.error_code.as_deref(), Some("not-found"));

        let not_directory = validate_directory_path(&file, 0);
        assert_eq!(not_directory.error_code.as_deref(), Some("not-directory"));

        let insufficient = validate_directory_path(&directory, u64::MAX);
        assert_eq!(
            insufficient.error_code.as_deref(),
            Some("insufficient-space")
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn utf16_round_trip() {
        let input = "PlainMint 纯文本";
        for encoding in [Encoding::Utf16le, Encoding::Utf16be] {
            let bytes = encode_content(input, &encoding, &LineEnding::Lf);
            let (decoded, _) = decode_bytes(&bytes, None).unwrap();
            assert_eq!(decoded, input);
        }
    }

    #[test]
    fn fingerprints_match_the_exact_opened_bytes() {
        let directory = test_directory("fingerprint-bytes");
        let path = directory.join("notes.txt");
        let bytes = b"same bytes used for open";
        fs::write(&path, bytes).unwrap();

        let metadata = fs::metadata(&path).unwrap();
        let result = fingerprint_from_bytes(&metadata, bytes);

        assert_eq!(result.size, bytes.len() as u64);
        assert_eq!(result.hash, hash_bytes(bytes));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn prunes_expired_backups_before_applying_version_limit() {
        const DAY: u64 = 86_400_000;
        let directory = test_directory("retention");
        write_test_backup(&directory, 60 * DAY, "expired");
        write_test_backup(&directory, 80 * DAY, "oldest-kept-period");
        write_test_backup(&directory, 90 * DAY, "newer");
        write_test_backup(&directory, 95 * DAY, "newest");

        prune_backup_directory(&directory, 30, 2, 100 * DAY).unwrap();

        let mut remaining = fs::read_dir(&directory)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect::<Vec<_>>();
        remaining.sort();
        assert_eq!(
            remaining,
            vec!["7776000000-newer.json", "8208000000-newest.json"]
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn exposes_corrupted_backups_instead_of_hiding_them() {
        let directory = test_directory("corrupted");
        let path = directory.join("123-damaged.json");
        fs::write(&path, b"{not-valid-json").unwrap();

        let entry = recovery_entry_from_path(&path);

        assert!(matches!(entry.status, RecoveryStatus::Corrupted));
        assert_eq!(entry.id, "123-damaged");
        assert_eq!(entry.created_at, 123);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn distinguishes_unclean_and_completed_lifecycles() {
        let directory = test_directory("lifecycle");
        let path = directory.join("lifecycle.json");

        let first = begin_lifecycle(&path, 100).unwrap();
        assert!(!first.previous_exit_was_unclean);
        let interrupted = begin_lifecycle(&path, 200).unwrap();
        assert!(interrupted.previous_exit_was_unclean);
        assert_eq!(interrupted.previous_started_at, Some(100));

        complete_lifecycle(&path, 300).unwrap();
        let completed = begin_lifecycle(&path, 400).unwrap();
        assert!(!completed.previous_exit_was_unclean);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn normalizes_recently_closed_tabs_and_applies_limit() {
        let mut entries = (0..12)
            .map(|index| RecentlyClosedTab {
                path: format!("C:\\Notes\\{index}.txt"),
                file_name: format!("{index}.txt"),
                closed_at: 12 - index,
            })
            .collect::<Vec<_>>();
        entries.insert(
            1,
            RecentlyClosedTab {
                path: "C:\\Notes\\0.txt".into(),
                file_name: "duplicate.txt".into(),
                closed_at: 99,
            },
        );

        let normalized = normalize_recently_closed_tabs(entries);

        assert_eq!(normalized.len(), 10);
        assert_eq!(normalized[0].file_name, "0.txt");
        assert_eq!(
            normalized
                .iter()
                .filter(|entry| entry.path.ends_with("0.txt"))
                .count(),
            1
        );
    }
}
