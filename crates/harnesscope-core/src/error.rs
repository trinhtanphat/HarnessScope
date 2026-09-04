use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("workspace is locked")]
    WorkspaceLocked,
    #[error("session not found")]
    SessionNotFound,
    #[error("invalid import file")]
    ImportInvalidFile,
    #[error("launch failed")]
    LaunchFailed,
    #[error("export failed")]
    ExportFailed,
    #[error("invalid argument")]
    InvalidArgument,
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("time error: {0}")]
    Time(String),
    #[error("invalid data: {0}")]
    InvalidData(String),
}

impl CoreError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::WorkspaceLocked => "WORKSPACE_LOCKED",
            Self::SessionNotFound => "SESSION_NOT_FOUND",
            Self::ImportInvalidFile => "IMPORT_INVALID_FILE",
            Self::LaunchFailed => "LAUNCH_FAILED",
            Self::ExportFailed => "EXPORT_FAILED",
            Self::InvalidArgument => "INVALID_ARGUMENT",
            Self::Sqlite(_)
            | Self::Io(_)
            | Self::Json(_)
            | Self::Time(_)
            | Self::InvalidData(_) => "INTERNAL_ERROR",
        }
    }

    pub fn public_message(&self) -> &'static str {
        match self {
            Self::WorkspaceLocked => "The HarnessScope workspace is already in use.",
            Self::SessionNotFound => "The selected session no longer exists.",
            Self::ImportInvalidFile => "The selected evidence file could not be imported.",
            Self::LaunchFailed => "The selected command could not be launched.",
            Self::ExportFailed => "The behavioral spec could not be exported.",
            Self::InvalidArgument => "One or more arguments are invalid.",
            Self::Sqlite(_)
            | Self::Io(_)
            | Self::Json(_)
            | Self::Time(_)
            | Self::InvalidData(_) => "HarnessScope could not complete the operation.",
        }
    }
}
