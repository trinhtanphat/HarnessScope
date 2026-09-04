function invokeOf(tauri) {
  const invoke = tauri?.core?.invoke;
  if (typeof invoke !== 'function') throw new TypeError('Tauri invoke API is unavailable');
  return invoke.bind(tauri.core);
}

function cancelledImport() {
  return { ok:true, value:{ cancelled:true, imported:0, kinds:[] } };
}

export function createTauriBridge(tauri) {
  const invoke = invokeOf(tauri);
  const call = (command, args = {}) => invoke(command, args);
  const pickFile = (filters = []) => call('dialog_pick_file', { filters });
  const pickDirectory = () => call('dialog_pick_directory');

  const importWithDialog = async (command, sessionId, filters, path = null) => {
    let selected = path;
    if (!selected) {
      const picked = await pickFile(filters);
      if (!picked?.ok) return picked;
      selected = picked.value;
      if (!selected) return cancelledImport();
    }
    return call(command, { sessionId, path:selected });
  };

  return Object.freeze({
    app: Object.freeze({ info: () => call('app_info') }),
    workspace: Object.freeze({ info: () => call('workspace_info') }),
    session: Object.freeze({
      list: () => call('session_list'),
      create: (input) => call('session_create', { input })
    }),
    timeline: Object.freeze({ get: (sessionId) => call('timeline_get', { sessionId }) }),
    inference: Object.freeze({ run: (sessionId) => call('inference_run', { sessionId }) }),
    compare: Object.freeze({ run: (sessionA, sessionB) => call('compare_run', { sessionA, sessionB }) }),
    import: Object.freeze({
      har: (sessionId, path = null) => importWithDialog('import_har', sessionId, [{ name:'HTTP Archive', extensions:['har'] }], path),
      procmon: (sessionId, path = null) => importWithDialog('import_procmon', sessionId, [{ name:'Procmon CSV', extensions:['csv'] }], path),
      jsonl: async (sessionId, path = null, mapPath = null) => {
        let selected = path;
        if (!selected) {
          const picked = await pickFile([{ name:'JSON Lines', extensions:['jsonl','ndjson'] }]);
          if (!picked?.ok) return picked;
          selected = picked.value;
          if (!selected) return cancelledImport();
        }
        let mapping = mapPath;
        if (!mapping) {
          const pickedMap = await pickFile([{ name:'YAML mapping', extensions:['yaml','yml'] }]);
          if (!pickedMap?.ok) return pickedMap;
          mapping = pickedMap.value;
          if (!mapping) return cancelledImport();
        }
        return call('import_jsonl', { sessionId, path:selected, mapPath:mapping });
      }
    }),
    launch: Object.freeze({ run: (sessionId, request) => call('launch_run', { sessionId, request }) }),
    export: Object.freeze({
      run: async (sessionId, outDir = null) => {
        let selected = outDir;
        if (!selected) {
          const picked = await pickDirectory();
          if (!picked?.ok) return picked;
          selected = picked.value;
          if (!selected) return { ok:true, value:{ cancelled:true } };
        }
        return call('export_run', { sessionId, outDir:selected });
      }
    }),
    collector: Object.freeze({
      list: () => call('collector_list'),
      describe: (collectorId) => call('collector_describe', { collectorId }),
      start: (sessionId, request) => call('collector_start', { sessionId, request }),
      stop: (instanceId) => call('collector_stop', { instanceId }),
      status: (instanceId) => call('collector_status', { instanceId })
    }),
    dialog: Object.freeze({
      pickDirectory,
      pickFile
    })
  });
}

export function detectTauriBridge(scope = globalThis) {
  if (typeof scope?.__TAURI__?.core?.invoke !== 'function') return null;
  return createTauriBridge(scope.__TAURI__);
}

const detected = detectTauriBridge();
if (detected) globalThis.harnesscopeTauri = detected;
