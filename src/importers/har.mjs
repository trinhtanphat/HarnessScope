import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { redactValue } from '../core/redact.mjs';

function pathOf(input) { return input instanceof URL ? fileURLToPath(input) : input; }
function headersToObject(headers = []) { return Object.fromEntries(headers.map((h) => [h.name, h.value])); }
function parseBody(text) {
  if (text == null) return null;
  try { return JSON.parse(text); } catch { return text; }
}

export function importHar(input) {
  const har = JSON.parse(readFileSync(pathOf(input), 'utf8'));
  const events = [];
  for (const entry of har?.log?.entries ?? []) {
    const correlationId = randomUUID();
    const requestRaw = {
      method: entry.request?.method,
      url: entry.request?.url,
      headers: headersToObject(entry.request?.headers),
      body: parseBody(entry.request?.postData?.text),
      mimeType: entry.request?.postData?.mimeType ?? null
    };
    const responseRaw = {
      status: entry.response?.status,
      headers: headersToObject(entry.response?.headers),
      body: parseBody(entry.response?.content?.text),
      mimeType: entry.response?.content?.mimeType ?? null
    };
    const request = redactValue(requestRaw);
    const response = redactValue(responseRaw);
    events.push({
      timestampUtc: entry.startedDateTime ?? new Date().toISOString(), source: 'har', kind: 'HttpRequest',
      correlationId, data: request.value, redaction: request.redacted ? 'redacted' : 'none'
    });
    events.push({
      timestampUtc: entry.startedDateTime ?? new Date().toISOString(), source: 'har', kind: 'HttpResponse',
      correlationId, data: response.value, redaction: response.redacted ? 'redacted' : 'none'
    });
  }
  return events;
}
