export const SDK_VERSION = '1';
export const MAX_ENVELOPE_BYTES = 262_144;

const COLLECTOR_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*){2,}$/;
const CAPABILITIES = new Set([
  'process.lifecycle',
  'process.metadata',
  'file.metadata',
  'collector.diagnostics',
]);

function protocolError() {
  const error = new Error('COLLECTOR_PROTOCOL_ERROR');
  error.code = 'COLLECTOR_PROTOCOL_ERROR';
  return error;
}

function sequenceError() {
  const error = new Error('COLLECTOR_SEQUENCE_ERROR');
  error.code = 'COLLECTOR_SEQUENCE_ERROR';
  return error;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validCollectorId(value) {
  return typeof value === 'string' && COLLECTOR_ID.test(value);
}

function encodedBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    throw protocolError();
  }
}

export function validateManifest(value) {
  if (!isRecord(value)
    || value.sdkVersion !== SDK_VERSION
    || !validCollectorId(value.id)
    || typeof value.name !== 'string' || !value.name.trim()
    || typeof value.version !== 'string' || !value.version.trim()
    || !Array.isArray(value.platforms) || value.platforms.length === 0
    || !Array.isArray(value.capabilities)
    || value.capabilities.some((capability) => !CAPABILITIES.has(capability))
    || typeof value.requiresExplicitPaths !== 'boolean'
    || typeof value.requiresTargetLaunch !== 'boolean'
    || value.contentCapture !== 'unsupported') {
    throw protocolError();
  }
  return value;
}

export function validateEnvelope(value, previousSequence = null) {
  if (!isRecord(value)
    || value.sdkVersion !== SDK_VERSION
    || !validCollectorId(value.collectorId)
    || typeof value.instanceId !== 'string' || !value.instanceId.trim()
    || !Number.isSafeInteger(value.sequence) || value.sequence < 0
    || !['event', 'diagnostic', 'heartbeat', 'completed'].includes(value.kind)) {
    throw protocolError();
  }

  if (previousSequence !== null && value.sequence <= previousSequence) {
    throw sequenceError();
  }

  const hasEvent = value.event !== undefined && value.event !== null;
  const hasDiagnostic = value.diagnostic !== undefined && value.diagnostic !== null;
  const shapeValid = value.kind === 'event'
    ? hasEvent && !hasDiagnostic
    : value.kind === 'diagnostic'
      ? !hasEvent && hasDiagnostic
      : !hasEvent && !hasDiagnostic;

  if (!shapeValid || encodedBytes(value) > MAX_ENVELOPE_BYTES) {
    throw protocolError();
  }
  return value;
}
