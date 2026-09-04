import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('package metadata pins HarnessScope desktop v0.2 toolchain', () => {
  assert.equal(pkg.version, '0.2.0');
  assert.equal(pkg.main, 'apps/desktop/main.mjs');
  assert.equal(pkg.devDependencies?.electron, '44.1.0');
  assert.equal(pkg.devDependencies?.['electron-builder'], '26.15.3');
  assert.equal(pkg.scripts?.desktop, 'electron .');
  assert.match(pkg.scripts?.['desktop:pack'] || '', /electron-builder/);
  assert.match(pkg.scripts?.['desktop:win'] || '', /--win/);
  assert.match(pkg.scripts?.['desktop:mac'] || '', /--mac/);
});

test('electron-builder package is ASAR-bounded and targets unsigned Windows/macOS desktop artifacts', () => {
  const build = pkg.build;
  assert.equal(build.appId, 'com.trinhtanphat.harnesscope');
  assert.equal(build.productName, 'HarnessScope');
  assert.equal(build.asar, true);
  assert.equal(build.directories.output, 'dist/desktop');
  for (const path of ['apps/desktop/**/*','src/**/*','ui/**/*','package.json','LICENSE']) {
    assert.ok(build.files.includes(path), `missing packaged path: ${path}`);
  }
  const winTargets = build.win.target;
  assert.ok(winTargets.some((target) => target.target === 'nsis' && target.arch.includes('x64')));
  assert.ok(winTargets.some((target) => target.target === 'zip' && target.arch.includes('x64')));
  assert.equal(build.nsis.artifactName, 'HarnessScope-${version}-Setup.${ext}');
  assert.equal(build.win.artifactName, 'HarnessScope-${version}-windows-portable.${ext}');

  const macTargets = build.mac.target;
  assert.ok(macTargets.some((target) => target.target === 'dmg' && target.arch.includes('universal')));
  assert.ok(macTargets.some((target) => target.target === 'zip' && target.arch.includes('universal')));
  assert.equal(build.mac.artifactName, 'HarnessScope-${version}-macos-universal.${ext}');
  assert.equal(Object.hasOwn(build.mac, 'identity'), false);
});

test('CI packaging scripts explicitly disable electron-builder implicit publishing', () => {
  assert.match(pkg.scripts?.['desktop:win'] || '', /--publish\s+never/);
  assert.match(pkg.scripts?.['desktop:mac'] || '', /--publish\s+never/);
});
