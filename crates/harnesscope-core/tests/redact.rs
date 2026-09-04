use harnesscope_core::redact_value;
use serde_json::json;

#[test]
fn redacts_sensitive_keys_tokens_and_query_values() {
    let input = json!({
        "Authorization": "Bearer should-never-survive-123456",
        "nested": { "api_key": "sk_ABCDEFGHIJKLMNOPQRSTUVWX", "safe": "ok" },
        "cookie": "session=secret-cookie",
        "url": "https://example.test/path?token=secret-query&x=1"
    });
    let result = redact_value(&input, "");
    assert!(result.redacted);
    assert_eq!(result.value["Authorization"], "[REDACTED]");
    assert_eq!(result.value["nested"]["api_key"], "[REDACTED]");
    assert_eq!(result.value["nested"]["safe"], "ok");
    assert_eq!(result.value["cookie"], "[REDACTED]");
    let text = serde_json::to_string(&result).unwrap();
    for sentinel in [
        "should-never-survive",
        "ABCDEFGHIJKLMNOPQRSTUVWX",
        "secret-cookie",
        "secret-query",
    ] {
        assert!(!text.contains(sentinel), "secret leaked: {sentinel}");
    }
}

#[test]
fn redacts_token_like_strings_in_arrays_and_sensitive_key_hints() {
    let array = json!([
        "safe",
        "ghp_abcdefghijklmnopqrstuvwxyz1234567890",
        "Bearer abcdefghijklmnopqrstuvwxyz.123456"
    ]);
    let result = redact_value(&array, "");
    assert_eq!(result.value, json!(["safe", "[REDACTED]", "[REDACTED]"]));
    assert!(result.redacted);

    let hinted = redact_value(&json!("plain-secret-value"), "client_secret");
    assert_eq!(hinted.value, json!("[REDACTED]"));
    assert!(hinted.redacted);
}
