import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { redactValue } from '../core/redact.mjs';

function pathOf(input) { return input instanceof URL ? fileURLToPath(input) : input; }
function parseSimpleYaml(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx < 0) continue;
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}
function get(obj, path) {
  return String(path).split('.').reduce((value, key) => value?.[key], obj);
}
function canonicalKind(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  const map = {
    permission_prompt: 'PermissionPrompt', permission_decision: 'PermissionDecision',
    tool_call: 'ToolCall', tool_result: 'ToolResult', skill_read: 'SkillRead', instruction_read: 'InstructionRead',
    context_marker: 'ContextMarker', compaction_marker: 'CompactionMarker', resume_marker: 'ResumeMarker',
    user_prompt: 'UserPrompt', assistant_message: 'AssistantMessage', file_read: 'FileRead', file_written: 'FileWritten'
  };
  return map[normalized] ?? (value || 'Unknown');
}

export function importJsonl(input, mapInput) {
  const mapping = parseSimpleYaml(readFileSync(pathOf(mapInput), 'utf8'));
  const lines = readFileSync(pathOf(input), 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.map((line, index) => {
    const record = JSON.parse(line);
    const r = redactValue(get(record, mapping.data ?? 'data') ?? {});
    return {
      timestampUtc: get(record, mapping.timestamp ?? 'timestamp') ?? new Date().toISOString(),
      source: mapping.source || 'jsonl',
      kind: canonicalKind(get(record, mapping.kind ?? 'kind')),
      correlationId: get(record, mapping.correlationId ?? 'correlationId') ?? `line-${index + 1}`,
      data: r.value,
      redaction: r.redacted ? 'redacted' : 'none'
    };
  });
}
