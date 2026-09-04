use crate::{CoreError, TraceEventInput, Workspace};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, ExitStatus, Stdio},
    thread,
};

const STRUCTURED_PREFIX: &str = "HARNESSCOPE_EVENT ";
const MALFORMED_DIAGNOSTIC: &str = "Malformed HARNESSCOPE_EVENT marker omitted from persistence.";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    pub target: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<PathBuf>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchResult {
    pub pid: u32,
    pub exit_code: Option<i32>,
    pub signal: Option<String>,
    pub events_captured: usize,
}

fn executable_name(target: &str) -> String {
    Path::new(target)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(target)
        .to_owned()
}

fn parse_marker(line: &str) -> Option<TraceEventInput> {
    let payload = line.strip_prefix(STRUCTURED_PREFIX)?;
    let parsed: Value = match serde_json::from_str(payload) {
        Ok(value) => value,
        Err(_) => {
            return Some(TraceEventInput {
                id: None,
                timestamp_utc: None,
                source: "launcher".into(),
                kind: "Unknown".into(),
                correlation_id: None,
                data: json!({ "diagnostic": MALFORMED_DIAGNOSTIC }),
                redaction: None,
            });
        }
    };

    Some(TraceEventInput {
        id: None,
        timestamp_utc: parsed
            .get("timestampUtc")
            .and_then(Value::as_str)
            .map(str::to_owned),
        source: parsed
            .get("source")
            .and_then(Value::as_str)
            .unwrap_or("structured-stdout")
            .to_owned(),
        kind: parsed
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("Unknown")
            .to_owned(),
        correlation_id: parsed
            .get("correlationId")
            .and_then(Value::as_str)
            .map(str::to_owned),
        data: parsed
            .get("data")
            .cloned()
            .unwrap_or_else(|| Value::Object(Default::default())),
        redaction: None,
    })
}

fn collect_structured<R>(reader: R) -> thread::JoinHandle<Vec<TraceEventInput>>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let reader = BufReader::new(reader);
        let mut events = Vec::new();
        for line in reader.lines() {
            let Ok(line) = line else {
                break;
            };
            if let Some(event) = parse_marker(&line) {
                events.push(event);
            }
        }
        events
    })
}

fn drain<R>(reader: R) -> thread::JoinHandle<()>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let reader = BufReader::new(reader);
        for line in reader.lines() {
            if line.is_err() {
                break;
            }
        }
    })
}

#[cfg(unix)]
fn signal_for(status: &ExitStatus) -> Option<String> {
    use std::os::unix::process::ExitStatusExt;
    status.signal().map(|value| value.to_string())
}

#[cfg(not(unix))]
fn signal_for(_status: &ExitStatus) -> Option<String> {
    None
}

pub fn launch_target(
    workspace: &Workspace,
    session_id: &str,
    request: LaunchRequest,
) -> Result<LaunchResult, CoreError> {
    if request.target.trim().is_empty() {
        return Err(CoreError::InvalidArgument);
    }
    if workspace.get_session(session_id)?.is_none() {
        return Err(CoreError::SessionNotFound);
    }

    let mut command = Command::new(&request.target);
    command
        .args(&request.args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = &request.cwd {
        command.current_dir(cwd);
    }

    let mut child = command.spawn().map_err(|_| CoreError::LaunchFailed)?;
    let pid = child.id();
    let started = workspace.append_event(
        session_id,
        TraceEventInput {
            id: None,
            timestamp_utc: None,
            source: "launcher".into(),
            kind: "ProcessStarted".into(),
            correlation_id: Some(format!("pid-{pid}")),
            data: json!({
                "pid": pid,
                "executable": request.target,
                "executableName": executable_name(&request.target),
                "args": request.args,
            }),
            redaction: None,
        },
    );
    if let Err(error) = started {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }

    let stdout = child.stdout.take().ok_or(CoreError::LaunchFailed)?;
    let stderr = child.stderr.take().ok_or(CoreError::LaunchFailed)?;
    let stdout_thread = collect_structured(stdout);
    let stderr_thread = drain(stderr);

    let status = child.wait().map_err(|_| CoreError::LaunchFailed)?;
    let structured = stdout_thread.join().map_err(|_| CoreError::LaunchFailed)?;
    stderr_thread.join().map_err(|_| CoreError::LaunchFailed)?;
    let stored = workspace.append_events(session_id, structured)?;

    workspace.append_event(
        session_id,
        TraceEventInput {
            id: None,
            timestamp_utc: None,
            source: "launcher".into(),
            kind: "ProcessExited".into(),
            correlation_id: Some(format!("pid-{pid}")),
            data: json!({
                "pid": pid,
                "exitCode": status.code(),
                "signal": signal_for(&status),
            }),
            redaction: None,
        },
    )?;

    Ok(LaunchResult {
        pid,
        exit_code: status.code(),
        signal: signal_for(&status),
        events_captured: stored.len() + 2,
    })
}
