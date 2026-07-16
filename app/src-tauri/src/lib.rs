use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const DIRECTORY_SPACE_RESERVE: u64 = 1024 * 1024;

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
#[serde(rename_all = "kebab-case")]
enum Encoding {
    Utf8,
    Utf8Bom,
    Utf16le,
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

fn fingerprint_from_bytes(metadata: &fs::Metadata, bytes: &[u8]) -> FileFingerprint {
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default();
    FileFingerprint {
        modified_at,
        size: bytes.len() as u64,
        hash: hash_bytes(bytes),
    }
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
fn inspect_file(path: String) -> CommandResult<FileFingerprint> {
    fingerprint(Path::new(&path))
}

#[tauri::command]
fn validate_directory(path: String, required_bytes: u64) -> DirectoryValidationResult {
    validate_directory_path(Path::new(&path), required_bytes)
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
    let path = PathBuf::from(&request.path);
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            inspect_file,
            validate_directory,
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
