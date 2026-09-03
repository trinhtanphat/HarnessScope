import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWorkspace, createSession, appendEvent, replaceFindings } from '../src/core/store.mjs';
import { startUiServer } from '../src/ui/server.mjs';

test('UI server exposes sessions, trace/finding provenance and static app', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'harnesscope-ui-'));
  const dbPath = join(dir, 'workspace.sqlite');
  const db = openWorkspace(dbPath);
  const session = createSession(db, 'desktop-fixture', 'desktop');
  const event = appendEvent(db, { sessionId: session.id, id:'e1', kind:'SkillRead', source:'fixture', data:{path:'skills/frontend.md'} });
  replaceFindings(db, session.id, [{ title:'Progressive skill loading', category:'skill_loading', confidence:0.95, evidenceEventIds:[event.id], statement:'Observed skill read.' }]);
  db.close();

  const server = await startUiServer({ dbPath, port: 0 });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.port}`;
  const sessions = await (await fetch(`${base}/api/sessions`)).json();
  assert.equal(sessions[0].name, 'desktop-fixture');
  const detail = await (await fetch(`${base}/api/session/${session.id}`)).json();
  assert.equal(detail.events[0].kind, 'SkillRead');
  assert.deepEqual(detail.findings[0].evidenceEventIds, ['e1']);
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /HarnessScope/);
  assert.match(html, /Trace/);
});
