use harnesscope_collector_sdk::{CollectorEnvelopeKind, CollectorStartRequest, CollectorStatus};
use harnesscope_collectors::{first_party_manifests, spawn_first_party};
use serde_json::Value;
use std::{
    io::{self, BufRead, Write},
    sync::Arc,
    thread,
    time::Duration,
};

fn write_json_line<T: serde::Serialize>(
    value: &T,
) -> Result<(), Box<dyn std::error::Error>> {
    let stdout = io::stdout();
    let mut lock = stdout.lock();
    serde_json::to_writer(&mut lock, value)?;
    lock.write_all(b"\n")?;
    lock.flush()?;
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let mut first_line = String::new();
    if input.read_line(&mut first_line)? == 0 {
        return Err("COLLECTOR_PROTOCOL_ERROR: missing start request".into());
    }
    if first_line.len() > harnesscope_collector_sdk::MAX_ENVELOPE_BYTES {
        return Err("COLLECTOR_PROTOCOL_ERROR: oversized start request".into());
    }
    let request: CollectorStartRequest = serde_json::from_str(first_line.trim_end())?;
    let manifest = first_party_manifests()
        .into_iter()
        .find(|manifest| manifest.id == request.collector_id)
        .ok_or("COLLECTOR_NOT_AVAILABLE")?;
    write_json_line(&manifest)?;

    let handle = Arc::new(spawn_first_party(request)?);
    let output_handle = Arc::clone(&handle);
    let output_thread = thread::spawn(move || -> Result<(), String> {
        loop {
            match output_handle.recv_timeout(Duration::from_millis(250)) {
                Ok(envelope) => {
                    let terminal = envelope.kind == CollectorEnvelopeKind::Completed;
                    write_json_line(&envelope).map_err(|error| error.to_string())?;
                    if terminal {
                        return Ok(());
                    }
                }
                Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                    if output_handle.status() == CollectorStatus::Failed {
                        return Err("COLLECTOR_RUNTIME_FAILED".into());
                    }
                }
                Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                    return Err("COLLECTOR_RUNTIME_FAILED".into());
                }
            }
        }
    });

    let mut control_line = String::new();
    loop {
        control_line.clear();
        if input.read_line(&mut control_line)? == 0 {
            let _ = handle.stop(Duration::from_secs(3));
            break;
        }
        if control_line.len() > harnesscope_collector_sdk::MAX_ENVELOPE_BYTES {
            let _ = handle.stop(Duration::from_secs(3));
            return Err("COLLECTOR_PROTOCOL_ERROR: oversized control line".into());
        }
        let value: Value = match serde_json::from_str(control_line.trim_end()) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if value.get("kind").and_then(Value::as_str) == Some("stop") {
            handle.stop(Duration::from_secs(3))?;
            break;
        }
    }

    let output_result = output_thread
        .join()
        .map_err(|_| io::Error::other("COLLECTOR_RUNTIME_FAILED: output thread panicked"))?;
    output_result.map_err(io::Error::other)?;

    match handle.status() {
        CollectorStatus::Stopped => Ok(()),
        CollectorStatus::Failed => Err("COLLECTOR_RUNTIME_FAILED".into()),
        _ => Ok(()),
    }
}
