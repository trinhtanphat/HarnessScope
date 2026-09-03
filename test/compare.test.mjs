import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSessions } from '../src/core/compare.mjs';

test('compares observable capabilities and event kinds between CLI and Desktop style sessions', () => {
  const cli = {
    session: { id:'a', name:'cli', mode:'cli' },
    events: [
      {kind:'ToolCall',data:{name:'read'}}, {kind:'PermissionPrompt',data:{}}, {kind:'PermissionDecision',data:{}}
    ],
    findings: [{category:'permission_gate',title:'Permission gate'}]
  };
  const desktop = {
    session: { id:'b', name:'desktop', mode:'desktop' },
    events: [
      {kind:'ToolCall',data:{name:'read'}}, {kind:'ResumeMarker',data:{}}, {kind:'SkillRead',data:{path:'skills/ui.md'}}
    ],
    findings: [{category:'session_persistence',title:'Session persistence'}]
  };
  const diff = compareSessions(cli, desktop);
  assert.deepEqual(diff.sharedToolNames, ['read']);
  assert.deepEqual(diff.onlyAEventKinds, ['PermissionDecision','PermissionPrompt']);
  assert.deepEqual(diff.onlyBEventKinds, ['ResumeMarker','SkillRead']);
  assert.deepEqual(diff.onlyBFindingCategories, ['session_persistence']);
});
