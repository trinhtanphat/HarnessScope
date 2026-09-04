use crate::CoreError;
use serde::{Deserialize, Serialize};
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::mpsc::{self, Sender},
    thread::{self, JoinHandle},
    time::Duration as StdDuration,
};
use sysinfo::{Pid, System};
use time::{Duration, OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

pub const HEARTBEAT_INTERVAL: StdDuration = StdDuration::from_secs(5);
pub const STALE_AFTER: StdDuration = StdDuration::from_secs(30);

#[derive(Clone, Copy, Debug)]
pub struct LockConfig {
    pub heartbeat_interval: StdDuration,
    pub stale_after: StdDuration,
}

impl Default for LockConfig {
    fn default() -> Self {
        Self {
            heartbeat_interval: HEARTBEAT_INTERVAL,
            stale_after: STALE_AFTER,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OwnerMetadata {
    token: String,
    pid: u32,
    runtime: String,
    process_start_identity: Option<String>,
    acquired_utc: String,
    heartbeat_utc: String,
}

fn now_utc() -> Result<String, CoreError> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|error| CoreError::Time(error.to_string()))
}

fn read_owner(lock_path: &Path) -> Result<OwnerMetadata, CoreError> {
    let bytes = fs::read(lock_path.join("owner.json")).map_err(|_| CoreError::WorkspaceLocked)?;
    serde_json::from_slice(&bytes).map_err(|_| CoreError::WorkspaceLocked)
}

fn write_owner(lock_path: &Path, owner: &OwnerMetadata) -> Result<(), CoreError> {
    let owner_path = lock_path.join("owner.json");
    let temp_path = lock_path.join(format!(".owner-{}.tmp", owner.token));
    fs::write(&temp_path, serde_json::to_vec(owner)?)?;
    match fs::rename(&temp_path, &owner_path) {
        Ok(()) => Ok(()),
        Err(error) if owner_path.exists() => {
            fs::remove_file(&owner_path)?;
            fs::rename(&temp_path, &owner_path)?;
            Ok(())
        }
        Err(error) => {
            let _ = fs::remove_file(&temp_path);
            Err(CoreError::Io(error))
        }
    }
}

fn heartbeat_is_fresh(owner: &OwnerMetadata, stale_after: StdDuration) -> Result<bool, CoreError> {
    let heartbeat = OffsetDateTime::parse(&owner.heartbeat_utc, &Rfc3339)
        .map_err(|_| CoreError::WorkspaceLocked)?;
    let age = OffsetDateTime::now_utc() - heartbeat;
    let stale_seconds = i64::try_from(stale_after.as_secs()).unwrap_or(i64::MAX);
    Ok(age <= Duration::seconds(stale_seconds))
}

fn current_process_start_identity(pid: u32) -> Option<String> {
    let system = System::new_all();
    system
        .process(Pid::from_u32(pid))
        .map(|process| process.start_time().to_string())
}

fn default_process_alive(pid: u32) -> Result<bool, CoreError> {
    let system = System::new_all();
    Ok(system.process(Pid::from_u32(pid)).is_some())
}

pub fn workspace_lock_path(db_path: impl AsRef<Path>) -> PathBuf {
    let input = db_path.as_ref();
    let absolute = if input.is_absolute() {
        input.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(input))
            .unwrap_or_else(|_| input.to_path_buf())
    };
    let mut value = OsString::from(absolute.as_os_str());
    value.push(".lock");
    PathBuf::from(value)
}

fn refresh_owned(lock_path: &Path, token: &str) -> Result<(), CoreError> {
    let mut owner = read_owner(lock_path)?;
    if owner.token != token {
        return Err(CoreError::WorkspaceLocked);
    }
    owner.heartbeat_utc = now_utc()?;
    write_owner(lock_path, &owner)
}

pub struct WorkspaceLock {
    lock_path: PathBuf,
    token: String,
    active: bool,
    stop_sender: Option<Sender<()>>,
    heartbeat_thread: Option<JoinHandle<()>>,
}

impl WorkspaceLock {
    pub fn acquire(db_path: impl AsRef<Path>, runtime: &str) -> Result<Self, CoreError> {
        let pid = std::process::id();
        Self::acquire_with_probe(
            db_path,
            runtime,
            pid,
            current_process_start_identity(pid),
            LockConfig::default(),
            default_process_alive,
        )
    }

    pub fn acquire_with_probe<F>(
        db_path: impl AsRef<Path>,
        runtime: &str,
        pid: u32,
        process_start_identity: Option<String>,
        config: LockConfig,
        process_alive: F,
    ) -> Result<Self, CoreError>
    where
        F: Fn(u32) -> Result<bool, CoreError>,
    {
        let db_path = db_path.as_ref();
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let lock_path = workspace_lock_path(db_path);
        let now = now_utc()?;
        let owner = OwnerMetadata {
            token: Uuid::new_v4().to_string(),
            pid,
            runtime: runtime.to_string(),
            process_start_identity,
            acquired_utc: now.clone(),
            heartbeat_utc: now,
        };

        let mut stale_path = None;
        match fs::create_dir(&lock_path) {
            Ok(()) => {
                if let Err(error) = write_owner(&lock_path, &owner) {
                    let _ = fs::remove_dir_all(&lock_path);
                    return Err(error);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let existing = read_owner(&lock_path)?;
                if heartbeat_is_fresh(&existing, config.stale_after)? {
                    return Err(CoreError::WorkspaceLocked);
                }

                let alive = process_alive(existing.pid).map_err(|_| CoreError::WorkspaceLocked)?;
                if alive {
                    return Err(CoreError::WorkspaceLocked);
                }

                let stale = PathBuf::from(format!(
                    "{}.stale-{}",
                    lock_path.to_string_lossy(),
                    Uuid::new_v4()
                ));
                fs::rename(&lock_path, &stale).map_err(|_| CoreError::WorkspaceLocked)?;
                stale_path = Some(stale);

                if fs::create_dir(&lock_path).is_err() {
                    return Err(CoreError::WorkspaceLocked);
                }
                if let Err(error) = write_owner(&lock_path, &owner) {
                    let _ = fs::remove_dir_all(&lock_path);
                    return Err(error);
                }
            }
            Err(error) => return Err(CoreError::Io(error)),
        }

        if let Some(stale) = stale_path {
            let _ = fs::remove_dir_all(stale);
        }

        let (stop_sender, heartbeat_thread) = if config.heartbeat_interval.is_zero() {
            (None, None)
        } else {
            let (tx, rx) = mpsc::channel();
            let thread_lock_path = lock_path.clone();
            let thread_token = owner.token.clone();
            let interval = config.heartbeat_interval;
            let handle = thread::spawn(move || {
                loop {
                    match rx.recv_timeout(interval) {
                        Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            if refresh_owned(&thread_lock_path, &thread_token).is_err() {
                                break;
                            }
                        }
                    }
                }
            });
            (Some(tx), Some(handle))
        };

        Ok(Self {
            lock_path,
            token: owner.token,
            active: true,
            stop_sender,
            heartbeat_thread,
        })
    }

    pub fn refresh(&mut self) -> Result<(), CoreError> {
        if !self.active {
            return Err(CoreError::WorkspaceLocked);
        }
        refresh_owned(&self.lock_path, &self.token)
    }

    fn stop_heartbeat(&mut self) {
        if let Some(sender) = self.stop_sender.take() {
            let _ = sender.send(());
        }
        if let Some(handle) = self.heartbeat_thread.take() {
            let _ = handle.join();
        }
    }

    pub fn release(&mut self) -> Result<bool, CoreError> {
        if !self.active {
            return Ok(false);
        }
        self.active = false;
        self.stop_heartbeat();

        let owner = match read_owner(&self.lock_path) {
            Ok(owner) => owner,
            Err(_) => return Ok(false),
        };
        if owner.token != self.token {
            return Ok(false);
        }
        fs::remove_dir_all(&self.lock_path)?;
        Ok(true)
    }
}

impl Drop for WorkspaceLock {
    fn drop(&mut self) {
        let _ = self.release();
    }
}
