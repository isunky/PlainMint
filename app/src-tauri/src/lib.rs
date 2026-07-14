use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

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
    fingerprint: FileFingerprint,
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
struct BackupRequest {
    document_id: String,
    file_name: String,
    original_path: Option<String>,
    content: String,
    encoding: Encoding,
    line_ending: LineEnding,
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
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn hash_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn fingerprint(path: &Path) -> CommandResult<FileFingerprint> {
    let metadata = fs::metadata(path).map_err(|error| AppError::io("file_missing", error))?;
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default();
    let mut file = File::open(path).map_err(|error| AppError::io("file_open_failed", error))?;
    let mut bytes = Vec::with_capacity(metadata.len().min(32 * 1024 * 1024) as usize);
    file.read_to_end(&mut bytes)
        .map_err(|error| AppError::io("file_read_failed", error))?;
    Ok(FileFingerprint {
        modified_at,
        size: metadata.len(),
        hash: hash_bytes(&bytes),
    })
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

#[tauri::command]
fn inspect_file(path: String) -> CommandResult<FileFingerprint> {
    fingerprint(Path::new(&path))
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
        fingerprint: fingerprint(&path)?,
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

fn backup_root(app: &AppHandle) -> CommandResult<PathBuf> {
    Ok(app_data_file(app, "backups")?)
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
    };
    let path = directory.join(format!("{}-{}.json", backup.created_at, backup.id));
    let bytes = serde_json::to_vec(&backup).map_err(|error| {
        AppError::new("backup_invalid", "backupRecovery", Some(error.to_string()))
    })?;
    atomic_write(&path, &bytes)?;

    let mut files = fs::read_dir(&directory)
        .map_err(|error| AppError::io("backup_list_failed", error))?
        .flatten()
        .filter(|entry| entry.path().extension().and_then(|value| value.to_str()) == Some("json"))
        .collect::<Vec<_>>();
    files.sort_by_key(|entry| entry.file_name());
    let max_versions = request.max_versions.max(1);
    let remove_count = files.len().saturating_sub(max_versions);
    for entry in files.into_iter().take(remove_count) {
        let _ = fs::remove_file(entry.path());
    }
    Ok(())
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

#[tauri::command]
fn list_recoveries(app: AppHandle) -> CommandResult<Vec<RecoveryEntry>> {
    let mut entries = all_backup_files(&app)?
        .into_iter()
        .filter_map(|path| read_backup(&path).ok())
        .map(|backup| RecoveryEntry {
            id: backup.id,
            document_id: backup.document_id,
            file_name: backup.file_name,
            original_path: backup.original_path,
            created_at: backup.created_at,
            size: backup.content.len(),
            encoding: backup.encoding,
            line_ending: backup.line_ending,
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(entries)
}

fn find_backup(app: &AppHandle, id: &str) -> CommandResult<(PathBuf, BackupFile)> {
    for path in all_backup_files(app)? {
        if let Ok(backup) = read_backup(&path) {
            if backup.id == id {
                return Ok((path, backup));
            }
        }
    }
    Err(AppError::new(
        "backup_missing",
        "recoveryEmpty",
        Some(id.to_string()),
    ))
}

#[tauri::command]
fn restore_recovery(app: AppHandle, id: String) -> CommandResult<OpenedDocument> {
    let (_, backup) = find_backup(&app, &id)?;
    let bytes = encode_content(&backup.content, &backup.encoding, &backup.line_ending);
    Ok(OpenedDocument {
        path: backup.original_path.unwrap_or_default(),
        name: backup.file_name,
        content: backup.content,
        encoding: backup.encoding,
        line_ending: backup.line_ending,
        read_only: false,
        fingerprint: FileFingerprint {
            modified_at: backup.created_at,
            size: bytes.len() as u64,
            hash: hash_bytes(&bytes),
        },
    })
}

#[tauri::command]
fn delete_recovery(app: AppHandle, id: String) -> CommandResult<()> {
    let (path, _) = find_backup(&app, &id)?;
    fs::remove_file(path).map_err(|error| AppError::io("backup_delete_failed", error))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            inspect_file,
            open_file,
            save_file,
            load_settings,
            save_settings,
            save_session,
            load_session,
            load_recent_files,
            save_recent_files,
            write_backup,
            list_recoveries,
            restore_recovery,
            delete_recovery,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PlainMint");
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn utf16_round_trip() {
        let input = "PlainMint 纯文本";
        for encoding in [Encoding::Utf16le, Encoding::Utf16be] {
            let bytes = encode_content(input, &encoding, &LineEnding::Lf);
            let (decoded, _) = decode_bytes(&bytes, None).unwrap();
            assert_eq!(decoded, input);
        }
    }
}
