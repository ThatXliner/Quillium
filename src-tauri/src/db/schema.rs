use rusqlite::{Connection, Result};
use std::path::Path;

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let exists = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|res| res.ok())
        .any(|name| name == column);
    Ok(exists)
}

pub fn open_db(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;",
    )?;
    init_schema(&conn)?;
    // Migration: add label column to snapshots if it doesn't exist yet.
    if !column_exists(&conn, "snapshots", "label")? {
        conn.execute(
            "ALTER TABLE snapshots ADD COLUMN label TEXT DEFAULT NULL",
            [],
        )?;
    }
    migrate_tabs_and_draft_tree(&conn)?;
    Ok(conn)
}

/// Migration for the document-tabs + draft-branching model (#160):
/// adds tree/lock columns to drafts and attaches pre-existing drafts
/// to a default "Main" tab per document. Idempotent (pub for tests).
pub fn migrate_tabs_and_draft_tree(conn: &Connection) -> Result<()> {
    if !column_exists(conn, "drafts", "tab_id")? {
        conn.execute(
            "ALTER TABLE drafts ADD COLUMN tab_id TEXT DEFAULT NULL REFERENCES tabs(id) ON DELETE CASCADE",
            [],
        )?;
    }
    if !column_exists(conn, "drafts", "parent_draft_id")? {
        conn.execute(
            "ALTER TABLE drafts ADD COLUMN parent_draft_id TEXT DEFAULT NULL REFERENCES drafts(id) ON DELETE SET NULL",
            [],
        )?;
    }
    if !column_exists(conn, "drafts", "locked")? {
        conn.execute(
            "ALTER TABLE drafts ADD COLUMN locked INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    // Soft-delete markers: tab/draft deletion must be reversible from the
    // document-level version history (#160), so rows are never destroyed.
    if !column_exists(conn, "tabs", "deleted_at")? {
        conn.execute(
            "ALTER TABLE tabs ADD COLUMN deleted_at INTEGER DEFAULT NULL",
            [],
        )?;
    }
    if !column_exists(conn, "drafts", "deleted_at")? {
        conn.execute(
            "ALTER TABLE drafts ADD COLUMN deleted_at INTEGER DEFAULT NULL",
            [],
        )?;
    }
    // Index lives here (not init_schema) because tab_id is ALTER-added above.
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_drafts_tab ON drafts(tab_id)",
        [],
    )?;

    // Backfill: every draft must live in a tab. Collect documents that
    // still have orphan drafts and give each one a "Main" tab.
    let doc_ids: Vec<String> = {
        let mut stmt =
            conn.prepare("SELECT DISTINCT document_id FROM drafts WHERE tab_id IS NULL")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>>>()?
    };
    for doc_id in doc_ids {
        let existing_tab: Option<String> = conn
            .query_row(
                "SELECT id FROM tabs WHERE document_id = ?1 AND deleted_at IS NULL
                 ORDER BY position ASC LIMIT 1",
                rusqlite::params![doc_id],
                |row| row.get(0),
            )
            .ok();
        let tab_id = match existing_tab {
            Some(id) => id,
            None => {
                let id = uuid::Uuid::new_v4().to_string();
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as i64;
                conn.execute(
                    "INSERT INTO tabs (id, document_id, tab_type, label, position, created_at)
                     VALUES (?1, ?2, 'draft', 'Main', 0, ?3)",
                    rusqlite::params![id, doc_id, now],
                )?;
                id
            }
        };
        conn.execute(
            "UPDATE drafts SET tab_id = ?1 WHERE document_id = ?2 AND tab_id IS NULL",
            rusqlite::params![tab_id, doc_id],
        )?;
    }
    Ok(())
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

        CREATE TABLE IF NOT EXISTS tabs (
            id          TEXT PRIMARY KEY,
            document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            tab_type    TEXT NOT NULL DEFAULT 'draft',
            label       TEXT NOT NULL DEFAULT 'Main',
            position    INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL
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
            created_at       INTEGER NOT NULL,
            label            TEXT DEFAULT NULL
        );

        CREATE TABLE IF NOT EXISTS _meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS doc_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            event_type  TEXT NOT NULL,
            payload     TEXT NOT NULL,
            created_at  INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_events_draft ON events(draft_id, id);
        CREATE INDEX IF NOT EXISTS idx_snapshots_draft ON snapshots(draft_id, up_to_event_id DESC);
        CREATE INDEX IF NOT EXISTS idx_tabs_document ON tabs(document_id, position ASC);
        CREATE INDEX IF NOT EXISTS idx_doc_events_document ON doc_events(document_id, id DESC);
        ",
    )?;
    Ok(())
}
