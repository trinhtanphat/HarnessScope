import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('package metadata pins HarnessScope v0.4 Electron fallback and Tauri toolchains', () => {
  assert.equal(pkg.version, '0.4.0');
  assert.equal(pkg.main, 'apps/desktop/main.mjs');
  assert.equal(pkg.devDependencies?.electron, '44.1.0');
  assert.equal(pkg.devDependencies?.['electron-builder'], '26.15.3');
  assert.equal(pkg.devDependencies?.['@tauri-apps/cli'], '2.11.4');
  assert.equal(pkg.scripts?.desktop, 'electron .');
  assert.match(pkg.scripts?.['desktop:pack'] || '', /electron-builder/);
  assert.match(pkg.scripts?.['desktop:win'] || '', /--win/);
  assert.match(pkg.scripts?.['desktop:mac'] || '', /--mac/);
  assert.equal(pkg.scripts?.['tauri:win'], 'tauri build --config apps/tauri/src-tauri/tauri.conf.json --target x86_64-pc-windows-msvc --bundles nsis,msi');
  assert.equal(pkg.scripts?.['tauri:mac'], 'tauri build --config apps/tauri/src-tauri/tauri.conf.json --target universal-apple-darwin --bundles dmg,app');
  assert.equal(pkg.scripts?.['collector:build'], 'cargo build -p harnesscope-collectors --bin harnesscope-native-collector --release');
});

test('electron-builder fallback remains ASAR-bounded and targets unsigned Windows/macOS artifacts', () => {
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

test('Electron fallback packaging scripts explicitly disable implicit publishing', () => {
  assert.match(pkg.scripts?.['desktop:win'] || '', /--publish\s+never/);
  assert.match(pkg.scripts?.['desktop:mac'] || '', /--publish\s+never/);
});
