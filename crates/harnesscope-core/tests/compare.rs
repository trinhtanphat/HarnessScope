use harnesscope_core::{SessionSnapshot, compare_sessions};
use serde::Deserialize;

#[derive(Deserialize)]
struct Fixture {
    a: SessionSnapshot,
    b: SessionSnapshot,
}

const FIXTURE: &str = include_str!("../../../fixtures/parity/compare.json");

#[test]
fn compares_observable_session_capabilities() {
    let fixture: Fixture = serde_json::from_str(FIXTURE).unwrap();
    let diff = compare_sessions(&fixture.a, &fixture.b);
    assert_eq!(diff.shared_tool_names, vec!["read"]);
    assert_eq!(
        diff.only_a_event_kinds,
        vec!["PermissionDecision", "PermissionPrompt"]
    );
    assert_eq!(diff.only_b_event_kinds, vec!["ResumeMarker", "SkillRead"]);
    assert_eq!(diff.only_b_finding_categories, vec!["session_persistence"]);
}
