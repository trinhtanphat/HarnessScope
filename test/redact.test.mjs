import test from 'node:test';
import assert from 'node:assert/strict';
import { redactValue } from '../src/core/redact.mjs';

test('redacts sensitive object keys recursively without retaining secret text', () => {
  const input = {
    Authorization: 'Bearer sk-ant-secret',
    nested: { api_key: 'sk-test-123', safe: 'ok' },
    cookie: 'session=abc',
    url: 'https://example.test/?token=supersecret&x=1'
  };
  const { value, redacted } = redactValue(input);
  assert.equal(redacted, true);
  const text = JSON.stringify(value);
  assert.match(text, /\[REDACTED\]/);
  assert.doesNotMatch(text, /sk-ant-secret|sk-test-123|session=abc|supersecret/);
  assert.equal(value.nested.safe, 'ok');
});

test('redacts token-like strings in arrays', () => {
  const { value, redacted } = redactValue(['safe', 'ghp_abcdefghijklmnopqrstuvwxyz1234567890']);
  assert.equal(redacted, true);
  assert.deepEqual(value, ['safe', '[REDACTED]']);
});
