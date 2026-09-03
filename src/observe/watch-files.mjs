import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { appendEvent } from '../core/store.mjs';

function sleep(ms) { return new Promise((resolvePromise) => setTimeout(resolvePromise, ms)); }
function snapshot(root) {
  const out = new Map();
  const stack = [resolve(root)];
  while (stack.length) {
    const dir = stack.pop();
    let names;
    try { names = readdirSync(dir); } catch { continue; }
    for (const name of names) {
      const path = join(dir, name);
      let st;
      try { st = statSync(path); } catch { continue; }
      if (st.isDirectory()) stack.push(path);
      else if (st.isFile()) out.set(path, { size: st.size, mtimeMs: st.mtimeMs });
    }
  }
  return out;
}

export async function watchFiles({ db, sessionId, path, seconds = 10, intervalMs = 500 }) {
  let previous = snapshot(path);
  let captured = 0;
  const end = Date.now() + Math.max(0, seconds) * 1000;
  while (Date.now() < end) {
    await sleep(intervalMs);
    const current = snapshot(path);
    for (const [file, meta] of current) {
      const old = previous.get(file);
      if (!old || old.size !== meta.size || old.mtimeMs !== meta.mtimeMs) {
        appendEvent(db, { sessionId, source: 'file-poll', kind: 'FileWritten', data: { path: file, size: meta.size, mtimeMs: meta.mtimeMs, contentCaptured: false } });
        captured++;
      }
    }
    previous = current;
  }
  return { path: resolve(path), eventsCaptured: captured, seconds };
}
