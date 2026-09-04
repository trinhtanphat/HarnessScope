use crate::{Finding, TraceEvent};
use serde_json::Value;
use std::collections::HashSet;

fn finding(
    title: String,
    category: &str,
    confidence: f64,
    events: &[&TraceEvent],
    statement: String,
) -> Finding {
    Finding {
        id: None,
        session_id: None,
        title,
        category: category.to_string(),
        confidence,
        statement,
        evidence_event_ids: events
            .iter()
            .filter_map(|event| (!event.id.is_empty()).then(|| event.id.clone()))
            .collect(),
    }
}

fn path_of(event: &TraceEvent) -> Option<&str> {
    event
        .data
        .get("path")
        .or_else(|| event.data.get("file"))
        .and_then(Value::as_str)
}

fn data_string<'a>(event: &'a TraceEvent, key: &str) -> Option<&'a str> {
    event.data.get(key).and_then(Value::as_str)
}

pub fn infer_findings(events: &[TraceEvent]) -> Vec<Finding> {
    let mut ordered = events.iter().collect::<Vec<_>>();
    ordered.sort_by(|a, b| a.timestamp_utc.cmp(&b.timestamp_utc));
    let mut findings = Vec::new();

    let first_action = ordered
        .iter()
        .position(|event| matches!(event.kind.as_str(), "ToolCall" | "FileWritten"));
    let skill_reads = ordered
        .iter()
        .enumerate()
        .filter(|(index, event)| {
            matches!(event.kind.as_str(), "SkillRead" | "InstructionRead")
                && first_action.is_none_or(|first| *index <= first)
        })
        .map(|(_, event)| *event)
        .collect::<Vec<_>>();
    if !skill_reads.is_empty() {
        let paths = skill_reads
            .iter()
            .filter_map(|event| path_of(event))
            .collect::<Vec<_>>();
        let suffix = if paths.is_empty() {
            String::new()
        } else {
            format!(": {}", paths.join(", "))
        };
        findings.push(finding(
            "Progressive instruction/skill loading".to_string(),
            "skill_loading",
            0.92,
            &skill_reads,
            format!(
                "Observed {} instruction/skill read(s) before the first execution action{}.",
                skill_reads.len(),
                suffix
            ),
        ));
    }

    for prompt in ordered
        .iter()
        .copied()
        .filter(|event| event.kind == "PermissionPrompt")
    {
        let correlation = prompt
            .correlation_id
            .as_deref()
            .filter(|value| !value.is_empty());
        let decision = correlation.and_then(|value| {
            ordered.iter().copied().find(|event| {
                event.kind == "PermissionDecision" && event.correlation_id.as_deref() == Some(value)
            })
        });
        if let Some(decision) = decision {
            let title = correlation
                .map(|value| format!("Permission gate {value}"))
                .unwrap_or_else(|| "Permission gate".to_string());
            let decision_value = data_string(decision, "decision").unwrap_or("unknown");
            findings.push(finding(
                title,
                "permission_gate",
                0.97,
                &[prompt, decision],
                format!(
                    "Observed an action permission prompt followed by decision '{decision_value}' before continuing."
                ),
            ));
        }
    }

    let tool_calls = ordered
        .iter()
        .copied()
        .filter(|event| {
            event.kind == "ToolCall"
                && data_string(event, "name").is_some_and(|name| !name.is_empty())
        })
        .collect::<Vec<_>>();
    let mut groups: Vec<(String, Vec<&TraceEvent>)> = Vec::new();
    for call in &tool_calls {
        let name = data_string(call, "name").expect("filtered tool name");
        if let Some((_, calls)) = groups.iter_mut().find(|(existing, _)| existing == name) {
            calls.push(*call);
        } else {
            groups.push((name.to_string(), vec![*call]));
        }
    }
    for (name, calls) in groups {
        let mut keys = calls
            .iter()
            .flat_map(|event| {
                event
                    .data
                    .get("args")
                    .and_then(Value::as_object)
                    .into_iter()
                    .flat_map(|args| args.keys().cloned())
            })
            .collect::<Vec<_>>();
        keys.sort();
        keys.dedup();
        let key_text = if keys.is_empty() {
            "(none observed)".to_string()
        } else {
            keys.join(", ")
        };
        findings.push(finding(
            format!("Observed tool schema: {name}"),
            "tool_schema",
            (0.82 + calls.len() as f64 * 0.03).min(0.99),
            &calls,
            format!("Observed tool '{name}' with argument key(s): {key_text}."),
        ));
    }

    let result_correlations = ordered
        .iter()
        .filter(|event| event.kind == "ToolResult")
        .filter_map(|event| event.correlation_id.as_deref())
        .filter(|value| !value.is_empty())
        .collect::<HashSet<_>>();
    let paired_calls = tool_calls
        .iter()
        .copied()
        .filter(|event| {
            event
                .correlation_id
                .as_deref()
                .filter(|value| !value.is_empty())
                .is_some_and(|value| result_correlations.contains(value))
        })
        .collect::<Vec<_>>();
    let mutation_events = ordered
        .iter()
        .copied()
        .filter(|event| matches!(event.kind.as_str(), "FileWritten" | "FileRenamed"))
        .collect::<Vec<_>>();
    if paired_calls.len() >= 2 && !mutation_events.is_empty() {
        let paired_correlations = paired_calls
            .iter()
            .filter_map(|event| event.correlation_id.as_deref())
            .collect::<HashSet<_>>();
        let mut evidence = paired_calls.iter().take(3).copied().collect::<Vec<_>>();
        evidence.extend(mutation_events.iter().take(3).copied());
        evidence.extend(
            ordered
                .iter()
                .copied()
                .filter(|event| {
                    event.kind == "ToolResult"
                        && event
                            .correlation_id
                            .as_deref()
                            .is_some_and(|value| paired_correlations.contains(value))
                })
                .take(3),
        );
        findings.push(finding(
            "Inspect / mutate / execute / verify loop".to_string(),
            "execution_loop",
            0.88,
            &evidence,
            format!(
                "Observed {} correlated tool call/result pair(s) alongside {} mutation event(s), consistent with an execution-and-verification loop.",
                paired_calls.len(),
                mutation_events.len()
            ),
        ));
    }

    let context = ordered
        .iter()
        .copied()
        .filter(|event| {
            matches!(
                event.kind.as_str(),
                "ContextMarker" | "CompactionMarker" | "ResumeMarker"
            )
        })
        .collect::<Vec<_>>();
    if !context.is_empty() {
        let mut kinds = Vec::new();
        for event in &context {
            if !kinds.contains(&event.kind.as_str()) {
                kinds.push(event.kind.as_str());
            }
        }
        findings.push(finding(
            "Visible context/session management".to_string(),
            "context_management",
            0.96,
            &context,
            format!(
                "Observed explicit context/session marker(s): {}. No private token counts are inferred.",
                kinds.join(", ")
            ),
        ));
    }

    if let Some(exit_index) = ordered
        .iter()
        .position(|event| event.kind == "ProcessExited")
    {
        let written_before_exit = ordered[..exit_index]
            .iter()
            .copied()
            .filter(|event| event.kind == "FileWritten" && path_of(event).is_some())
            .collect::<Vec<_>>();
        let started_after = ordered
            .iter()
            .enumerate()
            .find(|(index, event)| *index > exit_index && event.kind == "ProcessStarted")
            .map(|(index, _)| index);
        if let Some(started_index) = started_after {
            for write in written_before_exit {
                if let Some(read) = ordered[started_index + 1..]
                    .iter()
                    .copied()
                    .find(|event| event.kind == "FileRead" && path_of(event) == path_of(write))
                {
                    findings.push(finding(
                        "Session state persisted across restart".to_string(),
                        "session_persistence",
                        0.94,
                        &[write, ordered[exit_index], ordered[started_index], read],
                        format!(
                            "Observed '{}' written before process exit and read after a subsequent process start.",
                            path_of(write).unwrap_or("")
                        ),
                    ));
                    break;
                }
            }
        }
    }

    findings.sort_by(|a, b| {
        b.confidence
            .total_cmp(&a.confidence)
            .then_with(|| a.title.cmp(&b.title))
    });
    findings
}
