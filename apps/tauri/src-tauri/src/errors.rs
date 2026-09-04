use harnesscope_core::{CoreError, OperationEnvelope};

pub fn from_core<T>(result: Result<T, CoreError>) -> OperationEnvelope<T> {
    match result {
        Ok(value) => OperationEnvelope::success(value),
        Err(error) => OperationEnvelope::failure(error.code(), error.public_message()),
    }
}

pub fn state_failure<T>() -> OperationEnvelope<T> {
    OperationEnvelope::failure(
        "INTERNAL_ERROR",
        "HarnessScope could not access the local workspace.",
    )
}

pub fn dialog_failure<T>() -> OperationEnvelope<T> {
    OperationEnvelope::failure(
        "DIALOG_FAILED",
        "HarnessScope could not open the native file dialog.",
    )
}
