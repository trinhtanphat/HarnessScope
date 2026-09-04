use harnesscope_core::{
    SessionSnapshot, TraceEvent, compare_sessions, infer_findings, redact_value,
};
use serde::Deserialize;
use serde_json::Value;
use std::{env, fs, process::ExitCode};

#[derive(Deserialize)]
struct CompareFixture {
    a: SessionSnapshot,
    b: SessionSnapshot,
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let case = args.next().ok_or("missing parity case")?;
    let fixture = args.next().ok_or("missing fixture path")?;
    if args.next().is_some() {
        return Err("too many arguments".into());
    }

    match case.as_str() {
        "model-roundtrip" => {
            let text = fs::read_to_string(fixture)?;
            let snapshot: SessionSnapshot = serde_json::from_str(&text)?;
            println!("{}", serde_json::to_string(&snapshot)?);
            Ok(())
        }
        "redaction" => {
            let text = fs::read_to_string(fixture)?;
            let items: Vec<Value> = serde_json::from_str(&text)?;
            let output = items
                .iter()
                .map(|item| {
                    let value = item.get("value").unwrap_or(&Value::Null);
                    let key_hint = item.get("keyHint").and_then(Value::as_str).unwrap_or("");
                    redact_value(value, key_hint)
                })
                .collect::<Vec<_>>();
            println!("{}", serde_json::to_string(&output)?);
            Ok(())
        }
        "inference" => {
            let text = fs::read_to_string(fixture)?;
            let events: Vec<TraceEvent> = serde_json::from_str(&text)?;
            println!("{}", serde_json::to_string(&infer_findings(&events))?);
            Ok(())
        }
        "compare" => {
            let text = fs::read_to_string(fixture)?;
            let fixture: CompareFixture = serde_json::from_str(&text)?;
            println!(
                "{}",
                serde_json::to_string(&compare_sessions(&fixture.a, &fixture.b))?
            );
            Ok(())
        }
        _ => Err(format!("unsupported parity case: {case}").into()),
    }
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::from(2)
        }
    }
}
