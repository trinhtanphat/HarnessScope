class DataClientError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DataClientError';
    this.code = code;
  }
}

function unwrap(envelope) {
  if (!envelope || typeof envelope !== 'object' || typeof envelope.ok !== 'boolean') {
    throw new DataClientError('INVALID_DESKTOP_RESPONSE', 'The desktop bridge returned an invalid response.');
  }
  if (!envelope.ok) {
    throw new DataClientError(
      typeof envelope.code === 'string' ? envelope.code : 'DESKTOP_OPERATION_FAILED',
      typeof envelope.message === 'string' ? envelope.message : 'The desktop operation could not be completed.'
    );
  }
  return envelope.value;
}

function desktopOnly() {
  throw new DataClientError('DESKTOP_ONLY', 'This action is available in HarnessScope Desktop.');
}

async function request(fetchImpl, path, options) {
  if (typeof fetchImpl !== 'function') throw new DataClientError('HTTP_UNAVAILABLE', 'Browser API access is unavailable.');
  const response = await fetchImpl(path, options);
  let data;
  try { data = await response.json(); }
  catch { data = null; }
  if (!response.ok) {
    throw new DataClientError('HTTP_ERROR', data?.error || `Request failed with HTTP ${response.status}.`);
  }
  return data;
}

function detectedBridge() {
  return globalThis.harnesscopeTauri ?? globalThis.harnesscope ?? null;
}

export function createDataClient({ bridge = undefined, fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
  const selectedBridge = bridge == null ? detectedBridge() : bridge;
  const desktop = !!selectedBridge;
  const mode = desktop ? 'desktop' : 'browser';
  const invoke = async (fn) => unwrap(await fn());
  const native = (fn) => desktop ? fn : async () => desktopOnly();

  return Object.freeze({
    mode,
    appInfo: desktop
      ? () => invoke(() => selectedBridge.app.info())
      : async () => ({ name: 'HarnessScope', version: null, platform: 'browser' }),
    listSessions: desktop
      ? () => invoke(() => selectedBridge.session.list())
      : () => request(fetchImpl, '/api/sessions'),
    createSession: native((input) => invoke(() => selectedBridge.session.create(input))),
    getTimeline: desktop
      ? (sessionId) => invoke(() => selectedBridge.timeline.get(sessionId))
      : (sessionId) => request(fetchImpl, `/api/session/${encodeURIComponent(sessionId)}`),
    runInference: desktop
      ? (sessionId) => invoke(() => selectedBridge.inference.run(sessionId))
      : (sessionId) => request(fetchImpl, `/api/session/${encodeURIComponent(sessionId)}/infer`, { method: 'POST' }),
    runCompare: native((sessionA, sessionB) => invoke(() => selectedBridge.compare.run(sessionA, sessionB))),
    importEvidence: native((type, sessionId) => {
      const operation = selectedBridge.import?.[type];
      if (!['har', 'procmon', 'jsonl'].includes(type) || typeof operation !== 'function') {
        throw new DataClientError('INVALID_IMPORT_TYPE', 'Choose HAR, Procmon CSV, or JSONL evidence.');
      }
      return invoke(() => operation(sessionId));
    }),
    launch: native((sessionId, requestValue) => invoke(() => selectedBridge.launch.run(sessionId, requestValue))),
    exportSession: native((sessionId) => invoke(() => selectedBridge.export.run(sessionId))),
    collector: Object.freeze({
      list: native(() => invoke(() => selectedBridge.collector.list())),
      describe: native((collectorId) => invoke(() => selectedBridge.collector.describe(collectorId))),
      start: native((sessionId, requestValue) => invoke(() => selectedBridge.collector.start(sessionId, requestValue))),
      stop: native((instanceId) => invoke(() => selectedBridge.collector.stop(instanceId))),
      status: native((instanceId) => invoke(() => selectedBridge.collector.status(instanceId)))
    })
  });
}
