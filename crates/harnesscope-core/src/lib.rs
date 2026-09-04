pub mod compare;
pub mod error;
pub mod export;
pub mod import;
pub mod infer;
pub mod lock;
pub mod model;
pub mod observe;
pub mod redact;
pub mod services;
pub mod store;

pub use compare::compare_sessions;
pub use error::CoreError;
pub use export::{ExportResult, export_session};
pub use import::{import_har, import_jsonl, import_procmon};
pub use infer::infer_findings;
pub use lock::{HEARTBEAT_INTERVAL, LockConfig, STALE_AFTER, WorkspaceLock, workspace_lock_path};
pub use model::{
    CompareResult, Finding, OperationEnvelope, Session, SessionSnapshot, TraceEvent,
    TraceEventInput,
};
pub use observe::{
    LaunchRequest, LaunchResult, WatchRequest, WatchResult, launch_target, watch_files,
};
pub use redact::{RedactionResult, redact_value};
pub use services::{
    AppInfo, AppServices, ImportResult, InferenceResult, ServiceExportResult, WorkspaceInfo,
};
pub use store::Workspace;

pub type WorkspaceLease = WorkspaceLock;
