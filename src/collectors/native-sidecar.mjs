import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

function collectorNotFound(message) {
  const error = new Error(`COLLECTOR_NOT_FOUND: ${message}`);
  error.code = 'COLLECTOR_NOT_FOUND';
  return error;
}

function isFile(path) {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

export function resolveNativeCollectorBinary({
  platform = process.platform,
  arch = process.arch,
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  const explicitValue = env?.HARNESSCOPE_COLLECTOR_BIN;
  if (typeof explicitValue === 'string' && explicitValue.trim()) {
    const explicit = resolve(cwd, explicitValue.trim());
    if (isFile(explicit)) return explicit;
    throw collectorNotFound(
      `HARNESSCOPE_COLLECTOR_BIN does not point to a collector executable: ${explicit}. `
      + 'Build it with npm run collector:build.',
    );
  }

  const binary = platform === 'win32'
    ? 'harnesscope-native-collector.exe'
    : 'harnesscope-native-collector';
  const candidate = resolve(cwd, 'target', 'release', binary);
  if (isFile(candidate)) return candidate;

  throw collectorNotFound(
    `${binary} is unavailable for ${platform}/${arch} at ${candidate}. `
    + 'Build it with npm run collector:build or set HARNESSCOPE_COLLECTOR_BIN.',
  );
}
