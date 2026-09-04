use crate::{CoreError, TraceEventInput, redact_value};
use serde_json::Value;
use std::{collections::BTreeMap, fs, path::Path};
use time::{OffsetDateTime, macros::format_description};

fn now_iso() -> Result<String, CoreError> {
    OffsetDateTime::now_utc()
        .format(&format_description!(
            "[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z"
        ))
        .map_err(|error| CoreError::Time(error.to_string()))
}

fn trim_one_quote_layer(value: &str) -> &str {
    let bytes = value.as_bytes();
    if bytes.len() >= 2
        && ((bytes[0] == b'\'' && bytes[bytes.len() - 1] == b'\'')
            || (bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"'))
    {
        &value[1..value.len() - 1]
    } else {
        value
    }
}

fn parse_mapping(text: &str) -> BTreeMap<String, String> {
    let mut mapping = BTreeMap::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some(index) = trimmed.find(':') else {
            continue;
        };
        let key = trimmed[..index].trim();
        let value = trim_one_quote_layer(trimmed[index + 1..].trim());
        mapping.insert(key.to_owned(), value.to_owned());
    }
    mapping
}

fn get_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for key in path.split('.') {
        current = current.get(key)?;
    }
    Some(current)
}

fn value_as_string(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(value)) => Some(value.clone()),
        Some(Value::Null) | None => None,
        Some(value) => Some(match value {
            Value::Bool(value) => value.to_string(),
            Value::Number(value) => value.to_string(),
            _ => value.to_string(),
        }),
    }
}

fn canonical_kind(value: Option<&Value>) -> String {
    let original = value_as_string(value).unwrap_or_default();
    match original.trim().to_ascii_lowercase().as_str() {
        "permission_prompt" => "PermissionPrompt".into(),
        "permission_decision" => "PermissionDecision".into(),
        "tool_call" => "ToolCall".into(),
        "tool_result" => "ToolResult".into(),
        "skill_read" => "SkillRead".into(),
        "instruction_read" => "InstructionRead".into(),
        "context_marker" => "ContextMarker".into(),
        "compaction_marker" => "CompactionMarker".into(),
        "resume_marker" => "ResumeMarker".into(),
        "user_prompt" => "UserPrompt".into(),
        "assistant_message" => "AssistantMessage".into(),
        "file_read" => "FileRead".into(),
        "file_written" => "FileWritten".into(),
        _ if original.is_empty() => "Unknown".into(),
        _ => original,
    }
}

pub fn import_jsonl(path: &Path, map_path: &Path) -> Result<Vec<TraceEventInput>, CoreError> {
    let mapping = parse_mapping(&fs::read_to_string(map_path)?);
    let timestamp_path = mapping
        .get("timestamp")
        .map(String::as_str)
        .unwrap_or("timestamp");
    let kind_path = mapping.get("kind").map(String::as_str).unwrap_or("kind");
    let correlation_path = mapping
        .get("correlationId")
        .map(String::as_str)
        .unwrap_or("correlationId");
    let data_path = mapping.get("data").map(String::as_str).unwrap_or("data");
    let source = mapping
        .get("source")
        .cloned()
        .unwrap_or_else(|| "jsonl".into());
    let mut events = Vec::new();

    for (index, line) in fs::read_to_string(path)?
        .lines()
        .filter(|line| !line.is_empty())
        .enumerate()
    {
        let record: Value = serde_json::from_str(line)?;
        let data = get_path(&record, data_path)
            .cloned()
            .unwrap_or(Value::Object(Default::default()));
        let redacted = redact_value(&data, "");
        let timestamp = value_as_string(get_path(&record, timestamp_path)).unwrap_or(now_iso()?);
        let correlation_id = value_as_string(get_path(&record, correlation_path))
            .unwrap_or_else(|| format!("line-{}", index + 1));
        events.push(TraceEventInput {
            id: None,
            timestamp_utc: Some(timestamp),
            source: source.clone(),
            kind: canonical_kind(get_path(&record, kind_path)),
            correlation_id: Some(correlation_id),
            data: redacted.value,
            redaction: Some(
                if redacted.redacted {
                    "redacted"
                } else {
                    "none"
                }
                .into(),
            ),
        });
    }

    Ok(events)
}
