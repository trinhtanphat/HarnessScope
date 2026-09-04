use crate::{CoreError, TraceEventInput, redact_value};
use serde_json::{Map, Value};
use std::{fs, path::Path};
use time::{OffsetDateTime, macros::format_description};
use uuid::Uuid;

fn now_iso() -> Result<String, CoreError> {
    OffsetDateTime::now_utc()
        .format(&format_description!(
            "[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z"
        ))
        .map_err(|error| CoreError::Time(error.to_string()))
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_owned)
}

fn headers_to_object(headers: Option<&Value>) -> Value {
    let mut out = Map::new();
    for header in headers.and_then(Value::as_array).into_iter().flatten() {
        if let (Some(name), Some(value)) = (
            header.get("name").and_then(Value::as_str),
            header.get("value").and_then(Value::as_str),
        ) {
            out.insert(name.to_owned(), Value::String(value.to_owned()));
        }
    }
    Value::Object(out)
}

fn parse_body(text: Option<&Value>) -> Value {
    match text.and_then(Value::as_str) {
        None => Value::Null,
        Some(text) => serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.to_owned())),
    }
}

pub fn import_har(path: &Path) -> Result<Vec<TraceEventInput>, CoreError> {
    let document: Value = serde_json::from_str(&fs::read_to_string(path)?)?;
    let entries = document
        .get("log")
        .and_then(|value| value.get("entries"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut events = Vec::with_capacity(entries.len() * 2);

    for entry in entries {
        let correlation_id = Uuid::new_v4().to_string();
        let timestamp = string_field(&entry, "startedDateTime").unwrap_or(now_iso()?);
        let request = entry.get("request").unwrap_or(&Value::Null);
        let response = entry.get("response").unwrap_or(&Value::Null);

        let mut request_raw = Map::new();
        request_raw.insert(
            "method".into(),
            request
                .get("method")
                .cloned()
                .unwrap_or(Value::Null),
        );
        request_raw.insert(
            "url".into(),
            request.get("url").cloned().unwrap_or(Value::Null),
        );
        request_raw.insert(
            "headers".into(),
            headers_to_object(request.get("headers")),
        );
        request_raw.insert(
            "body".into(),
            parse_body(request.get("postData").and_then(|value| value.get("text"))),
        );
        request_raw.insert(
            "mimeType".into(),
            request
                .get("postData")
                .and_then(|value| value.get("mimeType"))
                .cloned()
                .unwrap_or(Value::Null),
        );

        let mut response_raw = Map::new();
        response_raw.insert(
            "status".into(),
            response.get("status").cloned().unwrap_or(Value::Null),
        );
        response_raw.insert(
            "headers".into(),
            headers_to_object(response.get("headers")),
        );
        response_raw.insert(
            "body".into(),
            parse_body(response.get("content").and_then(|value| value.get("text"))),
        );
        response_raw.insert(
            "mimeType".into(),
            response
                .get("content")
                .and_then(|value| value.get("mimeType"))
                .cloned()
                .unwrap_or(Value::Null),
        );

        let request = redact_value(&Value::Object(request_raw), "");
        let response = redact_value(&Value::Object(response_raw), "");
        events.push(TraceEventInput {
            id: None,
            timestamp_utc: Some(timestamp.clone()),
            source: "har".into(),
            kind: "HttpRequest".into(),
            correlation_id: Some(correlation_id.clone()),
            data: request.value,
            redaction: Some(if request.redacted { "redacted" } else { "none" }.into()),
        });
        events.push(TraceEventInput {
            id: None,
            timestamp_utc: Some(timestamp),
            source: "har".into(),
            kind: "HttpResponse".into(),
            correlation_id: Some(correlation_id),
            data: response.value,
            redaction: Some(if response.redacted { "redacted" } else { "none" }.into()),
        });
    }

    Ok(events)
}
