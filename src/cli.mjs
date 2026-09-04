import { resolve } from 'node:path';
import { openWorkspace, createSession, getSession, listSessions, appendEvents, listEvents, replaceFindings, listFindings } from './core/store.mjs';
import { acquireWorkspaceLock } from './core/workspace-lock.mjs';
import { importHar } from './importers/har.mjs';
import { importProcmon } from './importers/procmon.mjs';
import { importJsonl } from './importers/jsonl.mjs';
import { inferFindings } from './core/infer.mjs';
import { compareSessions } from './core/compare.mjs';
import { exportSession } from './core/exporter.mjs';
import { launchTarget } from './observe/launch.mjs';
import { watchFiles } from './observe/watch-files.mjs';

function pullFlag(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1); return true;
}
function pullOpt(args, name, fallback = null) {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  if (i === args.length - 1) throw new Error(`Missing value for ${name}`);
  const value = args[i + 1]; args.splice(i, 2); return value;
}
function required(value, label) { if (!value) throw new Error(`Missing ${label}`); return value; }
function emit(io, value, json) {
  if (json) io.stdout.write(JSON.stringify(value) + '\n');
  else if (typeof value === 'string') io.stdout.write(value + '\n');
  else io.stdout.write(JSON.stringify(value, null, 2) + '\n');
}
function help() {
  return `HarnessScope V1\n\nCommands:\n  session new --name <name> [--mode cli|desktop]\n  session list\n  launch --session <id> -- <target> [args...]\n  watch-files --session <id> --path <dir> [--seconds 10]\n  import har --session <id> <file.har>\n  import procmon --session <id> <file.csv> [--date YYYY-MM-DD]\n  import jsonl --session <id> <file.jsonl> --map <mapping.yaml>\n  timeline --session <id>\n  infer --session <id>\n  compare <session-a> <session-b>\n  export --session <id> --out <dir>\n  ui [--port 4173]\n\nGlobal: --db <workspace.sqlite> --json`;
}

function commandWrites(command, args) {
  if (command === 'session') return args[0] === 'new';
  return new Set(['launch', 'watch-files', 'import', 'infer']).has(command);
}

export async function runCli(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  const args = [...argv];
  const dbPath = resolve(pullOpt(args, '--db', '.harnesscope/workspace.sqlite'));
  const json = pullFlag(args, '--json');
  const command = args.shift();
  if (!command || command === 'help' || command === '--help' || command === '-h') { emit(io, help(), false); return 0; }

  if (command === 'ui') {
    const port = Number(pullOpt(args, '--port', '4173'));
    const { startUiServer } = await import('./ui/server.mjs');
    const server = await startUiServer({ dbPath, port });
    emit(io, `HarnessScope UI: http://127.0.0.1:${server.port}`, false);
    return await new Promise(() => {});
  }

  const lease = commandWrites(command, args)
    ? acquireWorkspaceLock(dbPath, { runtime: 'node-cli' })
    : null;
  const db = openWorkspace(dbPath);
  try {
    if (command === 'session') {
      const action = args.shift();
      if (action === 'new') {
        const name = required(pullOpt(args, '--name'), '--name');
        const mode = pullOpt(args, '--mode', 'unknown');
        emit(io, createSession(db, name, mode), json); return 0;
      }
      if (action === 'list') { emit(io, listSessions(db), json); return 0; }
      throw new Error(`Unknown session action: ${action}`);
    }
    if (command === 'launch') {
      const sessionId = required(pullOpt(args, '--session'), '--session');
      if (!getSession(db, sessionId)) throw new Error(`Session not found: ${sessionId}`);
      const delim = args.indexOf('--');
      if (delim < 0 || !args[delim + 1]) throw new Error('launch requires -- <target> [args...]');
      const target = args[delim + 1];
      const targetArgs = args.slice(delim + 2);
      emit(io, await launchTarget({ db, sessionId, target, args: targetArgs }), json); return 0;
    }
    if (command === 'watch-files') {
      const sessionId = required(pullOpt(args, '--session'), '--session');
      const path = required(pullOpt(args, '--path'), '--path');
      const seconds = Number(pullOpt(args, '--seconds', '10'));
      emit(io, await watchFiles({ db, sessionId, path, seconds }), json); return 0;
    }
    if (command === 'import') {
      const type = args.shift();
      const sessionId = required(pullOpt(args, '--session'), '--session');
      let events;
      if (type === 'har') events = importHar(required(args.shift(), 'HAR file'));
      else if (type === 'procmon') events = importProcmon(required(args.shift(), 'Procmon CSV'), { date: pullOpt(args, '--date', new Date().toISOString().slice(0, 10)) });
      else if (type === 'jsonl') events = importJsonl(required(args.shift(), 'JSONL file'), required(pullOpt(args, '--map'), '--map'));
      else throw new Error(`Unknown import type: ${type}`);
      const stored = appendEvents(db, sessionId, events);
      emit(io, { imported: stored.length, kinds: [...new Set(stored.map((e) => e.kind))].sort() }, json); return 0;
    }
    if (command === 'timeline') {
      const sessionId = required(pullOpt(args, '--session'), '--session');
      emit(io, { session: getSession(db, sessionId), events: listEvents(db, sessionId) }, json); return 0;
    }
    if (command === 'infer') {
      const sessionId = required(pullOpt(args, '--session'), '--session');
      const findings = inferFindings(listEvents(db, sessionId));
      replaceFindings(db, sessionId, findings);
      emit(io, { session: getSession(db, sessionId), findings: listFindings(db, sessionId) }, json); return 0;
    }
    if (command === 'compare') {
      const a = required(args.shift(), 'session-a');
      const b = required(args.shift(), 'session-b');
      const load = (id) => ({ session: getSession(db, id), events: listEvents(db, id), findings: listFindings(db, id) });
      emit(io, compareSessions(load(a), load(b)), json); return 0;
    }
    if (command === 'export') {
      const sessionId = required(pullOpt(args, '--session'), '--session');
      const outDir = resolve(required(pullOpt(args, '--out'), '--out'));
      emit(io, exportSession({ db, sessionId, outDir }), json); return 0;
    }
    throw new Error(`Unknown command: ${command}`);
  } finally {
    db.close();
    lease?.release();
  }
}
