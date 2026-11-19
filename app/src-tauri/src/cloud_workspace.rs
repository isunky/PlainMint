use super::*;
use std::path::Component;

const WORKSPACE: &str = "PlainMint Workspace";
const MAX_SNAPSHOT: u64 = 256 * 1024 * 1024;

fn invalid() -> AppError {
    AppError::new("cloud_invalid_path", "cloudSyncError", None)
}

fn io(error: std::io::Error) -> AppError {
    AppError::io("cloud_workspace_io", error)
}

fn relative_path(relative: &str) -> CommandResult<PathBuf> {
    if relative.is_empty()
        || relative.contains(['\\', ':', '\0'])
        || relative
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(invalid());
    }
    let path = PathBuf::from(relative);
    if !path
        .components()
        .all(|part| matches!(part, Component::Normal(_)))
    {
        return Err(invalid());
    }
    Ok(path)
}

fn scoped_path(root: &Path, relative: &str) -> CommandResult<PathBuf> {
    let child = root.join(relative_path(relative)?);
    // Check existing ancestors too: a missing leaf below a junction can still escape.
    for ancestor in child.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(_) => {
                if !fs::canonicalize(ancestor).map_err(io)?.starts_with(root) {
                    return Err(invalid());
                }
                return Ok(child);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(io(error)),
        }
    }
    Err(invalid())
}

fn journal_path(app: &AppHandle, scope: &str) -> CommandResult<PathBuf> {
    let hash = format!("{:x}", Sha256::digest(scope.as_bytes()));
    app_data_file(app, &format!("cloud-workspaces/{hash}.json"))
}

fn read_json(path: &Path) -> CommandResult<Value> {
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(io)?
        .take(MAX_SNAPSHOT + 1)
        .read_to_end(&mut bytes)
        .map_err(io)?;
    if bytes.len() as u64 > MAX_SNAPSHOT {
        return Err(AppError::new(
            "cloud_snapshot_too_large",
            "cloudSyncError",
            None,
        ));
    }
    serde_json::from_slice(&bytes).map_err(|error| {
        AppError::new(
            "cloud_snapshot_invalid",
            "cloudSyncError",
            Some(error.to_string()),
        )
    })
}

fn write_json(path: &Path, value: &Value) -> CommandResult<()> {
    let bytes = serde_json::to_vec(value).map_err(|error| {
        AppError::new(
            "cloud_snapshot_invalid",
            "cloudSyncError",
            Some(error.to_string()),
        )
    })?;
    if bytes.len() as u64 > MAX_SNAPSHOT {
        return Err(AppError::new(
            "cloud_snapshot_too_large",
            "cloudSyncError",
            None,
        ));
    }
    atomic_write(path, &bytes)
}

#[tauri::command(async)]
pub(super) fn load_cloud_journal(app: AppHandle, scope: String) -> CommandResult<Option<Value>> {
    let path = journal_path(&app, &scope)?;
    match fs::metadata(&path) {
        Ok(_) => read_json(&path).map(Some),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io(error)),
    }
}

#[tauri::command(async)]
pub(super) fn save_cloud_journal(
    app: AppHandle,
    scope: String,
    journal: Value,
) -> CommandResult<()> {
    write_json(&journal_path(&app, &scope)?, &journal)
}

#[derive(Serialize)]
pub(super) struct SnapshotFile {
    name: String,
    stamp: String,
    snapshot: Option<Value>,
    unreadable: bool,
}

#[tauri::command(async)]
pub(super) fn read_cloud_workspace(
    root: String,
    known: BTreeMap<String, String>,
    device: String,
) -> CommandResult<Vec<SnapshotFile>> {
    let root = fs::canonicalize(root).map_err(io)?;
    let directory = scoped_path(&root, WORKSPACE)?;
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(io(error)),
    };
    let own_file = format!("{device}.json");
    let mut files = Vec::new();
    for entry in entries {
        let entry = entry.map_err(io)?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == own_file || !name.ends_with(".json") || !entry.file_type().map_err(io)?.is_file()
        {
            continue;
        }
        let metadata = entry.metadata().map_err(io)?;
        let timestamp = |time: std::io::Result<SystemTime>| {
            time.ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |time| time.as_nanos())
        };
        let stamp = format!(
            "{}:{}:{}",
            metadata.len(),
            timestamp(metadata.modified()),
            timestamp(metadata.created())
        );
        let mut unreadable = false;
        let snapshot = if known.get(&name) == Some(&stamp) {
            None
        } else {
            match read_json(&scoped_path(&root, &format!("{WORKSPACE}/{name}"))?) {
                Ok(value) => Some(value),
                Err(_) => {
                    unreadable = true;
                    None
                }
            }
        };
        files.push(SnapshotFile {
            name,
            stamp,
            snapshot,
            unreadable,
        });
    }
    files.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(files)
}

#[tauri::command(async)]
pub(super) fn write_cloud_workspace(
    root: String,
    device: String,
    snapshot: Value,
) -> CommandResult<()> {
    let device = Uuid::parse_str(&device).map_err(|_| invalid())?;
    let root = fs::canonicalize(root).map_err(io)?;
    let relative = format!("{WORKSPACE}/{device}.json");
    let target = scoped_path(&root, &relative)?;
    for path in snapshot["files"].as_array().into_iter().flatten() {
        scoped_path(&root, path.as_str().ok_or_else(invalid)?)?;
    }
    for draft in snapshot["drafts"].as_array().into_iter().flatten() {
        if let Some(path) = draft["path"].as_str() {
            scoped_path(&root, path)?;
        }
    }
    write_json(&target, &snapshot)
}

#[tauri::command(async)]
pub(super) fn open_cloud_document(root: String, relative: String) -> CommandResult<OpenedDocument> {
    let canonical_root = fs::canonicalize(&root).map_err(io)?;
    let path = fs::canonicalize(scoped_path(&canonical_root, &relative)?).map_err(io)?;
    if !path.starts_with(&canonical_root) || !path.is_file() {
        return Err(invalid());
    }
    let mut opened = open_file(OpenFileRequest {
        path: path.to_string_lossy().into_owned(),
        encoding_override: None,
    })?;
    opened.path = Path::new(&root)
        .join(relative_path(&relative)?)
        .to_string_lossy()
        .into_owned();
    Ok(opened)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_portable_relative_paths() {
        for path in [
            "../secret",
            "/absolute",
            "a/../b",
            "C:/file",
            "a\\b",
            "a//b",
        ] {
            assert!(relative_path(path).is_err(), "{path}");
        }
        assert!(relative_path("文档/草稿.txt").is_ok());
    }

    #[test]
    fn publishes_per_device_and_only_reads_changed_snapshots() {
        let root = std::env::temp_dir().join(Uuid::new_v4().to_string());
        fs::create_dir(&root).unwrap();
        let root_path = root.to_string_lossy().into_owned();
        let sender = Uuid::new_v4().to_string();
        let receiver = Uuid::new_v4().to_string();
        let snapshot =
            json!({ "version": 1, "files": ["文档/草稿.txt"], "drafts": [], "resolved": [] });
        write_cloud_workspace(root_path.clone(), sender.clone(), snapshot.clone()).unwrap();
        assert!(
            read_cloud_workspace(root_path.clone(), BTreeMap::new(), sender)
                .unwrap()
                .is_empty()
        );
        let first =
            read_cloud_workspace(root_path.clone(), BTreeMap::new(), receiver.clone()).unwrap();
        assert_eq!(first[0].snapshot, Some(snapshot));
        let known = BTreeMap::from([(first[0].name.clone(), first[0].stamp.clone())]);
        let unchanged = read_cloud_workspace(root_path, known, receiver).unwrap();
        assert!(unchanged[0].snapshot.is_none() && !unchanged[0].unreadable);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn scopes_missing_files_and_rejects_link_escapes() {
        let root = std::env::temp_dir().join(Uuid::new_v4().to_string());
        fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        std::os::unix::fs::symlink(root.parent().unwrap(), root.join("escape")).unwrap();
        assert!(scoped_path(&root, "next/missing.txt").is_ok());
        assert!(scoped_path(&root, "escape/missing.txt").is_err());
        fs::remove_file(root.join("escape")).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
