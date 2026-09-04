use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub name: String,
    pub mode: String,
    pub created_utc: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TraceEventInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp_utc: Option<String>,
    pub source: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    #[serde(default)]
    pub data: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redaction: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TraceEvent {
    pub id: String,
    pub session_id: String,
    pub timestamp_utc: String,
    pub source: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    #[serde(default)]
    pub data: Value,
    pub redaction: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub title: String,
    pub category: String,
    pub confidence: f64,
    pub statement: String,
    #[serde(default)]
    pub evidence_event_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub session: Session,
    #[serde(default)]
    pub events: Vec<TraceEvent>,
    #[serde(default)]
    pub findings: Vec<Finding>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompareResult {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_a: Option<Session>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_b: Option<Session>,
    #[serde(default)]
    pub shared_event_kinds: Vec<String>,
    #[serde(default)]
    pub only_a_event_kinds: Vec<String>,
    #[serde(default)]
    pub only_b_event_kinds: Vec<String>,
    #[serde(default)]
    pub shared_tool_names: Vec<String>,
    #[serde(default)]
    pub only_a_tool_names: Vec<String>,
    #[serde(default)]
    pub only_b_tool_names: Vec<String>,
    #[serde(default)]
    pub shared_finding_categories: Vec<String>,
    #[serde(default)]
    pub only_a_finding_categories: Vec<String>,
    #[serde(default)]
    pub only_b_finding_categories: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OperationEnvelope<T> {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<T>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl<T> OperationEnvelope<T> {
    pub fn success(value: T) -> Self {
        Self { ok: true, value: Some(value), code: None, message: None }
    }

    pub fn failure(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self { ok: false, value: None, code: Some(code.into()), message: Some(message.into()) }
    }
}
