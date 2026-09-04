const SENSITIVE_NAME = /TOKEN|SECRET|PASSWORD|COOKIE|KEY|AUTH/i;
const SAFE_RUNTIME_NAMES = new Set([
  'PATH',
  'HOME',
  'USERPROFILE',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SYSTEMROOT',
  'WINDIR',
]);

export function sanitizeCollectorEnv(env = process.env) {
  const sanitized = {};
  for (const [name, rawValue] of Object.entries(env ?? {})) {
    if (rawValue === undefined || rawValue === null) continue;
    if (SENSITIVE_NAME.test(name)) continue;
    if (!SAFE_RUNTIME_NAMES.has(name.toUpperCase())) continue;
    sanitized[name] = String(rawValue);
  }
  return sanitized;
}
