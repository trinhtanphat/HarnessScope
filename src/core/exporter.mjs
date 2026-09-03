import { mkdirSync, writeFileSync, rmSync, renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSession, listEvents, listFindings } from './store.mjs';

function statusFor(finding) {
  if (finding.confidence >= 0.9) return 'INFERRED_HIGH';
  if (finding.confidence >= 0.7) return 'INFERRED_MEDIUM';
  return 'UNKNOWN';
}
function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
function stableObject(obj) {
  if (Array.isArray(obj)) return obj.map(stableObject);
  if (!obj || typeof obj !== 'object') return obj;
  return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, stableObject(obj[k])]));
}
function jsonText(value) { return JSON.stringify(stableObject(value), null, 2) + '\n'; }

function toolSchemas(events) {
  const byName = new Map();
  for (const event of events) {
    if (event.kind !== 'ToolCall' || !event.data?.name) continue;
    const name = String(event.data.name);
    const entry = byName.get(name) ?? { name, observedCalls: 0, arguments: {} };
    entry.observedCalls += 1;
    for (const [key, value] of Object.entries(event.data.args ?? {})) {
      entry.arguments[key] ??= { observedTypes: [] };
      const t = typeOf(value);
      if (!entry.arguments[key].observedTypes.includes(t)) entry.arguments[key].observedTypes.push(t);
      entry.arguments[key].observedTypes.sort();
    }
    byName.set(name, entry);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function markdown(session, events, findings, schemas) {
  const kinds = [...new Set(events.map((e) => e.kind))].sort();
  const lines = [
    '# HarnessScope Clean-Room Behavioral Spec',
    '',
    `- Session: \`${session.name}\``,
    `- Session ID: \`${session.id}\``,
    `- Mode: \`${session.mode}\``,
    `- Evidence events: ${events.length}`,
    `- Findings: ${findings.length}`,
    '',
    '> This report describes observed evidence and evidence-backed inference. It is not vendor source truth.',
    '',
    '## Observed event surface',
    '',
    ...(kinds.length ? kinds.map((k) => `- OBSERVED \`${k}\``) : ['- UNKNOWN No events were imported.']),
    '',
    '## Candidate tool surface',
    ''
  ];
  if (!schemas.length) lines.push('- UNKNOWN No tool calls were observed.');
  for (const schema of schemas) {
    const args = Object.keys(schema.arguments);
    lines.push(`- OBSERVED \`${schema.name}\` — ${schema.observedCalls} call(s); argument keys: ${args.length ? args.join(', ') : '(none observed)'}`);
  }
  lines.push('', '## Findings', '');
  if (!findings.length) lines.push('- UNKNOWN No evidence-backed findings were produced.');
  for (const f of findings) {
    lines.push(`### ${statusFor(f)} — ${f.title}`, '', f.statement, '', `Confidence: ${f.confidence.toFixed(2)}`, '', `Evidence: ${f.evidenceEventIds.map((id) => `\`${id}\``).join(', ') || 'none'}`, '');
  }
  return lines.join('\n').trimEnd() + '\n';
}

export function exportSession({ db, sessionId, outDir }) {
  const session = getSession(db, sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  const events = listEvents(db, sessionId);
  const findings = listFindings(db, sessionId);
  const schemas = toolSchemas(events);
  const spec = {
    format: 'harnesscope.cleanroom-spec.v1',
    session,
    evidence: {
      eventCount: events.length,
      eventKinds: [...new Set(events.map((e) => e.kind))].sort()
    },
    tools: schemas,
    findings: findings.map((f) => ({
      status: statusFor(f), title: f.title, category: f.category, confidence: f.confidence,
      statement: f.statement, evidenceEventIds: [...f.evidenceEventIds].sort()
    }))
  };

  const parent = dirname(outDir);
  mkdirSync(parent, { recursive: true });
  const temp = `${outDir}.tmp-${randomUUID()}`;
  mkdirSync(join(temp, 'tool-schemas'), { recursive: true });
  writeFileSync(join(temp, 'harness-spec.md'), markdown(session, events, findings, schemas));
  writeFileSync(join(temp, 'harness-spec.json'), jsonText(spec));
  for (const schema of schemas) writeFileSync(join(temp, 'tool-schemas', `${schema.name.replace(/[^A-Za-z0-9._-]/g, '_')}.json`), jsonText(schema));
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  renameSync(temp, outDir);
  return { outDir, files: ['harness-spec.md', 'harness-spec.json', ...schemas.map((s) => `tool-schemas/${s.name}.json`)] };
}
