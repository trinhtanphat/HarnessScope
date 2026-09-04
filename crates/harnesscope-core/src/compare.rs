use crate::{CompareResult, SessionSnapshot};
use std::collections::BTreeSet;

fn sorted_set(values: impl IntoIterator<Item = String>) -> Vec<String> {
    values
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn difference(a: &[String], b: &[String]) -> Vec<String> {
    let b = b.iter().collect::<BTreeSet<_>>();
    a.iter()
        .filter(|value| !b.contains(value))
        .cloned()
        .collect()
}

pub fn compare_sessions(a: &SessionSnapshot, b: &SessionSnapshot) -> CompareResult {
    let a_kinds = sorted_set(a.events.iter().map(|event| event.kind.clone()));
    let b_kinds = sorted_set(b.events.iter().map(|event| event.kind.clone()));
    let a_tools = sorted_set(
        a.events
            .iter()
            .filter(|event| event.kind == "ToolCall")
            .filter_map(|event| event.data.get("name").and_then(|value| value.as_str()))
            .map(str::to_string),
    );
    let b_tools = sorted_set(
        b.events
            .iter()
            .filter(|event| event.kind == "ToolCall")
            .filter_map(|event| event.data.get("name").and_then(|value| value.as_str()))
            .map(str::to_string),
    );
    let a_findings = sorted_set(a.findings.iter().map(|finding| finding.category.clone()));
    let b_findings = sorted_set(b.findings.iter().map(|finding| finding.category.clone()));

    CompareResult {
        session_a: Some(a.session.clone()),
        session_b: Some(b.session.clone()),
        shared_event_kinds: a_kinds
            .iter()
            .filter(|value| b_kinds.contains(value))
            .cloned()
            .collect(),
        only_a_event_kinds: difference(&a_kinds, &b_kinds),
        only_b_event_kinds: difference(&b_kinds, &a_kinds),
        shared_tool_names: a_tools
            .iter()
            .filter(|value| b_tools.contains(value))
            .cloned()
            .collect(),
        only_a_tool_names: difference(&a_tools, &b_tools),
        only_b_tool_names: difference(&b_tools, &a_tools),
        shared_finding_categories: a_findings
            .iter()
            .filter(|value| b_findings.contains(value))
            .cloned()
            .collect(),
        only_a_finding_categories: difference(&a_findings, &b_findings),
        only_b_finding_categories: difference(&b_findings, &a_findings),
    }
}
