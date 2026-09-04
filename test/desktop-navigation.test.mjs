import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isSafeExternalUrl } from '../apps/desktop/navigation.mjs';

test('desktop external navigation permits only https URLs', () => {
  assert.equal(isSafeExternalUrl('https://example.com/docs'), true);
  assert.equal(isSafeExternalUrl('http://example.com'), false);
  assert.equal(isSafeExternalUrl('file:///tmp/test'), false);
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false);
  assert.equal(isSafeExternalUrl('not a url'), false);
});

test('Electron window is hardened and loads the sandbox CommonJS preload', () => {
  const main = readFileSync(new URL('../apps/desktop/main.mjs', import.meta.url), 'utf8');
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /webSecurity:\s*true/);
  assert.match(main, /allowRunningInsecureContent:\s*false/);
  assert.match(main, /preload\.cjs/);
  assert.match(main, /will-navigate/);
  assert.match(main, /setWindowOpenHandler/);
  assert.doesNotMatch(main, /@electron\/remote/);
});
