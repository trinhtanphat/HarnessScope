use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum CollectorCapability {
    #[serde(rename = "process.lifecycle")]
    ProcessLifecycle,
    #[serde(rename = "process.metadata")]
    ProcessMetadata,
    #[serde(rename = "file.metadata")]
    FileMetadata,
    #[serde(rename = "collector.diagnostics")]
    CollectorDiagnostics,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CollectorManifest {
    pub sdk_version: String,
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub platforms: Vec<String>,
    #[serde(default)]
    pub capabilities: Vec<CollectorCapability>,
    pub requires_explicit_paths: bool,
    pub requires_target_launch: bool,
    pub content_capture: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CollectorTarget {
    pub executable: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CollectorStartRequest {
    pub sdk_version: String,
    pub collector_id: String,
    pub instance_id: String,
    #[serde(default)]
    pub requested_capabilities: Vec<CollectorCapability>,
    #[serde(default)]
    pub paths: Vec<String>,
    #[serde(default)]
    pub hash_files: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<CollectorTarget>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CollectorDiagnostic {
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CollectorEnvelopeKind {
    Event,
    Diagnostic,
    Heartbeat,
    Completed,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CollectorEnvelope {
    pub sdk_version: String,
    pub collector_id: String,
    pub instance_id: String,
    pub sequence: u64,
    pub kind: CollectorEnvelopeKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagnostic: Option<CollectorDiagnostic>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CollectorStatus {
    Registered,
    Starting,
    Running,
    Stopping,
    Stopped,
    Failed,
}
