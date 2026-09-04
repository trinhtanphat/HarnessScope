import { CHANNELS } from './channels.mjs';
import { safeResult } from './errors.mjs';

export function registerIpcHandlers({ ipcMain, services }) {
  const handlers = new Map([
    [CHANNELS.APP_INFO, () => services.appInfo()],
    [CHANNELS.WORKSPACE_INFO, () => services.workspaceInfo()],
    [CHANNELS.SESSION_LIST, () => services.sessionList()],
    [CHANNELS.SESSION_CREATE, (input) => services.sessionCreate(input)],
    [CHANNELS.TIMELINE_GET, (sessionId) => services.timelineGet(sessionId)],
    [CHANNELS.INFERENCE_RUN, (sessionId) => services.inferenceRun(sessionId)],
    [CHANNELS.COMPARE_RUN, (a, b) => services.compareRun(a, b)],
    [CHANNELS.IMPORT_HAR, (sessionId) => services.importHar(sessionId)],
    [CHANNELS.IMPORT_PROCMON, (sessionId) => services.importProcmon(sessionId)],
    [CHANNELS.IMPORT_JSONL, (sessionId) => services.importJsonl(sessionId)],
    [CHANNELS.LAUNCH_RUN, (sessionId, request) => services.launchRun(sessionId, request)],
    [CHANNELS.EXPORT_RUN, (sessionId) => services.exportRun(sessionId)],
    [CHANNELS.DIALOG_PICK_DIRECTORY, () => services.pickDirectory()],
    [CHANNELS.DIALOG_PICK_FILE, (filters) => services.pickFile(filters)]
  ]);

  for (const [channel, action] of handlers) {
    ipcMain.handle(channel, (_event, ...args) => safeResult(() => action(...args)));
  }
  return [...handlers.keys()];
}
