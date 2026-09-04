import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWorkspace, getSession, listSessions, listEvents, listFindings, replaceFindings } from '../core/store.mjs';
import { acquireWorkspaceLock } from '../core/workspace-lock.mjs';
import { inferFindings } from '../core/infer.mjs';

const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), '../../ui'));
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml' };
function send(res, status, body, type='application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control':'no-store', 'x-content-type-options':'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function withDb(dbPath, fn) {
  const db = openWorkspace(dbPath);
  try { return fn(db); } finally { db.close(); }
}
function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT)) return send(res, 403, {error:'forbidden'});
  try { send(res, 200, readFileSync(file), MIME[extname(file)] ?? 'application/octet-stream'); }
  catch { send(res, 404, {error:'not found'}); }
}

export async function startUiServer({ dbPath, port = 4173, host = '127.0.0.1' }) {
  const lease = acquireWorkspaceLock(dbPath, { runtime: 'node-ui-server' });
  let released = false;
  const release = () => {
    if (released) return false;
    released = true;
    return lease.release();
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      if (url.pathname === '/api/health') return send(res, 200, {ok:true, product:'HarnessScope'});
      if (url.pathname === '/api/sessions' && req.method === 'GET') {
        return send(res, 200, withDb(dbPath, (db) => listSessions(db)));
      }
      const match = url.pathname.match(/^\/api\/session\/([^/]+)$/);
      if (match && req.method === 'GET') {
        const id = decodeURIComponent(match[1]);
        const data = withDb(dbPath, (db) => ({ session:getSession(db,id), events:listEvents(db,id), findings:listFindings(db,id) }));
        if (!data.session) return send(res, 404, {error:'session not found'});
        return send(res, 200, data);
      }
      const inferMatch = url.pathname.match(/^\/api\/session\/([^/]+)\/infer$/);
      if (inferMatch && req.method === 'POST') {
        const id = decodeURIComponent(inferMatch[1]);
        const findings = withDb(dbPath, (db) => {
          if (!getSession(db,id)) return null;
          const out = inferFindings(listEvents(db,id));
          replaceFindings(db,id,out);
          return listFindings(db,id);
        });
        if (!findings) return send(res, 404, {error:'session not found'});
        return send(res, 200, {findings});
      }
      if (url.pathname.startsWith('/api/')) return send(res, 404, {error:'not found'});
      serveStatic(url.pathname, res);
    } catch (error) {
      send(res, 500, {error:error.message});
    }
  });

  server.once('close', release);
  try {
    await new Promise((resolvePromise, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolvePromise);
    });
  } catch (error) {
    release();
    throw error;
  }

  const address = server.address();
  return {
    port: typeof address === 'object' && address ? address.port : port,
    close: () => new Promise((resolvePromise) => server.close(resolvePromise)),
    server
  };
}
