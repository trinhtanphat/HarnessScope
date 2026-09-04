use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("workspace is locked")]
    WorkspaceLocked,
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
