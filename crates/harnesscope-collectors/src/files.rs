use crossbeam_channel::{Receiver, unbounded};
use notify::{
    Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
    event::ModifyKind,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
};

pub(crate) struct FileWatcher {
    _watcher: Option<RecommendedWatcher>,
    pub receiver: Receiver<notify::Result<Event>>,
    pub roots: Vec<PathBuf>,
    pub hash_files: bool,
}

pub(crate) fn watch_selected_paths(
    paths: &[String],
    hash_files: bool,
) -> Result<FileWatcher, String> {
    let (tx, receiver) = unbounded();
    let mut roots = Vec::with_capacity(paths.len());
    for path in paths {
        let canonical = fs::canonicalize(path)
            .map_err(|error| format!("cannot open selected path {path}: {error}"))?;
        if !canonical.is_dir() {
            return Err(format!("selected path is not a directory: {path}"));
        }
        roots.push(canonical);
    }

    if roots.is_empty() {
        return Ok(FileWatcher {
            _watcher: None,
            receiver,
            roots,
            hash_files,
        });
    }

    let callback_tx = tx.clone();
    let mut watcher = RecommendedWatcher::new(
        move |result| {
            let _ = callback_tx.send(result);
        },
        Config::default(),
    )
    .map_err(|error| error.to_string())?;

    for root in &roots {
        watcher
            .watch(root, RecursiveMode::Recursive)
            .map_err(|error| error.to_string())?;
    }

    Ok(FileWatcher {
        _watcher: Some(watcher),
        receiver,
        roots,
        hash_files,
    })
}

fn canonical_scoped_path(path: &Path, roots: &[PathBuf]) -> Option<PathBuf> {
    if path.exists() {
        let canonical = fs::canonicalize(path).ok()?;
        return roots
            .iter()
            .any(|root| canonical.starts_with(root))
            .then_some(canonical);
    }

    let parent = path.parent()?;
    let canonical_parent = fs::canonicalize(parent).ok()?;
    if !roots.iter().any(|root| canonical_parent.starts_with(root)) {
        return None;
    }
    let name = path.file_name()?;
    Some(canonical_parent.join(name))
}

fn sha256(path: &Path) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    let mut file = File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let read = file.read(&mut buffer).ok()?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Some(format!("{:x}", hasher.finalize()))
}

fn file_data(path: &Path, hash_files: bool) -> Value {
    let metadata = fs::metadata(path).ok();
    let mut data = json!({
        "path": path.to_string_lossy(),
        "contentCaptured": false,
    });
    if let Some(metadata) = metadata {
        data["size"] = json!(metadata.len());
    }
    if hash_files {
        if let Some(hash) = sha256(path) {
            data["sha256"] = json!(hash);
        }
    }
    data
}

fn event_kind(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Create(_) => Some("FileCreated"),
        EventKind::Modify(ModifyKind::Name(_)) => Some("FileRenamed"),
        EventKind::Modify(_) => Some("FileWritten"),
        EventKind::Remove(_) => Some("FileRemoved"),
        _ => None,
    }
}

pub(crate) fn map_event(
    event: &Event,
    roots: &[PathBuf],
    hash_files: bool,
) -> Vec<Value> {
    let Some(kind) = event_kind(&event.kind) else {
        return Vec::new();
    };

    if kind == "FileRenamed" {
        let scoped = event
            .paths
            .iter()
            .filter_map(|path| canonical_scoped_path(path, roots))
            .collect::<Vec<_>>();
        if scoped.is_empty() {
            return Vec::new();
        }
        let path = scoped.last().expect("non-empty scoped rename paths");
        let mut data = file_data(path, hash_files);
        if scoped.len() > 1 {
            data["fromPath"] = json!(scoped[0].to_string_lossy());
        }
        return vec![json!({
            "source": "collector",
            "kind": kind,
            "correlationId": path.to_string_lossy(),
            "data": data,
        })];
    }

    event
        .paths
        .iter()
        .filter_map(|path| canonical_scoped_path(path, roots))
        .map(|path| {
            json!({
                "source": "collector",
                "kind": kind,
                "correlationId": path.to_string_lossy(),
                "data": file_data(&path, hash_files),
            })
        })
        .collect()
}
