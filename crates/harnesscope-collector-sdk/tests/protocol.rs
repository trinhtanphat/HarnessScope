use harnesscope_collector_sdk::{
    CollectorCapability, CollectorEnvelope, CollectorEnvelopeKind, CollectorManifest,
    CollectorProtocolError, COLLECTOR_SDK_VERSION, MAX_ENVELOPE_BYTES, validate_envelope,
    validate_manifest,
};
use serde_json::json;

fn fixture_manifest() -> CollectorManifest {
    CollectorManifest {
        sdk_version: "1".into(),
        id: "harnesscope.synthetic.collector".into(),
        name: "Synthetic Collector".into(),
        version: "0.4.0".into(),
        platforms: vec!["linux".into(), "macos".into()],
        capabilities: vec![
            CollectorCapability::ProcessLifecycle,
            CollectorCapability::ProcessMetadata,
            CollectorCapability::FileMetadata,
            CollectorCapability::CollectorDiagnostics,
        ],
        requires_explicit_paths: true,
        requires_target_launch: true,
        content_capture: "unsupported".into(),
    }
}

fn fixture_envelope(sequence: u64) -> CollectorEnvelope {
    CollectorEnvelope {
        sdk_version: "1".into(),
        collector_id: "harnesscope.synthetic.collector".into(),
        instance_id: "instance-1".into(),
        sequence,
        kind: CollectorEnvelopeKind::Event,
        event: Some(json!({
            "source": "collector",
            "kind": "ProcessStarted",
            "correlationId": "pid:1234",
            "data": { "pid": 1234 }
        })),
        diagnostic: None,
    }
}

#[test]
fn exposes_exact_v1_constants() {
    assert_eq!(COLLECTOR_SDK_VERSION, "1");
    assert_eq!(MAX_ENVELOPE_BYTES, 262_144);
}

#[test]
fn validates_manifest_contract() {
    let manifest = fixture_manifest();
    validate_manifest(&manifest).unwrap();

    let mut bad_version = manifest.clone();
    bad_version.sdk_version = "2".into();
    assert!(matches!(
        validate_manifest(&bad_version),
        Err(CollectorProtocolError::Protocol)
    ));

    let mut bad_id = manifest;
    bad_id.id = "not-a-reverse-dns-id".into();
    assert!(matches!(
        validate_manifest(&bad_id),
        Err(CollectorProtocolError::Protocol)
    ));
}

#[test]
fn rejects_duplicate_or_out_of_order_sequence() {
    let first = fixture_envelope(7);
    validate_envelope(None, &first).unwrap();
    assert!(matches!(
        validate_envelope(Some(7), &fixture_envelope(7)),
        Err(CollectorProtocolError::Sequence)
    ));
    assert!(matches!(
        validate_envelope(Some(7), &fixture_envelope(6)),
        Err(CollectorProtocolError::Sequence)
    ));
}

#[test]
fn rejects_shape_mismatches_and_oversize_envelopes() {
    let mut mismatch = fixture_envelope(1);
    mismatch.diagnostic = Some(harnesscope_collector_sdk::CollectorDiagnostic {
        code: "BAD".into(),
        message: "x".into(),
        data: None,
    });
    assert!(matches!(
        validate_envelope(None, &mismatch),
        Err(CollectorProtocolError::Protocol)
    ));

    let mut heartbeat = fixture_envelope(2);
    heartbeat.kind = CollectorEnvelopeKind::Heartbeat;
    assert!(matches!(
        validate_envelope(None, &heartbeat),
        Err(CollectorProtocolError::Protocol)
    ));

    let mut oversized = fixture_envelope(3);
    oversized.event = Some(json!({
        "source": "collector",
        "kind": "Unknown",
        "data": { "payload": "x".repeat(MAX_ENVELOPE_BYTES) }
    }));
    assert!(matches!(
        validate_envelope(None, &oversized),
        Err(CollectorProtocolError::Protocol)
    ));
}
