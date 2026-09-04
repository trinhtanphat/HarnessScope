import { spawn } from 'node:child_process';
import { appendCollectorEvent } from '../core/store.mjs';
import { sanitizeCollectorEnv } from './environment.mjs';
import {
  MAX_ENVELOPE_BYTES,
  SDK_VERSION,
  validateEnvelope,
  validateManifest,
} from './protocol.mjs';

export const MAX_PENDING_ENVELOPES = 256;
const DRAIN_DELAY_MS = 25;

function collectorError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeStatus(callback, value) {
  if (typeof callback !== 'function') return;
  try { callback(value); } catch { /* status observers cannot break collection */ }
}

function validateStartInput({ command, args, request, expectedCollectorId }) {
  if (typeof command !== 'string' || !command.trim()) {
    throw collectorError('COLLECTOR_INVALID_CONFIG');
  }
  if (!Array.isArray(args) || !request || typeof request !== 'object') {
    throw collectorError('COLLECTOR_INVALID_CONFIG');
  }
  if (request.sdkVersion !== SDK_VERSION
    || typeof request.instanceId !== 'string' || !request.instanceId.trim()
    || !Array.isArray(request.requestedCapabilities ?? [])) {
    throw collectorError('COLLECTOR_INVALID_CONFIG');
  }
  if (request.collectorId !== undefined
    && (typeof request.collectorId !== 'string' || !request.collectorId.trim())) {
    throw collectorError('COLLECTOR_INVALID_CONFIG');
  }
  if (expectedCollectorId !== null
    && (typeof expectedCollectorId !== 'string' || !expectedCollectorId.trim())) {
    throw collectorError('COLLECTOR_INVALID_CONFIG');
  }
  if (expectedCollectorId !== null
    && request.collectorId !== undefined
    && request.collectorId !== expectedCollectorId) {
    throw collectorError('COLLECTOR_INVALID_CONFIG');
  }
}

function validateRequestedCapabilities(manifest, request) {
  const granted = new Set(manifest.capabilities ?? []);
  for (const capability of request.requestedCapabilities ?? []) {
    if (!granted.has(capability)) {
      throw collectorError('COLLECTOR_CAPABILITY_DENIED');
    }
  }
}

function persistHostDiagnostic(db, sessionId, collectorId, instanceId, code, message) {
  try {
    appendCollectorEvent(db, sessionId, {
      source: 'collector-diagnostic',
      kind: 'Unknown',
      correlationId: instanceId,
      data: { collectorId, instanceId, code, message },
    });
  } catch {
    // The original host failure remains authoritative when diagnostics cannot persist.
  }
}

export function runExternalCollector({
  db,
  sessionId,
  command,
  args = [],
  request,
  expectedCollectorId,
  signal = null,
  onStatus = null,
}) {
  const manifestCollectorId = expectedCollectorId === undefined
    ? request?.collectorId ?? null
    : expectedCollectorId;
  validateStartInput({ command, args, request, expectedCollectorId: manifestCollectorId });
  if (!db || typeof sessionId !== 'string' || !sessionId.trim()) {
    return Promise.reject(collectorError('COLLECTOR_INVALID_CONFIG'));
  }

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: sanitizeCollectorEnv(process.env),
      });
    } catch {
      reject(collectorError('COLLECTOR_START_FAILED'));
      return;
    }

    let settled = false;
    let failed = false;
    let manifest = null;
    let lastSequence = null;
    let buffer = Buffer.alloc(0);
    const pending = [];
    const diagnostics = [];
    let drainTimer = null;
    let childClosed = false;
    let childExitCode = null;
    let completed = false;
    let eventsPersisted = 0;

    safeStatus(onStatus, 'starting');

    const cleanup = () => {
      if (drainTimer !== null) {
        clearTimeout(drainTimer);
        drainTimer = null;
      }
      if (signal) signal.removeEventListener('abort', onAbort);
    };

    const finishFailure = (error) => {
      if (settled || failed) return;
      failed = true;
      safeStatus(onStatus, 'failed');
      if (error?.code === 'COLLECTOR_BACKPRESSURE') {
        persistHostDiagnostic(
          db,
          sessionId,
          manifest?.id ?? manifestCollectorId ?? request.collectorId ?? 'external.collector',
          request.instanceId,
          error.code,
          'Collector queue capacity exceeded; evidence may be incomplete.',
        );
      }
      try { child.stdin.end(); } catch { /* already closed */ }
      try { child.kill(); } catch { /* already closed */ }
      cleanup();
      settled = true;
      reject(error?.code ? error : collectorError('COLLECTOR_RUNTIME_FAILED'));
    };

    const maybeFinish = () => {
      if (settled || failed || !childClosed || pending.length > 0 || drainTimer !== null) return;
      if (!manifest) {
        finishFailure(collectorError('COLLECTOR_PROTOCOL_ERROR'));
        return;
      }
      if (buffer.length > 0) {
        finishFailure(collectorError('COLLECTOR_PROTOCOL_ERROR'));
        return;
      }
      if (!completed || childExitCode !== 0) {
        finishFailure(collectorError('COLLECTOR_RUNTIME_FAILED'));
        return;
      }
      cleanup();
      settled = true;
      safeStatus(onStatus, 'stopped');
      resolve({
        instanceId: request.instanceId,
        collectorId: manifest.id,
        eventsPersisted,
        diagnostics,
        status: 'stopped',
      });
    };

    const drainQueue = () => {
      drainTimer = null;
      if (settled || failed) return;
      try {
        while (pending.length > 0) {
          const envelope = pending.shift();
          if (envelope.kind === 'event') {
            appendCollectorEvent(db, sessionId, envelope.event);
            eventsPersisted += 1;
          } else if (envelope.kind === 'diagnostic') {
            diagnostics.push(envelope.diagnostic);
            appendCollectorEvent(db, sessionId, {
              source: 'collector-diagnostic',
              kind: 'Unknown',
              correlationId: envelope.instanceId,
              data: {
                collectorId: envelope.collectorId,
                instanceId: envelope.instanceId,
                ...envelope.diagnostic,
              },
            });
            eventsPersisted += 1;
          } else if (envelope.kind === 'completed') {
            completed = true;
            try { child.stdin.end(); } catch { /* already closed */ }
          }
        }
      } catch (error) {
        finishFailure(error?.code ? error : collectorError('COLLECTOR_RUNTIME_FAILED'));
        return;
      }
      maybeFinish();
    };

    const scheduleDrain = () => {
      if (drainTimer !== null || settled || failed) return;
      drainTimer = setTimeout(drainQueue, DRAIN_DELAY_MS);
    };

    const enqueueEnvelope = (envelope) => {
      validateEnvelope(envelope, lastSequence);
      if (envelope.collectorId !== manifest.id || envelope.instanceId !== request.instanceId) {
        throw collectorError('COLLECTOR_PROTOCOL_ERROR');
      }
      lastSequence = envelope.sequence;
      if (pending.length >= MAX_PENDING_ENVELOPES) {
        throw collectorError('COLLECTOR_BACKPRESSURE');
      }
      pending.push(envelope);
      scheduleDrain();
    };

    const processLine = (lineBuffer) => {
      if (lineBuffer.length > MAX_ENVELOPE_BYTES) {
        throw collectorError('COLLECTOR_PROTOCOL_ERROR');
      }
      if (lineBuffer.length > 0 && lineBuffer[lineBuffer.length - 1] === 0x0d) {
        lineBuffer = lineBuffer.subarray(0, lineBuffer.length - 1);
      }
      if (lineBuffer.length === 0) return;
      let value;
      try {
        value = JSON.parse(lineBuffer.toString('utf8'));
      } catch {
        throw collectorError('COLLECTOR_PROTOCOL_ERROR');
      }

      if (!manifest) {
        validateManifest(value);
        if (manifestCollectorId !== null && value.id !== manifestCollectorId) {
          throw collectorError('COLLECTOR_PROTOCOL_ERROR');
        }
        validateRequestedCapabilities(value, request);
        manifest = value;
        safeStatus(onStatus, 'running');
        return;
      }
      enqueueEnvelope(value);
    };

    const onStdoutData = (chunk) => {
      if (settled || failed) return;
      try {
        buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
        let newline;
        while ((newline = buffer.indexOf(0x0a)) !== -1) {
          const lineBuffer = buffer.subarray(0, newline);
          buffer = buffer.subarray(newline + 1);
          processLine(lineBuffer);
          if (settled || failed) return;
        }
        if (buffer.length > MAX_ENVELOPE_BYTES) {
          throw collectorError('COLLECTOR_PROTOCOL_ERROR');
        }
      } catch (error) {
        finishFailure(error);
      }
    };

    const onAbort = () => finishFailure(collectorError('COLLECTOR_RUNTIME_FAILED'));
    if (signal?.aborted) {
      onAbort();
      return;
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', onStdoutData);
    child.stderr.on('data', () => { /* stderr is intentionally never evidence */ });
    child.on('error', () => finishFailure(collectorError('COLLECTOR_START_FAILED')));
    child.on('close', (code) => {
      childClosed = true;
      childExitCode = code;
      if (failed || settled) return;
      if (buffer.length > 0) {
        finishFailure(collectorError('COLLECTOR_PROTOCOL_ERROR'));
        return;
      }
      if (pending.length > 0) {
        if (drainTimer !== null) {
          clearTimeout(drainTimer);
          drainTimer = null;
        }
        drainQueue();
      } else {
        maybeFinish();
      }
    });

    child.stdin.on('error', () => { /* child failure is reported by close/error */ });
    child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
      if (error) finishFailure(collectorError('COLLECTOR_START_FAILED'));
    });
  });
}
