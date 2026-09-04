use crate::{CoreError, TraceEventInput, Workspace};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant, UNIX_EPOCH},
};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WatchRequest {
    pub path: PathBuf,
    #[serde(default = "default_seconds")]
    pub seconds: u64,
    #[serde(default = "default_interval_ms")]
    pub interval_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WatchResult {
    pub path: PathBuf,
    pub events_captured: usize,
    pub seconds: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct FileMeta {
    size: u64,
    mtime_ms: u64,
}

const fn default_seconds() -> u64 {
    10
}

const fn default_interval_ms() -> u64 {
    500
}

fn modified_millis(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn snapshot(root: &Path) -> BTreeMap<PathBuf, FileMeta> {
    let mut files = BTreeMap::new();
    let mut stack = vec![root.to_path_buf()];

    while let Some(directory) = stack.pop() {
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(metadata) = fs::symlink_metadata(&path) else {
                continue;
            };
            let file_type = metadata.file_type();
            if file_type.is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                stack.push(path);
            } else if metadata.is_file() {
                files.insert(
                    path,
                    FileMeta {
                        size: metadata.len(),
                        mtime_ms: modified_millis(&metadata),
                    },
                );
            }
        }
    }

    files
}

pub fn watch_files(
    workspace: &Workspace,
    session_id: &str,
    request: WatchRequest,
) -> Result<WatchResult, CoreError> {
    if workspace.get_session(session_id)?.is_none() {
        return Err(CoreError::SessionNotFound);
    }
    if request.path.as_os_str().is_empty() || request.interval_ms == 0 {
        return Err(CoreError::InvalidArgument);
    }

    let root = request.path.canonicalize()?;
    let mut previous = snapshot(&root);
    let duration = Duration::from_secs(request.seconds);
    let interval = Duration::from_millis(request.interval_ms);
    let started = Instant::now();
    let mut captured = 0usize;

    while started.elapsed() < duration {
        let remaining = duration.saturating_sub(started.elapsed());
        thread::sleep(interval.min(remaining));
        let current = snapshot(&root);
        for (path, meta) in &current {
            if previous.get(path).is_some_and(|old| old == meta) {
                continue;
            }
            workspace.append_event(
                session_id,
                TraceEventInput {
                    id: None,
                    timestamp_utc: None,
                    source: "file-poll".into(),
                    kind: "FileWritten".into(),
                    correlation_id: None,
                    data: json!({
                        "path": path.to_string_lossy(),
                        "size": meta.size,
                        "mtimeMs": meta.mtime_ms,
                        "contentCaptured": false,
                    }),
                    redaction: None,
                },
            )?;
            captured += 1;
        }
        previous = current;
    }

    Ok(WatchResult {
        path: root,
        events_captured: captured,
        seconds: request.seconds,
    })
}
