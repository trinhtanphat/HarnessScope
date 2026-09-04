import { DesktopError } from './errors.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_MODES = new Set(['cli', 'desktop', 'unknown']);

function boundedString(value, { code, label, min = 1, max }) {
  if (typeof value !== 'string') throw new DesktopError(code, `${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new DesktopError(code, `${label} is outside the allowed length.`);
  }
  return trimmed;
}

function boundedArgs(args, code) {
  if (!Array.isArray(args) || args.length > 64 || args.some((arg) => typeof arg !== 'string' || arg.length > 8192)) {
    throw new DesktopError(code, 'Collector target arguments are invalid.');
  }
  return [...args];
}

export function assertSessionId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new DesktopError('INVALID_SESSION_ID', 'The session id is invalid.');
  }
  return value;
}

export function assertCollectorInstanceId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new DesktopError('INVALID_COLLECTOR_INSTANCE', 'The collector instance id is invalid.');
  }
  return value;
}

export function validateSessionInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DesktopError('INVALID_SESSION_INPUT', 'Session input is invalid.');
  }
  const name = boundedString(input.name, { code: 'INVALID_SESSION_INPUT', label: 'Session name', max: 120 });
  const mode = input.mode ?? 'desktop';
  if (!SESSION_MODES.has(mode)) {
    throw new DesktopError('INVALID_SESSION_INPUT', 'Session mode must be cli, desktop, or unknown.');
  }
  return { name, mode };
}

export function validateLaunchRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DesktopError('INVALID_LAUNCH_REQUEST', 'Launch request is invalid.');
  }
  const target = boundedString(input.target, { code: 'INVALID_LAUNCH_REQUEST', label: 'Target', max: 4096 });
  const args = input.args ?? [];
  if (!Array.isArray(args) || args.length > 64 || args.some((arg) => typeof arg !== 'string' || arg.length > 8192)) {
    throw new DesktopError('INVALID_LAUNCH_REQUEST', 'Launch arguments are invalid.');
  }
  const result = { target, args: [...args] };
  if (input.cwd !== undefined && input.cwd !== null) {
    result.cwd = boundedString(input.cwd, { code: 'INVALID_LAUNCH_REQUEST', label: 'Working directory', max: 4096 });
  }
  return result;
}

export function validateCollectorStartRequest(input) {
  const code = 'INVALID_COLLECTOR_REQUEST';
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DesktopError(code, 'Collector request is invalid.');
  }

  let collectorId = null;
  if (input.collectorId !== undefined && input.collectorId !== null && input.collectorId !== '') {
    collectorId = boundedString(input.collectorId, { code, label: 'Collector id', max: 200 });
  }

  let command = null;
  if (input.command !== undefined && input.command !== null && input.command !== '') {
    command = boundedString(input.command, { code, label: 'Collector command', max: 4096 });
  }
  if (!collectorId && !command) {
    throw new DesktopError(code, 'Choose a first-party collector or an explicit collector command.');
  }

  const paths = input.paths ?? [];
  if (!Array.isArray(paths) || paths.length > 32 || paths.some((path) => typeof path !== 'string')) {
    throw new DesktopError(code, 'Collector paths are invalid.');
  }
  const normalizedPaths = paths.map((path) => boundedString(path, { code, label: 'Collector path', max: 4096 }));

  if (!input.target || typeof input.target !== 'object' || Array.isArray(input.target)) {
    throw new DesktopError(code, 'Collector target is invalid.');
  }
  const executable = boundedString(input.target.executable, { code, label: 'Collector target', max: 4096 });
  const target = { executable, args: boundedArgs(input.target.args ?? [], code) };
  if (input.target.cwd !== undefined && input.target.cwd !== null && input.target.cwd !== '') {
    target.cwd = boundedString(input.target.cwd, { code, label: 'Collector working directory', max: 4096 });
  }

  if (input.hashFiles !== undefined && typeof input.hashFiles !== 'boolean') {
    throw new DesktopError(code, 'hashFiles must be boolean.');
  }

  return {
    collectorId,
    command,
    paths: normalizedPaths,
    hashFiles: input.hashFiles === true,
    target
  };
}

export function validateDialogFilters(filters) {
  if (filters === undefined || filters === null) return [];
  if (!Array.isArray(filters) || filters.length > 12) {
    throw new DesktopError('INVALID_DIALOG_FILTERS', 'File filters are invalid.');
  }
  return filters.map((filter) => {
    if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
      throw new DesktopError('INVALID_DIALOG_FILTERS', 'File filters are invalid.');
    }
    const name = boundedString(filter.name, { code: 'INVALID_DIALOG_FILTERS', label: 'Filter name', max: 80 });
    if (!Array.isArray(filter.extensions) || filter.extensions.length > 16 || filter.extensions.some((ext) => typeof ext !== 'string' || !/^[A-Za-z0-9*]+$/.test(ext))) {
      throw new DesktopError('INVALID_DIALOG_FILTERS', 'File filter extensions are invalid.');
    }
    return { name, extensions: [...filter.extensions] };
  });
}
