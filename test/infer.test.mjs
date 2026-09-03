import test from 'node:test';
import assert from 'node:assert/strict';
import { inferFindings } from '../src/core/infer.mjs';

const e = (id, kind, data = {}, correlationId = null, timestampUtc = `2026-09-04T00:00:${id.padStart(2,'0')}.000Z`) => ({
  id, kind, data, correlationId, timestampUtc, source: 'fixture', redaction: 'none'
});

test('infers skill loading, permission gate, tool schema, execution loop, context management and resume persistence from evidence', () => {
  const events = [
    e('01','SkillRead',{path:'skills/frontend.md'}),
    e('02','InstructionRead',{path:'skills/software-engineering.md'}),
    e('03','PermissionPrompt',{action:'shell'},'perm-1'),
    e('04','PermissionDecision',{decision:'allow'},'perm-1'),
    e('05','ToolCall',{name:'read',args:{path:'src/app.js'}},'tool-1'),
    e('06','ToolResult',{name:'read',ok:true},'tool-1'),
    e('07','FileWritten',{path:'src/app.js'}),
    e('08','ToolCall',{name:'shell',args:{command:'npm test'}},'tool-2'),
    e('09','ToolResult',{name:'shell',ok:true},'tool-2'),
    e('10','CompactionMarker',{reason:'context_pressure'}),
    e('11','FileWritten',{path:'state/session.json'}),
    e('12','ProcessExited',{pid:10}),
    e('13','ProcessStarted',{pid:11}),
    e('14','FileRead',{path:'state/session.json'}),
    e('15','ResumeMarker',{session:'abc'})
  ];
  const findings = inferFindings(events);
  const categories = new Set(findings.map((f) => f.category));
  for (const category of ['skill_loading','permission_gate','tool_schema','execution_loop','context_management','session_persistence']) {
    assert.equal(categories.has(category), true, `missing ${category}`);
  }
  const permission = findings.find((f) => f.category === 'permission_gate');
  assert.deepEqual(permission.evidenceEventIds, ['03','04']);
  assert.ok(permission.confidence >= 0.9);
  const tool = findings.find((f) => f.category === 'tool_schema' && /read/.test(f.title));
  assert.match(tool.statement, /path/);
});

test('does not invent context management findings when explicit markers are absent', () => {
  const findings = inferFindings([e('01','ToolCall',{name:'read',args:{path:'x'}})]);
  assert.equal(findings.some((f) => f.category === 'context_management'), false);
});
