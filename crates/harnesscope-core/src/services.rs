use crate::{
    CompareResult, CoreError, ExportResult, LaunchRequest, LaunchResult, Session, SessionSnapshot,
    TraceEvent, TraceEventInput, Workspace, WorkspaceLock, compare_sessions, export_session,
    import_har, import_jsonl, import_procmon, infer_findings, launch_target,
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, fmt, path::Path, path::PathBuf};
use time::{OffsetDateTime, macros::format_description};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub platform: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub db_path: PathBuf,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub cancelled: bool,
    pub imported: usize,
    pub kinds: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InferenceResult {
    pub session: Session,
    pub findings: Vec<crate::Finding>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServiceExportResult {
    pub cancelled: bool,
    pub out_dir: PathBuf,
    pub files: Vec<String>,
}

pub struct AppServices {
    workspace: Workspace,
    _lease: WorkspaceLock,
    name: String,
    version: String,
    platform: String,
}

impl fmt::Debug for AppServices {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AppServices")
            .field("db_path", &self.workspace.path())
            .field("name", &self.name)
            .field("version", &self.version)
            .field("platform", &self.platform)
            .finish_non_exhaustive()
    }
}

fn today_utc() -> Result<String, CoreError> {
    OffsetDateTime::now_utc()
        .format(&format_description!("[year]-[month]-[day]"))
        .map_err(|error| CoreError::Time(error.to_string()))
}

fn import_result(events: Vec<crate::TraceEvent>) -> ImportResult {
    let kinds = events
        .iter()
        .map(|event| event.kind.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    ImportResult {
        cancelled: false,
        imported: events.len(),
        kinds,
    }
}

impl AppServices {
    pub fn open(
        db_path: impl AsRef<Path>,
        name: &str,
        version: &str,
        runtime: &str,
    ) -> Result<Self, CoreError> {
        let db_path = db_path.as_ref();
        if name.trim().is_empty() || version.trim().is_empty() || runtime.trim().is_empty() {
            return Err(CoreError::InvalidArgument);
        }
        let lease = WorkspaceLock::acquire(db_path, runtime)?;
        let workspace = Workspace::open(db_path)?;
        Ok(Self {
            workspace,
            _lease: lease,
            name: name.to_owned(),
            version: version.to_owned(),
            platform: std::env::consts::OS.to_owned(),
        })
    }

    pub fn app_info(&self) -> AppInfo {
        AppInfo {
            name: self.name.clone(),
            version: self.version.clone(),
            platform: self.platform.clone(),
        }
    }

    pub fn workspace_info(&self) -> WorkspaceInfo {
        WorkspaceInfo {
            db_path: self.workspace.path().to_path_buf(),
        }
    }

    fn require_session(&self, session_id: &str) -> Result<Session, CoreError> {
        if session_id.trim().is_empty() {
            return Err(CoreError::InvalidArgument);
        }
        self.workspace
            .get_session(session_id)?
            .ok_or(CoreError::SessionNotFound)
    }

    pub fn session_list(&self) -> Result<Vec<Session>, CoreError> {
        self.workspace.list_sessions()
    }

    pub fn session_create(&self, name: &str, mode: &str) -> Result<Session, CoreError> {
        if name.trim().is_empty() || mode.trim().is_empty() {
            return Err(CoreError::InvalidArgument);
        }
        self.workspace.create_session(name, mode)
    }

    pub fn timeline_get(&self, session_id: &str) -> Result<SessionSnapshot, CoreError> {
        let session = self.require_session(session_id)?;
        Ok(SessionSnapshot {
            session,
            events: self.workspace.list_events(session_id)?,
            findings: self.workspace.list_findings(session_id)?,
        })
    }

    pub fn inference_run(&self, session_id: &str) -> Result<InferenceResult, CoreError> {
        let session = self.require_session(session_id)?;
        let findings = infer_findings(&self.workspace.list_events(session_id)?);
        self.workspace.replace_findings(session_id, &findings)?;
        Ok(InferenceResult {
            session,
            findings: self.workspace.list_findings(session_id)?,
        })
    }

    pub fn compare_run(
        &self,
        session_a: &str,
        session_b: &str,
    ) -> Result<CompareResult, CoreError> {
        let a = self.timeline_get(session_a)?;
        let b = self.timeline_get(session_b)?;
        Ok(compare_sessions(&a, &b))
    }

    pub fn import_har(&self, session_id: &str, path: &Path) -> Result<ImportResult, CoreError> {
        self.require_session(session_id)?;
        let inputs = import_har(path).map_err(|_| CoreError::ImportInvalidFile)?;
        let stored = self
            .workspace
            .append_events(session_id, inputs)
            .map_err(|_| CoreError::ImportInvalidFile)?;
        Ok(import_result(stored))
    }

    pub fn import_procmon(&self, session_id: &str, path: &Path) -> Result<ImportResult, CoreError> {
        let date = today_utc()?;
        self.import_procmon_on_date(session_id, path, &date)
    }

    pub fn import_procmon_on_date(
        &self,
        session_id: &str,
        path: &Path,
        date: &str,
    ) -> Result<ImportResult, CoreError> {
        self.require_session(session_id)?;
        if date.trim().is_empty() {
            return Err(CoreError::InvalidArgument);
        }
        let inputs = import_procmon(path, date).map_err(|_| CoreError::ImportInvalidFile)?;
        let stored = self
            .workspace
            .append_events(session_id, inputs)
            .map_err(|_| CoreError::ImportInvalidFile)?;
        Ok(import_result(stored))
    }

    pub fn import_jsonl(
        &self,
        session_id: &str,
        path: &Path,
        map_path: &Path,
    ) -> Result<ImportResult, CoreError> {
        self.require_session(session_id)?;
        let inputs = import_jsonl(path, map_path).map_err(|_| CoreError::ImportInvalidFile)?;
        let stored = self
            .workspace
            .append_events(session_id, inputs)
            .map_err(|_| CoreError::ImportInvalidFile)?;
        Ok(import_result(stored))
    }

    pub fn launch_run(
        &self,
        session_id: &str,
        request: LaunchRequest,
    ) -> Result<LaunchResult, CoreError> {
        self.require_session(session_id)?;
        launch_target(&self.workspace, session_id, request).map_err(|error| match error {
            CoreError::InvalidArgument => CoreError::InvalidArgument,
            _ => CoreError::LaunchFailed,
        })
    }

    pub fn collector_append_event(
        &self,
        session_id: &str,
        input: TraceEventInput,
    ) -> Result<TraceEvent, CoreError> {
        self.require_session(session_id)?;
        self.workspace.append_event(session_id, input)
    }

    pub fn export_run(
        &self,
        session_id: &str,
        out_dir: &Path,
    ) -> Result<ServiceExportResult, CoreError> {
        self.require_session(session_id)?;
        let ExportResult { out_dir, files } = export_session(&self.workspace, session_id, out_dir)
            .map_err(|_| CoreError::ExportFailed)?;
        Ok(ServiceExportResult {
            cancelled: false,
            out_dir,
            files,
        })
    }
}
