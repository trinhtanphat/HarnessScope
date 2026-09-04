use crate::{files, first_party_manifests, process};
use crossbeam_channel::{Receiver, RecvTimeoutError, Sender, bounded};
use harnesscope_collector_sdk::{
    COLLECTOR_SDK_VERSION, CollectorCapability, CollectorDiagnostic, CollectorEnvelope,
    CollectorEnvelopeKind, CollectorStartRequest, CollectorStatus, validate_envelope,
    validate_manifest,
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    process::Command,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use thiserror::Error;

const RUNTIME_QUEUE_CAPACITY: usize = 256;
const POLL_INTERVAL: Duration = Duration::from_millis(100);
const SEND_TIMEOUT: Duration = Duration::from_millis(100);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Debug, Error)]
pub enum CollectorRuntimeError {
    #[error("COLLECTOR_NOT_AVAILABLE")]
    NotAvailable,
    #[error("COLLECTOR_PROTOCOL_ERROR: {0}")]
    Protocol(String),
    #[error("COLLECTOR_CAPABILITY_DENIED")]
    CapabilityDenied,
    #[error("COLLECTOR_START_FAILED: {0}")]
    Start(String),
    #[error("COLLECTOR_WATCH_FAILED: {0}")]
    Watch(String),
    #[error("COLLECTOR_BACKPRESSURE")]
    Backpressure,
    #[error("COLLECTOR_STOP_TIMEOUT")]
    StopTimeout,
}

pub struct CollectorHandle {
    receiver: Receiver<CollectorEnvelope>,
    stop_sender: Sender<()>,
    status: Arc<Mutex<CollectorStatus>>,
}

impl CollectorHandle {
    pub fn recv_timeout(
        &self,
        timeout: Duration,
    ) -> Result<CollectorEnvelope, RecvTimeoutError> {
        self.receiver.recv_timeout(timeout)
    }

    pub fn status(&self) -> CollectorStatus {
        *self.status.lock().expect("collector status lock poisoned")
    }

    pub fn stop(&self, timeout: Duration) -> Result<CollectorStatus, CollectorRuntimeError> {
        let current = self.status();
        if matches!(current, CollectorStatus::Stopped | CollectorStatus::Failed) {
            return Ok(current);
        }
        set_status(&self.status, CollectorStatus::Stopping);
        let _ = self.stop_sender.send(());

        let deadline = Instant::now() + timeout;
        loop {
            let status = self.status();
            if matches!(status, CollectorStatus::Stopped | CollectorStatus::Failed) {
                return Ok(status);
            }
            if Instant::now() >= deadline {
                return Err(CollectorRuntimeError::StopTimeout);
            }
            thread::sleep(Duration::from_millis(20));
        }
    }
}

struct Emitter {
    collector_id: String,
    instance_id: String,
    sequence: u64,
    sender: Sender<CollectorEnvelope>,
}

impl Emitter {
    fn send(
        &mut self,
        kind: CollectorEnvelopeKind,
        event: Option<Value>,
        diagnostic: Option<CollectorDiagnostic>,
    ) -> Result<(), CollectorRuntimeError> {
        self.sequence += 1;
        let envelope = CollectorEnvelope {
            sdk_version: COLLECTOR_SDK_VERSION.into(),
            collector_id: self.collector_id.clone(),
            instance_id: self.instance_id.clone(),
            sequence: self.sequence,
            kind,
            event,
            diagnostic,
        };
        let previous = self.sequence.checked_sub(1).filter(|value| *value > 0);
        validate_envelope(previous, &envelope)
            .map_err(|error| CollectorRuntimeError::Protocol(error.to_string()))?;
        self.sender
            .send_timeout(envelope, SEND_TIMEOUT)
            .map_err(|_| CollectorRuntimeError::Backpressure)
    }

    fn event(&mut self, event: Value) -> Result<(), CollectorRuntimeError> {
        self.send(CollectorEnvelopeKind::Event, Some(event), None)
    }

    fn diagnostic(
        &mut self,
        code: &str,
        message: impl Into<String>,
        data: Option<Value>,
    ) -> Result<(), CollectorRuntimeError> {
        self.send(
            CollectorEnvelopeKind::Diagnostic,
            None,
            Some(CollectorDiagnostic {
                code: code.into(),
                message: message.into(),
                data,
            }),
        )
    }

    fn heartbeat(&mut self) -> Result<(), CollectorRuntimeError> {
        self.send(CollectorEnvelopeKind::Heartbeat, None, None)
    }

    fn completed(&mut self) -> Result<(), CollectorRuntimeError> {
        self.send(CollectorEnvelopeKind::Completed, None, None)
    }
}

fn set_status(status: &Arc<Mutex<CollectorStatus>>, value: CollectorStatus) {
    if let Ok(mut guard) = status.lock() {
        *guard = value;
    }
}

fn capability_requested(request: &CollectorStartRequest, capability: CollectorCapability) -> bool {
    request.requested_capabilities.contains(&capability)
}

fn validate_request(request: &CollectorStartRequest) -> Result<(), CollectorRuntimeError> {
    if request.sdk_version != COLLECTOR_SDK_VERSION
        || request.instance_id.trim().is_empty()
        || request.collector_id.trim().is_empty()
    {
        return Err(CollectorRuntimeError::Protocol("invalid start request".into()));
    }

    let manifest = first_party_manifests()
        .into_iter()
        .find(|manifest| manifest.id == request.collector_id)
        .ok_or(CollectorRuntimeError::NotAvailable)?;
    validate_manifest(&manifest)
        .map_err(|error| CollectorRuntimeError::Protocol(error.to_string()))?;

    if request
        .requested_capabilities
        .iter()
        .any(|capability| !manifest.capabilities.contains(capability))
    {
        return Err(CollectorRuntimeError::CapabilityDenied);
    }
    if capability_requested(request, CollectorCapability::FileMetadata) && request.paths.is_empty() {
        return Err(CollectorRuntimeError::Protocol(
            "file metadata collection requires an explicit path".into(),
        ));
    }
    let target = request
        .target
        .as_ref()
        .ok_or_else(|| CollectorRuntimeError::Protocol("target is required".into()))?;
    if target.executable.trim().is_empty() {
        return Err(CollectorRuntimeError::Protocol(
            "target executable is required".into(),
        ));
    }
    Ok(())
}

pub fn spawn_first_party(
    request: CollectorStartRequest,
) -> Result<CollectorHandle, CollectorRuntimeError> {
    validate_request(&request)?;
    let (output_sender, receiver) = bounded(RUNTIME_QUEUE_CAPACITY);
    let (stop_sender, stop_receiver) = bounded(1);
    let status = Arc::new(Mutex::new(CollectorStatus::Starting));
    let thread_status = Arc::clone(&status);

    thread::spawn(move || {
        if run_collector(request, output_sender, stop_receiver, &thread_status).is_err() {
            set_status(&thread_status, CollectorStatus::Failed);
        }
    });

    Ok(CollectorHandle {
        receiver,
        stop_sender,
        status,
    })
}

fn drain_file_events(
    watcher: &files::FileWatcher,
    emitter: &mut Emitter,
) -> Result<(), CollectorRuntimeError> {
    for result in watcher.receiver.try_iter() {
        match result {
            Ok(event) => {
                for value in files::map_event(&event, &watcher.roots, watcher.hash_files) {
                    emitter.event(value)?;
                }
            }
            Err(error) => emitter.diagnostic(
                "COLLECTOR_FILE_VISIBILITY",
                error.to_string(),
                None,
            )?,
        }
    }
    Ok(())
}

fn drain_file_events_for(
    watcher: &files::FileWatcher,
    emitter: &mut Emitter,
    duration: Duration,
) -> Result<(), CollectorRuntimeError> {
    let deadline = Instant::now() + duration;
    while Instant::now() < deadline {
        drain_file_events(watcher, emitter)?;
        thread::sleep(Duration::from_millis(25));
    }
    drain_file_events(watcher, emitter)
}

fn run_collector(
    request: CollectorStartRequest,
    output_sender: Sender<CollectorEnvelope>,
    stop_receiver: Receiver<()>,
    status: &Arc<Mutex<CollectorStatus>>,
) -> Result<(), CollectorRuntimeError> {
    let collect_files = capability_requested(&request, CollectorCapability::FileMetadata);
    let collect_process = capability_requested(&request, CollectorCapability::ProcessLifecycle)
        || capability_requested(&request, CollectorCapability::ProcessMetadata);

    let watcher = files::watch_selected_paths(
        if collect_files { &request.paths } else { &[] },
        request.hash_files,
    )
    .map_err(CollectorRuntimeError::Watch)?;

    let target = request
        .target
        .as_ref()
        .expect("validated collector request target");
    let mut command = Command::new(&target.executable);
    command.args(&target.args);
    if let Some(cwd) = &target.cwd {
        command.current_dir(cwd);
    }
    let mut child = command
        .spawn()
        .map_err(|error| CollectorRuntimeError::Start(error.to_string()))?;
    let root_pid = child.id();

    let mut emitter = Emitter {
        collector_id: request.collector_id.clone(),
        instance_id: request.instance_id.clone(),
        sequence: 0,
        sender: output_sender,
    };
    set_status(status, CollectorStatus::Running);

    if collect_process {
        let command_line = std::iter::once(target.executable.clone())
            .chain(target.args.iter().cloned())
            .collect::<Vec<_>>();
        emitter.event(process::started_event(
            root_pid,
            None,
            None,
            Some(&target.executable),
            Some(&command_line),
            true,
        ))?;
    }

    let mut observed = HashMap::<u32, process::ProcessSnapshot>::new();
    let mut last_heartbeat = Instant::now();

    loop {
        if stop_receiver.try_recv().is_ok() {
            set_status(status, CollectorStatus::Stopping);
            let _ = child.kill();
            let exit_code = child.wait().ok().and_then(|value| value.code());
            if collect_process {
                for pid in observed.keys().copied().collect::<Vec<_>>() {
                    emitter.event(process::exited_event(pid, None, false))?;
                }
                emitter.event(process::exited_event(root_pid, exit_code, true))?;
            }
            if collect_files {
                drain_file_events_for(&watcher, &mut emitter, Duration::from_millis(100))?;
            }
            emitter.completed()?;
            set_status(status, CollectorStatus::Stopped);
            return Ok(());
        }

        if collect_files {
            drain_file_events(&watcher, &mut emitter)?;
        }

        if collect_process {
            let snapshots = process::attributable_descendants(root_pid);
            let current = snapshots
                .into_iter()
                .map(|snapshot| (snapshot.pid, snapshot))
                .collect::<HashMap<_, _>>();

            for (pid, snapshot) in &current {
                if !observed.contains_key(pid) {
                    emitter.event(process::started_event(
                        *pid,
                        snapshot.parent_pid,
                        Some(&snapshot.name),
                        None,
                        None,
                        false,
                    ))?;
                }
            }
            for pid in observed.keys() {
                if !current.contains_key(pid) {
                    emitter.event(process::exited_event(*pid, None, false))?;
                }
            }
            observed = current;
        }

        match child.try_wait() {
            Ok(Some(exit)) => {
                if collect_process {
                    for pid in observed.keys().copied().collect::<Vec<_>>() {
                        emitter.event(process::exited_event(pid, None, false))?;
                    }
                    emitter.event(process::exited_event(root_pid, exit.code(), true))?;
                }
                if collect_files {
                    drain_file_events_for(&watcher, &mut emitter, Duration::from_millis(250))?;
                }
                emitter.completed()?;
                set_status(status, CollectorStatus::Stopped);
                return Ok(());
            }
            Ok(None) => {}
            Err(error) => {
                emitter.diagnostic(
                    "COLLECTOR_PROCESS_VISIBILITY",
                    error.to_string(),
                    Some(json!({ "pid": root_pid })),
                )?;
            }
        }

        if last_heartbeat.elapsed() >= HEARTBEAT_INTERVAL {
            emitter.heartbeat()?;
            last_heartbeat = Instant::now();
        }
        thread::sleep(POLL_INTERVAL);
    }
}
