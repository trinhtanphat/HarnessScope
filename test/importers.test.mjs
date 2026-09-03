import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importHar } from '../src/importers/har.mjs';
import { importProcmon } from '../src/importers/procmon.mjs';
import { importJsonl } from '../src/importers/jsonl.mjs';

test('HAR importer normalizes request/response and redacts secrets before returning events', () => {
  const events = importHar(new URL('../fixtures/sample.har', import.meta.url));
  assert.equal(events.length, 2);
  assert.equal(events[0].kind, 'HttpRequest');
  assert.equal(events[1].kind, 'HttpResponse');
  const text = JSON.stringify(events);
  assert.match(text, /\[REDACTED\]/);
  assert.doesNotMatch(text, /supersecret|secret-query|secret-cookie|secret-body/);
  assert.equal(events[0].data.method, 'POST');
});

test('Procmon importer maps process and file operations to normalized event kinds', () => {
  const events = importProcmon(new URL('../fixtures/sample-procmon.csv', import.meta.url), { date: '2026-09-04' });
  assert.deepEqual(events.map((e) => e.kind), ['ProcessStarted', 'FileRead', 'FileWritten']);
  assert.equal(events[1].data.path, 'C:\\project\\skills\\frontend.md');
  assert.equal(events[0].data.childPid, 101);
});

test('JSONL importer applies small YAML key mapping and canonicalizes known event names', () => {
  const events = importJsonl(
    new URL('../fixtures/sample.jsonl', import.meta.url),
    new URL('../fixtures/sample-map.yaml', import.meta.url)
  );
  assert.deepEqual(events.map((e) => e.kind), ['PermissionPrompt', 'PermissionDecision']);
  assert.equal(events[0].correlationId, 'p1');
  assert.equal(events[0].source, 'external-jsonl');
  assert.equal(events[1].data.decision, 'allow');
});
