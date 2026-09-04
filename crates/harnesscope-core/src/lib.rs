pub mod compare;
pub mod error;
pub mod infer;
pub mod lock;
pub mod model;
pub mod redact;
pub mod store;

pub use compare::compare_sessions;
pub use error::CoreError;
pub use infer::infer_findings;
pub use lock::{HEARTBEAT_INTERVAL, LockConfig, STALE_AFTER, WorkspaceLock, workspace_lock_path};
pub use model::{
    CompareResult, Finding, OperationEnvelope, Session, SessionSnapshot, TraceEvent,
    TraceEventInput,
};
pub use redact::{RedactionResult, redact_value};
pub use store::Workspace;
