import { validateManifest } from './protocol.mjs';

const COMMON_CAPABILITIES = Object.freeze([
  'process.lifecycle',
  'process.metadata',
  'file.metadata',
  'collector.diagnostics',
]);

const FIRST_PARTY = Object.freeze({
  linux: Object.freeze({
    sdkVersion: '1',
    id: 'harnesscope.linux.process-files',
    name: 'Linux Process + Files',
    version: '0.4.0',
    platforms: Object.freeze(['linux']),
    capabilities: COMMON_CAPABILITIES,
    requiresExplicitPaths: true,
    requiresTargetLaunch: true,
    contentCapture: 'unsupported',
  }),
  darwin: Object.freeze({
    sdkVersion: '1',
    id: 'harnesscope.macos.process-files',
    name: 'macOS Process + Files',
    version: '0.4.0',
    platforms: Object.freeze(['macos']),
    capabilities: COMMON_CAPABILITIES,
    requiresExplicitPaths: true,
    requiresTargetLaunch: true,
    contentCapture: 'unsupported',
  }),
});

function cloneManifest(manifest) {
  return {
    ...manifest,
    platforms: [...manifest.platforms],
    capabilities: [...manifest.capabilities],
  };
}

export function listCollectorManifests({ platform = process.platform } = {}) {
  const manifest = FIRST_PARTY[platform];
  if (!manifest) return [];
  const cloned = cloneManifest(manifest);
  validateManifest(cloned);
  return [cloned];
}

export function describeCollector(id, options = {}) {
  return listCollectorManifests(options).find((manifest) => manifest.id === id) ?? null;
}
