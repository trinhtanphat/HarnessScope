import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAX_ENVELOPE_BYTES,
  SDK_VERSION,
  validateEnvelope,
  validateManifest,
} from '../src/collectors/protocol.mjs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/collectors/protocol-v1.json', import.meta.url), 'utf8'));
const validManifest = fixture.manifest;
const validEnvelope = fixture.envelope;

test('collector protocol exposes exact v1 constants', () => {
  assert.equal(SDK_VERSION, '1');
  assert.equal(MAX_ENVELOPE_BYTES, 262_144);
});

test('collector protocol accepts the canonical fixture', () => {
  assert.equal(validateManifest(validManifest), validManifest);
  assert.equal(validateEnvelope(validEnvelope, null), validEnvelope);
});

test('collector protocol rejects unknown sdkVersion and duplicate sequence', () => {
  assert.throws(
    () => validateManifest({ ...validManifest, sdkVersion: '2' }),
    /COLLECTOR_PROTOCOL_ERROR/,
  );
  assert.throws(
    () => validateEnvelope({ ...validEnvelope, sequence: 4 }, 4),
    /COLLECTOR_SEQUENCE_ERROR/,
  );
  assert.throws(
    () => validateEnvelope({ ...validEnvelope, sequence: 3 }, 4),
    /COLLECTOR_SEQUENCE_ERROR/,
  );
});

test('collector protocol rejects invalid ids, envelope shapes and oversize lines', () => {
  assert.throws(
    () => validateManifest({ ...validManifest, id: 'not-a-reverse-dns-id' }),
    /COLLECTOR_PROTOCOL_ERROR/,
  );
  assert.throws(
    () => validateEnvelope({ ...validEnvelope, diagnostic: { code: 'BAD', message: 'x' } }, null),
    /COLLECTOR_PROTOCOL_ERROR/,
  );
  assert.throws(
    () => validateEnvelope({ ...validEnvelope, event: { ...validEnvelope.event, data: { payload: 'x'.repeat(MAX_ENVELOPE_BYTES) } } }, null),
    /COLLECTOR_PROTOCOL_ERROR/,
  );
});

test('heartbeat and completed envelopes cannot carry event or diagnostic payloads', () => {
  for (const kind of ['heartbeat', 'completed']) {
    const clean = { ...validEnvelope, kind, event: undefined, diagnostic: undefined };
    assert.equal(validateEnvelope(clean, null), clean);
    assert.throws(
      () => validateEnvelope({ ...clean, event: validEnvelope.event }, null),
      /COLLECTOR_PROTOCOL_ERROR/,
    );
  }
});
