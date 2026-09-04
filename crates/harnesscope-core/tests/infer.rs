use harnesscope_core::{TraceEvent, infer_findings};

const FIXTURE: &str = include_str!("../../../fixtures/parity/inference.json");

#[test]
fn infers_canonical_observed_behaviors() {
    let events: Vec<TraceEvent> = serde_json::from_str(FIXTURE).unwrap();
    let findings = infer_findings(&events);
    let categories = findings
        .iter()
        .map(|finding| finding.category.as_str())
        .collect::<std::collections::HashSet<_>>();
    for category in [
        "skill_loading",
        "permission_gate",
        "tool_schema",
        "execution_loop",
        "context_management",
        "session_persistence",
    ] {
        assert!(categories.contains(category), "missing {category}");
    }
    let permission = findings
        .iter()
        .find(|finding| finding.category == "permission_gate")
        .unwrap();
    assert_eq!(permission.evidence_event_ids, vec!["03", "04"]);
    assert_eq!(permission.confidence, 0.97);
    let context = findings
        .iter()
        .find(|finding| finding.category == "context_management")
        .unwrap();
    assert_eq!(context.evidence_event_ids, vec!["10", "15"]);
}

#[test]
fn does_not_infer_context_without_explicit_marker() {
    let mut events: Vec<TraceEvent> = serde_json::from_str(FIXTURE).unwrap();
    events.retain(|event| {
        !matches!(
            event.kind.as_str(),
            "ContextMarker" | "CompactionMarker" | "ResumeMarker"
        )
    });
    let findings = infer_findings(&events);
    assert!(
        findings
            .iter()
            .all(|finding| finding.category != "context_management")
    );
}
