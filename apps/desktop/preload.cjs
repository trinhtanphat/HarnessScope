'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = Object.freeze({
  APP_INFO: 'hs:v1:app:info',
  WORKSPACE_INFO: 'hs:v1:workspace:info',
  SESSION_LIST: 'hs:v1:session:list',
  SESSION_CREATE: 'hs:v1:session:create',
  TIMELINE_GET: 'hs:v1:timeline:get',
  INFERENCE_RUN: 'hs:v1:inference:run',
  COMPARE_RUN: 'hs:v1:compare:run',
  IMPORT_HAR: 'hs:v1:import:har',
  IMPORT_PROCMON: 'hs:v1:import:procmon',
  IMPORT_JSONL: 'hs:v1:import:jsonl',
  LAUNCH_RUN: 'hs:v1:launch:run',
  EXPORT_RUN: 'hs:v1:export:run',
  DIALOG_PICK_DIRECTORY: 'hs:v1:dialog:pick-directory',
  DIALOG_PICK_FILE: 'hs:v1:dialog:pick-file'
});

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const api = Object.freeze({
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

contextBridge.exposeInMainWorld('harnesscope', api);
