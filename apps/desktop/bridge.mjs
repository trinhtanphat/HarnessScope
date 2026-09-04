import { CHANNELS } from './channels.mjs';

export function createBridge(invoke) {
  if (typeof invoke !== 'function') throw new TypeError('invoke must be a function');
  return Object.freeze({
    app: Object.freeze({ info: () => invoke(CHANNELS.APP_INFO) }),
    workspace: Object.freeze({ info: () => invoke(CHANNELS.WORKSPACE_INFO) }),
    session: Object.freeze({
      list: () => invoke(CHANNELS.SESSION_LIST),
      create: (input) => invoke(CHANNELS.SESSION_CREATE, input)
    }),
    timeline: Object.freeze({ get: (sessionId) => invoke(CHANNELS.TIMELINE_GET, sessionId) }),
    inference: Object.freeze({ run: (sessionId) => invoke(CHANNELS.INFERENCE_RUN, sessionId) }),
    compare: Object.freeze({ run: (sessionA, sessionB) => invoke(CHANNELS.COMPARE_RUN, sessionA, sessionB) }),
    import: Object.freeze({
      har: (sessionId) => invoke(CHANNELS.IMPORT_HAR, sessionId),
      procmon: (sessionId) => invoke(CHANNELS.IMPORT_PROCMON, sessionId),
      jsonl: (sessionId) => invoke(CHANNELS.IMPORT_JSONL, sessionId)
    }),
    launch: Object.freeze({ run: (sessionId, request) => invoke(CHANNELS.LAUNCH_RUN, sessionId, request) }),
    export: Object.freeze({ run: (sessionId) => invoke(CHANNELS.EXPORT_RUN, sessionId) }),
    dialog: Object.freeze({
      pickDirectory: () => invoke(CHANNELS.DIALOG_PICK_DIRECTORY),
      pickFile: (filters) => invoke(CHANNELS.DIALOG_PICK_FILE, filters)
    })
  });
}
