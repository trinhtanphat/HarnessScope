use serde_json::{Value, json};
use std::collections::HashSet;
use sysinfo::{Pid, System};

#[derive(Clone, Debug)]
pub(crate) struct ProcessSnapshot {
    pub pid: u32,
    pub parent_pid: Option<u32>,
    pub name: String,
}

fn belongs_to_root(pid: Pid, root: Pid, system: &System) -> bool {
    let mut current = pid;
    for _ in 0..64 {
        if current == root {
            return true;
        }
        let Some(parent) = system.process(current).and_then(|process| process.parent()) else {
            return false;
        };
        current = parent;
    }
    false
}

pub(crate) fn attributable_descendants(root_pid: u32) -> Vec<ProcessSnapshot> {
    let system = System::new_all();
    let root = Pid::from_u32(root_pid);
    system
        .processes()
        .iter()
        .filter_map(|(pid, process)| {
            if *pid == root || !belongs_to_root(*pid, root, &system) {
                return None;
            }
            Some(ProcessSnapshot {
                pid: pid.as_u32(),
                parent_pid: process.parent().map(|parent| parent.as_u32()),
                name: process.name().to_string_lossy().into_owned(),
            })
        })
        .collect()
}

pub(crate) fn descendant_pid_set(root_pid: u32) -> HashSet<u32> {
    attributable_descendants(root_pid)
        .into_iter()
        .map(|snapshot| snapshot.pid)
        .collect()
}

pub(crate) fn started_event(
    pid: u32,
    parent_pid: Option<u32>,
    name: Option<&str>,
    executable: Option<&str>,
    args: Option<&[String]>,
    owned: bool,
) -> Value {
    let mut data = json!({
        "pid": pid,
        "parentPid": parent_pid,
        "owned": owned,
    });
    if let Some(name) = name {
        data["name"] = json!(name);
    }
    if let Some(executable) = executable {
        data["executable"] = json!(executable);
    }
    if let Some(args) = args {
        data["commandLine"] = json!(args);
    }
    json!({
        "source": "collector",
        "kind": "ProcessStarted",
        "correlationId": format!("pid:{pid}"),
        "data": data,
    })
}

pub(crate) fn exited_event(pid: u32, exit_code: Option<i32>, owned: bool) -> Value {
    json!({
        "source": "collector",
        "kind": "ProcessExited",
        "correlationId": format!("pid:{pid}"),
        "data": {
            "pid": pid,
            "exitCode": exit_code,
            "owned": owned,
        },
    })
}
