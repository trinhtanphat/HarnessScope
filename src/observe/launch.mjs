import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { appendEvent } from '../core/store.mjs';

function lineCollector(onLine) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.toString('utf8');
    while (true) {
      const idx = buffer.indexOf('\n');
      if (idx < 0) break;
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      onLine(line);
    }
  };
}

export async function launchTarget({ db, sessionId, target, args = [], cwd = process.cwd(), env = process.env }) {
  const startedUtc = new Date().toISOString();
  const child = spawn(target, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const captured = [];
  const started = appendEvent(db, {
    sessionId, timestampUtc: startedUtc, source: 'launcher', kind: 'ProcessStarted', correlationId: `pid-${child.pid}`,
    data: { pid: child.pid, executable: target, executableName: basename(target), args }
  });
  captured.push(started);

  const consume = lineCollector((line) => {
    if (!line.startsWith('HARNESSCOPE_EVENT ')) return;
    try {
      const parsed = JSON.parse(line.slice('HARNESSCOPE_EVENT '.length));
      captured.push(appendEvent(db, {
        sessionId,
        timestampUtc: parsed.timestampUtc ?? new Date().toISOString(),
        source: parsed.source ?? 'structured-stdout',
        kind: parsed.kind ?? 'Unknown',
        correlationId: parsed.correlationId ?? null,
        data: parsed.data ?? {}
      }));
    } catch {
      captured.push(appendEvent(db, {
        sessionId, source: 'launcher', kind: 'Unknown',
        data: { diagnostic: 'Malformed HARNESSCOPE_EVENT marker omitted from persistence.' }
      }));
    }
  });
  child.stdout.on('data', consume);
  child.stderr.on('data', () => {});

  // `exit` can fire before stdio pipes are fully drained (notably on Windows).
  // `close` fires after the child has exited and its stdio streams are closed,
  // so no structured stdout callback can race with the caller closing SQLite.
  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const exited = appendEvent(db, {
    sessionId, source: 'launcher', kind: 'ProcessExited', correlationId: `pid-${child.pid}`,
    data: { pid: child.pid, exitCode: exit.code, signal: exit.signal }
  });
  captured.push(exited);
  return { pid: child.pid, exitCode: exit.code, signal: exit.signal, eventsCaptured: captured.length };
}
