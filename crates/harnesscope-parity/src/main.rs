use harnesscope_core::SessionSnapshot;
use std::{env, fs, process::ExitCode};

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
