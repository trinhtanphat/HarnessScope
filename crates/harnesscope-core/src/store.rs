use crate::{CoreError, Finding, Session, TraceEvent, TraceEventInput, redact_value};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;
use std::path::{Path, PathBuf};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

const SCHEMA: &str = r#"
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
"#;

fn now_utc() -> Result<String, CoreError> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|error| CoreError::Time(error.to_string()))
}

pub struct Workspace {
    conn: Connection,
    path: PathBuf,
}

impl Workspace {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, CoreError> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(&path)?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn, path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn create_session(&self, name: &str, mode: &str) -> Result<Session, CoreError> {
        let session = Session {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            mode: mode.to_string(),
            created_utc: now_utc()?,
        };
        self.conn.execute(
            "INSERT INTO sessions(id,name,mode,created_utc) VALUES(?1,?2,?3,?4)",
            params![
                session.id,
                session.name,
                session.mode,
                session.created_utc
            ],
        )?;
        Ok(session)
    }

    pub fn get_session(&self, id: &str) -> Result<Option<Session>, CoreError> {
        self.conn
            .query_row(
                "SELECT id,name,mode,created_utc FROM sessions WHERE id=?1",
                [id],
                |row| {
                    Ok(Session {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        mode: row.get(2)?,
                        created_utc: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(CoreError::from)
    }

    pub fn list_sessions(&self) -> Result<Vec<Session>, CoreError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id,name,mode,created_utc FROM sessions ORDER BY created_utc DESC")?;
        let rows = stmt.query_map([], |row| {
            Ok(Session {
                id: row.get(0)?,
                name: row.get(1)?,
                mode: row.get(2)?,
                created_utc: row.get(3)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    pub fn append_event(
        &self,
        session_id: &str,
        input: TraceEventInput,
    ) -> Result<TraceEvent, CoreError> {
        let redacted = redact_value(&input.data, "");
        let event = TraceEvent {
            id: input.id.unwrap_or_else(|| Uuid::new_v4().to_string()),
            session_id: session_id.to_string(),
            timestamp_utc: match input.timestamp_utc {
                Some(value) => value,
                None => now_utc()?,
            },
            source: input.source,
            kind: input.kind,
            correlation_id: input.correlation_id,
            data: redacted.value,
            redaction: if redacted.redacted || input.redaction.as_deref() == Some("redacted") {
                "redacted".to_string()
            } else {
                "none".to_string()
            },
        };
        let data_json = serde_json::to_string(&event.data)?;
        self.conn.execute(
            "INSERT INTO trace_events(id,session_id,timestamp_utc,source,kind,correlation_id,data_json,redaction)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                event.id,
                event.session_id,
                event.timestamp_utc,
                event.source,
                event.kind,
                event.correlation_id,
                data_json,
                event.redaction
            ],
        )?;
        Ok(event)
    }

    pub fn append_events(
        &self,
        session_id: &str,
        inputs: Vec<TraceEventInput>,
    ) -> Result<Vec<TraceEvent>, CoreError> {
        self.conn.execute_batch("BEGIN")?;
        let result = (|| {
            let mut stored = Vec::with_capacity(inputs.len());
            for input in inputs {
                stored.push(self.append_event(session_id, input)?);
            }
            Ok::<_, CoreError>(stored)
        })();
        match result {
            Ok(stored) => {
                self.conn.execute_batch("COMMIT")?;
                Ok(stored)
            }
            Err(error) => {
                let _ = self.conn.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    pub fn list_events(&self, session_id: &str) -> Result<Vec<TraceEvent>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id,session_id,timestamp_utc,source,kind,correlation_id,data_json,redaction
             FROM trace_events WHERE session_id=?1 ORDER BY seq ASC",
        )?;
        let rows = stmt.query_map([session_id], |row| {
            let data_json: String = row.get(6)?;
            let data = serde_json::from_str::<Value>(&data_json).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    data_json.len(),
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;
            Ok(TraceEvent {
                id: row.get(0)?,
                session_id: row.get(1)?,
                timestamp_utc: row.get(2)?,
                source: row.get(3)?,
                kind: row.get(4)?,
                correlation_id: row.get(5)?,
                data,
                redaction: row.get(7)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    pub fn replace_findings(
        &self,
        session_id: &str,
        findings: &[Finding],
    ) -> Result<(), CoreError> {
        self.conn.execute_batch("BEGIN")?;
        let result = (|| {
            let mut ids_stmt = self
                .conn
                .prepare("SELECT id FROM findings WHERE session_id=?1")?;
            let ids = ids_stmt
                .query_map([session_id], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            drop(ids_stmt);

            for id in ids {
                self.conn.execute(
                    "DELETE FROM finding_evidence WHERE finding_id=?1",
                    [id],
                )?;
            }
            self.conn
                .execute("DELETE FROM findings WHERE session_id=?1", [session_id])?;

            for finding in findings {
                let id = finding
                    .id
                    .clone()
                    .unwrap_or_else(|| Uuid::new_v4().to_string());
                self.conn.execute(
                    "INSERT INTO findings(id,session_id,title,category,confidence,statement)
                     VALUES(?1,?2,?3,?4,?5,?6)",
                    params![
                        id,
                        session_id,
                        finding.title,
                        finding.category,
                        finding.confidence,
                        finding.statement
                    ],
                )?;
                for event_id in &finding.evidence_event_ids {
                    self.conn.execute(
                        "INSERT OR IGNORE INTO finding_evidence(finding_id,event_id) VALUES(?1,?2)",
                        params![id, event_id],
                    )?;
                }
            }
            Ok::<_, CoreError>(())
        })();

        match result {
            Ok(()) => {
                self.conn.execute_batch("COMMIT")?;
                Ok(())
            }
            Err(error) => {
                let _ = self.conn.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    pub fn list_findings(&self, session_id: &str) -> Result<Vec<Finding>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id,session_id,title,category,confidence,statement
             FROM findings WHERE session_id=?1 ORDER BY confidence DESC, title",
        )?;
        let mut rows = stmt.query([session_id])?;
        let mut findings = Vec::new();
        while let Some(row) = rows.next()? {
            let id: String = row.get(0)?;
            let mut evidence_stmt = self.conn.prepare(
                "SELECT event_id FROM finding_evidence WHERE finding_id=?1 ORDER BY event_id",
            )?;
            let evidence_event_ids = evidence_stmt
                .query_map([&id], |evidence| evidence.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            findings.push(Finding {
                id: Some(id),
                session_id: Some(row.get(1)?),
                title: row.get(2)?,
                category: row.get(3)?,
                confidence: row.get(4)?,
                statement: row.get(5)?,
                evidence_event_ids,
            });
        }
        Ok(findings)
    }
}
