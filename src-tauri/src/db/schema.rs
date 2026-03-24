use rusqlite::{Connection, Result};
use std::path::Path;

pub fn open_db(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;",
    )?;
    init_schema(&conn)?;
    // Migration: add label column to snapshots if it doesn't exist yet.
    let label_exists = {
        let mut stmt = conn.prepare("PRAGMA table_info(snapshots)")?;
        let result = stmt.query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|res| res.ok())
            .any(|name| name == "label");
        result
    };
    if !label_exists {
        conn.execute(
            "ALTER TABLE snapshots ADD COLUMN label TEXT DEFAULT NULL",
            [],
        )?;
    }
    Ok(conn)
}

pub fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS documents (
            id           TEXT PRIMARY KEY,
            title        TEXT NOT NULL DEFAULT 'Untitled',
            created_at   INTEGER NOT NULL,
            updated_at   INTEGER NOT NULL,
            word_count   INTEGER NOT NULL DEFAULT 0,
            preview_text TEXT NOT NULL DEFAULT '',
            tags         TEXT NOT NULL DEFAULT '[]',
            deleted_at   INTEGER DEFAULT NULL
        );

        CREATE TABLE IF NOT EXISTS drafts (
            id          TEXT PRIMARY KEY,
            document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            label       TEXT NOT NULL DEFAULT 'Draft',
            created_at  INTEGER NOT NULL,
            is_active   INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS events (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            draft_id   TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
            event_type TEXT NOT NULL,
            payload    TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS snapshots (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            draft_id         TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
            up_to_event_id   INTEGER NOT NULL,
            state_json       TEXT NOT NULL,
            created_at       INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS _meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_events_draft ON events(draft_id, id);
        CREATE INDEX IF NOT EXISTS idx_snapshots_draft ON snapshots(draft_id, up_to_event_id DESC);
        ",
    )?;
    Ok(())
}
