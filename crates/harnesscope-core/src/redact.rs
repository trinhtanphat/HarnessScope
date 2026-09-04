use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::sync::OnceLock;
use url::Url;

const REDACTED: &str = "[REDACTED]";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RedactionResult {
    pub value: Value,
    pub redacted: bool,
}

fn sensitive_key() -> &'static Regex {
    static VALUE: OnceLock<Regex> = OnceLock::new();
    VALUE.get_or_init(|| {
        Regex::new(
            r"(?i)(authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|passwd|private[-_]?key|client[-_]?secret)",
        )
        .expect("sensitive-key regex must compile")
    })
}

fn token_patterns() -> &'static [Regex; 2] {
    static VALUE: OnceLock<[Regex; 2]> = OnceLock::new();
    VALUE.get_or_init(|| {
        [
            Regex::new(r"\b(?:sk|sk-ant|ghp|github_pat|xox[baprs]|AIza)[-_A-Za-z0-9]{16,}\b")
                .expect("provider-token regex must compile"),
            Regex::new(r"(?i)\bBearer\s+[A-Za-z0-9._~+/\-]+=*\b")
                .expect("bearer-token regex must compile"),
        ]
    })
}

fn redact_string(input: &str) -> RedactionResult {
    let mut value = input.to_owned();
    let mut changed = false;

    for pattern in token_patterns() {
        if pattern.is_match(&value) {
            value = pattern.replace_all(&value, REDACTED).into_owned();
            changed = true;
        }
    }

    if let Ok(mut url) = Url::parse(&value) {
        let sensitive_params: Vec<String> = url
            .query_pairs()
            .filter_map(|(key, _)| sensitive_key().is_match(&key).then(|| key.into_owned()))
            .collect();
        if !sensitive_params.is_empty() {
            let mut pairs: Vec<(String, String)> = url
                .query_pairs()
                .map(|(key, value)| (key.into_owned(), value.into_owned()))
                .collect();
            for (key, pair_value) in &mut pairs {
                if sensitive_params.iter().any(|sensitive| sensitive == key) {
                    *pair_value = REDACTED.to_owned();
                    changed = true;
                }
            }
            url.query_pairs_mut().clear().extend_pairs(pairs);
        }
        if changed {
            value = url.to_string();
        }
    }

    RedactionResult {
        value: Value::String(value),
        redacted: changed,
    }
}

pub fn redact_value(input: &Value, key_hint: &str) -> RedactionResult {
    if sensitive_key().is_match(key_hint) {
        return RedactionResult {
            value: Value::String(REDACTED.to_owned()),
            redacted: true,
        };
    }

    match input {
        Value::Null | Value::Bool(_) | Value::Number(_) => RedactionResult {
            value: input.clone(),
            redacted: false,
        },
        Value::String(value) => redact_string(value),
        Value::Array(items) => {
            let mut redacted = false;
            let value = items
                .iter()
                .map(|item| {
                    let result = redact_value(item, "");
                    redacted |= result.redacted;
                    result.value
                })
                .collect();
            RedactionResult {
                value: Value::Array(value),
                redacted,
            }
        }
        Value::Object(items) => {
            let mut redacted = false;
            let mut value = Map::new();
            for (key, item) in items {
                let result = redact_value(item, key);
                redacted |= result.redacted;
                value.insert(key.clone(), result.value);
            }
            RedactionResult {
                value: Value::Object(value),
                redacted,
            }
        }
    }
}
