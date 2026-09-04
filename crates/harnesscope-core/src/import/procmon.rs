use crate::{CoreError, TraceEventInput};
use regex::Regex;
use serde_json::{Map, Value};
use std::{fs::File, path::Path, sync::OnceLock};

fn time_pattern() -> &'static Regex {
    static VALUE: OnceLock<Regex> = OnceLock::new();
    VALUE.get_or_init(|| {
        Regex::new(r"^(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?")
            .expect("Procmon time regex must compile")
    })
}

fn child_pid_pattern() -> &'static Regex {
    static VALUE: OnceLock<Regex> = OnceLock::new();
    VALUE.get_or_init(|| Regex::new(r"(?i)PID:\s*(\d+)").expect("child PID regex must compile"))
}

fn command_line_pattern() -> &'static Regex {
    static VALUE: OnceLock<Regex> = OnceLock::new();
    VALUE.get_or_init(|| {
        Regex::new(r"(?i)Command line:\s*(.+)$").expect("command line regex must compile")
    })
}

fn parse_timestamp(value: &str, date: &str) -> String {
    let Some(captures) = time_pattern().captures(value) else {
        return format!("{date}T00:00:00.000Z");
    };
    let fraction = captures.get(4).map(|value| value.as_str()).unwrap_or("");
    let mut milliseconds = fraction.chars().take(3).collect::<String>();
    while milliseconds.len() < 3 {
        milliseconds.push('0');
    }
    format!(
        "{date}T{}:{}:{}.{}Z",
        &captures[1], &captures[2], &captures[3], milliseconds
    )
}

fn kind_for(operation: &str) -> &'static str {
    let lower = operation.to_ascii_lowercase();
    if lower.contains("process create") {
        "ProcessStarted"
    } else if lower.contains("process exit") {
        "ProcessExited"
    } else if lower.contains("readfile") {
        "FileRead"
    } else if lower.contains("writefile") {
        "FileWritten"
    } else if lower.contains("setrenameinformationfile") || lower.contains("rename") {
        "FileRenamed"
    } else {
        "Unknown"
    }
}

fn nullable_string(value: Option<&str>) -> Value {
    value
        .filter(|value| !value.is_empty())
        .map(|value| Value::String(value.to_owned()))
        .unwrap_or(Value::Null)
}

pub fn import_procmon(path: &Path, date: &str) -> Result<Vec<TraceEventInput>, CoreError> {
    let mut reader = csv::Reader::from_reader(File::open(path)?);
    let headers = reader
        .headers()
        .map_err(|error| CoreError::InvalidData(error.to_string()))?
        .clone();
    let index = |name: &str| headers.iter().position(|header| header == name);
    let time_index = index("Time of Day");
    let process_index = index("Process Name");
    let pid_index = index("PID");
    let operation_index = index("Operation");
    let path_index = index("Path");
    let result_index = index("Result");
    let detail_index = index("Detail");
    let mut events = Vec::new();

    for row in reader.records() {
        let row = row.map_err(|error| CoreError::InvalidData(error.to_string()))?;
        let field = |index: Option<usize>| index.and_then(|index| row.get(index)).unwrap_or("");
        let time = field(time_index);
        let process_name = field(process_index);
        let pid_text = field(pid_index);
        let operation = field(operation_index);
        let path_value = field(path_index);
        let result = field(result_index);
        let detail = field(detail_index);
        let kind = kind_for(operation);

        let mut data = Map::new();
        data.insert("processName".into(), nullable_string(Some(process_name)));
        data.insert(
            "pid".into(),
            pid_text
                .parse::<u64>()
                .ok()
                .filter(|value| *value != 0)
                .map(serde_json::Number::from)
                .map(Value::Number)
                .unwrap_or(Value::Null),
        );
        data.insert("operation".into(), nullable_string(Some(operation)));
        data.insert("path".into(), nullable_string(Some(path_value)));
        data.insert("result".into(), nullable_string(Some(result)));
        data.insert("detail".into(), nullable_string(Some(detail)));

        if kind == "ProcessStarted" {
            if let Some(captures) = child_pid_pattern().captures(detail)
                && let Ok(pid) = captures[1].parse::<u64>()
            {
                data.insert("childPid".into(), Value::Number(pid.into()));
            }
            if let Some(captures) = command_line_pattern().captures(detail) {
                data.insert("commandLine".into(), Value::String(captures[1].to_owned()));
            }
        }

        events.push(TraceEventInput {
            id: None,
            timestamp_utc: Some(parse_timestamp(time, date)),
            source: "procmon".into(),
            kind: kind.into(),
            correlation_id: (!pid_text.is_empty()).then(|| pid_text.to_owned()),
            data: Value::Object(data),
            redaction: None,
        });
    }

    Ok(events)
}
