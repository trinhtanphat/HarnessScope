import { join } from 'node:path';
import {
  openWorkspace, createSession, getSession, listSessions, appendEvents,
  listEvents, replaceFindings, listFindings
} from '../../src/core/store.mjs';
import { inferFindings } from '../../src/core/infer.mjs';
import { compareSessions } from '../../src/core/compare.mjs';
import { exportSession } from '../../src/core/exporter.mjs';
import { importHar as readHar } from '../../src/importers/har.mjs';
import { importProcmon as readProcmon } from '../../src/importers/procmon.mjs';
import { importJsonl as readJsonl } from '../../src/importers/jsonl.mjs';
import { launchTarget } from '../../src/observe/launch.mjs';
import { DesktopError } from './errors.mjs';
import { assertSessionId, validateDialogFilters, validateLaunchRequest, validateSessionInput } from './validators.mjs';

function withDb(dbPath, fn) {
  const db = openWorkspace(dbPath);
  try { return fn(db); } finally { db.close(); }
}

async function withDbAsync(dbPath, fn) {
  const db = openWorkspace(dbPath);
  try { return await fn(db); } finally { db.close(); }
}

function requireSession(db, sessionId) {
  assertSessionId(sessionId);
  const session = getSession(db, sessionId);
  if (!session) throw new DesktopError('SESSION_NOT_FOUND', 'The selected session no longer exists.');
  return session;
}

function importResult(stored) {
  return { cancelled: false, imported: stored.length, kinds: [...new Set(stored.map((event) => event.kind))].sort() };
}

function wrapImport(error) {
  if (error instanceof DesktopError) throw error;
  throw new DesktopError('IMPORT_INVALID_FILE', 'The selected evidence file could not be imported.');
}

function safeName(value) {
  return String(value || 'session').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'session';
}

export function createDesktopServices({ dbPath, dialogs, appInfo, platform = process.platform }) {
  if (typeof dbPath !== 'string' || !dbPath) throw new TypeError('dbPath is required');
  const nativeDialogs = dialogs ?? {};
  const metadata = { name: appInfo?.name ?? 'HarnessScope', version: appInfo?.version ?? '0.0.0' };

  return {
    async appInfo() {
      return { ...metadata, platform };
    },

    async workspaceInfo() {
      return { dbPath };
    },

    async sessionList() {
      return withDb(dbPath, (db) => listSessions(db));
    },

    async sessionCreate(input) {
      const value = validateSessionInput(input);
      return withDb(dbPath, (db) => createSession(db, value.name, value.mode));
    },

    async timelineGet(sessionId) {
      return withDb(dbPath, (db) => {
        const session = requireSession(db, sessionId);
        return { session, events: listEvents(db, sessionId), findings: listFindings(db, sessionId) };
      });
    },

    async inferenceRun(sessionId) {
      return withDb(dbPath, (db) => {
        const session = requireSession(db, sessionId);
        const findings = inferFindings(listEvents(db, sessionId));
        replaceFindings(db, sessionId, findings);
        return { session, findings: listFindings(db, sessionId) };
      });
    },

    async compareRun(sessionA, sessionB) {
      return withDb(dbPath, (db) => {
        const load = (id) => {
          const session = requireSession(db, id);
          return { session, events: listEvents(db, id), findings: listFindings(db, id) };
        };
        return compareSessions(load(sessionA), load(sessionB));
      });
    },

    async importHar(sessionId, filePath = null) {
      assertSessionId(sessionId);
      const selected = filePath ?? await nativeDialogs.pickFile?.({ filters: [{ name: 'HTTP Archive', extensions: ['har'] }] });
      if (!selected) return { cancelled: true };
      try {
        return withDb(dbPath, (db) => {
          requireSession(db, sessionId);
          return importResult(appendEvents(db, sessionId, readHar(selected)));
        });
      } catch (error) { return wrapImport(error); }
    },

    async importProcmon(sessionId, filePath = null) {
      assertSessionId(sessionId);
      const selected = filePath ?? await nativeDialogs.pickFile?.({ filters: [{ name: 'Procmon CSV', extensions: ['csv'] }] });
      if (!selected) return { cancelled: true };
      try {
        return withDb(dbPath, (db) => {
          requireSession(db, sessionId);
          return importResult(appendEvents(db, sessionId, readProcmon(selected)));
        });
      } catch (error) { return wrapImport(error); }
    },

    async importJsonl(sessionId, filePath = null, mapPath = null) {
      assertSessionId(sessionId);
      const selected = filePath ?? await nativeDialogs.pickFile?.({ filters: [{ name: 'JSON Lines', extensions: ['jsonl', 'ndjson'] }] });
      if (!selected) return { cancelled: true };
      const selectedMap = mapPath ?? await nativeDialogs.pickFile?.({ filters: [{ name: 'YAML mapping', extensions: ['yaml', 'yml'] }] });
      if (!selectedMap) return { cancelled: true };
      try {
        return withDb(dbPath, (db) => {
          requireSession(db, sessionId);
          return importResult(appendEvents(db, sessionId, readJsonl(selected, selectedMap)));
        });
      } catch (error) { return wrapImport(error); }
    },

    async launchRun(sessionId, request) {
      assertSessionId(sessionId);
      const launch = validateLaunchRequest(request);
      return withDbAsync(dbPath, async (db) => {
        requireSession(db, sessionId);
        try {
          return await launchTarget({ db, sessionId, target: launch.target, args: launch.args, cwd: launch.cwd ?? process.cwd() });
        } catch {
          throw new DesktopError('LAUNCH_FAILED', 'The selected command could not be launched.');
        }
      });
    },

    async exportRun(sessionId, outDir = null) {
      assertSessionId(sessionId);
      const selected = outDir ?? await nativeDialogs.pickDirectory?.();
      if (!selected) return { cancelled: true };
      return withDb(dbPath, (db) => {
        const session = requireSession(db, sessionId);
        try {
          const target = outDir ? selected : join(selected, `HarnessScope-${safeName(session.name)}`);
          return { cancelled: false, ...exportSession({ db, sessionId, outDir: target }) };
        } catch {
          throw new DesktopError('EXPORT_FAILED', 'The behavioral spec could not be exported.');
        }
      });
    },

    async pickDirectory() {
      return await nativeDialogs.pickDirectory?.() ?? null;
    },

    async pickFile(filters) {
      return await nativeDialogs.pickFile?.({ filters: validateDialogFilters(filters) }) ?? null;
    }
  };
}
