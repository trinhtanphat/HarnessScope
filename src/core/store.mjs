import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { redactValue } from './redact.mjs';

function parseJson(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export function openWorkspace(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'unknown',
      created_utc TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trace_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT UNIQUE NOT NULL,
      session_id TEXT NOT NULL,
      timestamp_utc TEXT NOT NULL,
      source TEXT NOT NULL,
      kind TEXT NOT NULL,
      correlation_id TEXT,
      data_json TEXT NOT NULL,
      redaction TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS ix_trace_events_session_seq ON trace_events(session_id, seq);
    CREATE TABLE IF NOT EXISTS findings (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      confidence REAL NOT NULL,
      statement TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS finding_evidence (
      finding_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      PRIMARY KEY(finding_id, event_id),
      FOREIGN KEY(finding_id) REFERENCES findings(id) ON DELETE CASCADE,
      FOREIGN KEY(event_id) REFERENCES trace_events(id) ON DELETE CASCADE
    );
  `);
  return db;
}

export function createSession(db, name, mode = 'unknown') {
  const session = { id: randomUUID(), name, mode, createdUtc: new Date().toISOString() };
  db.prepare('INSERT INTO sessions(id,name,mode,created_utc) VALUES(?,?,?,?)')
    .run(session.id, session.name, session.mode, session.createdUtc);
  return session;
}

export function getSession(db, id) {
  const row = db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
  return row ? { id: row.id, name: row.name, mode: row.mode, createdUtc: row.created_utc } : null;
}

export function listSessions(db) {
  return db.prepare('SELECT * FROM sessions ORDER BY created_utc DESC').all()
    .map((row) => ({ id: row.id, name: row.name, mode: row.mode, createdUtc: row.created_utc }));
}

export function appendEvent(db, event) {
  const id = event.id ?? randomUUID();
  const redacted = redactValue(event.data ?? {});
  const normalized = {
    id,
    sessionId: event.sessionId,
    timestampUtc: event.timestampUtc ?? new Date().toISOString(),
    source: event.source ?? 'unknown',
    kind: event.kind ?? 'Unknown',
    correlationId: event.correlationId ?? null,
    data: redacted.value,
    redaction: (redacted.redacted || event.redaction === 'redacted') ? 'redacted' : 'none'
  };
  db.prepare(`INSERT INTO trace_events(id,session_id,timestamp_utc,source,kind,correlation_id,data_json,redaction)
              VALUES(?,?,?,?,?,?,?,?)`)
    .run(normalized.id, normalized.sessionId, normalized.timestampUtc, normalized.source, normalized.kind,
      normalized.correlationId, JSON.stringify(normalized.data), normalized.redaction);
  return normalized;
}

export function appendCollectorEvent(db, sessionId, eventInput) {
  return appendEvent(db, { ...eventInput, sessionId });
}

export function appendEvents(db, sessionId, events) {
  db.exec('BEGIN');
  try {
    const result = events.map((event) => appendEvent(db, { ...event, sessionId }));
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function listEvents(db, sessionId) {
  return db.prepare('SELECT * FROM trace_events WHERE session_id=? ORDER BY seq ASC').all(sessionId)
    .map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      timestampUtc: row.timestamp_utc,
      source: row.source,
      kind: row.kind,
      correlationId: row.correlation_id,
      data: parseJson(row.data_json, {}),
      redaction: row.redaction
    }));
}

export function replaceFindings(db, sessionId, findings) {
  db.exec('BEGIN');
  try {
    const ids = db.prepare('SELECT id FROM findings WHERE session_id=?').all(sessionId).map((r) => r.id);
    const delEvidence = db.prepare('DELETE FROM finding_evidence WHERE finding_id=?');
    for (const id of ids) delEvidence.run(id);
    db.prepare('DELETE FROM findings WHERE session_id=?').run(sessionId);
    const insertFinding = db.prepare('INSERT INTO findings(id,session_id,title,category,confidence,statement) VALUES(?,?,?,?,?,?)');
    const insertEvidence = db.prepare('INSERT OR IGNORE INTO finding_evidence(finding_id,event_id) VALUES(?,?)');
    for (const finding of findings) {
      const id = finding.id ?? randomUUID();
      insertFinding.run(id, sessionId, finding.title, finding.category, finding.confidence, finding.statement);
      for (const eventId of finding.evidenceEventIds ?? []) insertEvidence.run(id, eventId);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function listFindings(db, sessionId) {
  const evidenceStmt = db.prepare('SELECT event_id FROM finding_evidence WHERE finding_id=? ORDER BY event_id');
  return db.prepare('SELECT * FROM findings WHERE session_id=? ORDER BY confidence DESC, title').all(sessionId)
    .map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      title: row.title,
      category: row.category,
      confidence: row.confidence,
      statement: row.statement,
      evidenceEventIds: evidenceStmt.all(row.id).map((e) => e.event_id)
    }));
}
