const SENSITIVE_KEY = /(authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password|passwd|private[-_]?key|client[-_]?secret)/i;
const TOKEN_PATTERNS = [
  /\b(?:sk|sk-ant|ghp|github_pat|xox[baprs]|AIza)[-_A-Za-z0-9]{16,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b/gi
];

function redactString(input) {
  let value = input;
  let changed = false;
  for (const pattern of TOKEN_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(value)) {
      pattern.lastIndex = 0;
      value = value.replace(pattern, '[REDACTED]');
      changed = true;
    }
  }
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_KEY.test(key)) {
        url.searchParams.set(key, '[REDACTED]');
        changed = true;
      }
    }
    if (changed) value = url.toString();
  } catch {}
  return { value, redacted: changed };
}

export function redactValue(input, keyHint = '') {
  if (SENSITIVE_KEY.test(keyHint)) return { value: '[REDACTED]', redacted: true };
  if (input === null || input === undefined) return { value: input, redacted: false };
  if (typeof input === 'string') return redactString(input);
  if (typeof input !== 'object') return { value: input, redacted: false };

  if (Array.isArray(input)) {
    let redacted = false;
    const value = input.map((item) => {
      const r = redactValue(item);
      redacted ||= r.redacted;
      return r.value;
    });
    return { value, redacted };
  }

  let redacted = false;
  const value = {};
  for (const [key, item] of Object.entries(input)) {
    const r = redactValue(item, key);
    value[key] = r.value;
    redacted ||= r.redacted;
  }
  return { value, redacted };
}
