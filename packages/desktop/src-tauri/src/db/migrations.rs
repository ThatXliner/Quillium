//! migrations.rs — Versioned schema migration framework.
//!
//! Every schema change is a numbered entry in `MIGRATIONS`. `migrate()`
//! compares `PRAGMA user_version` against the list and applies anything
//! newer, each migration inside its own transaction (so a failed migration
//! leaves the DB at the previous version). To change the schema in the
//! future, append a new `Migration` with the next version number — never
//! edit an existing one, since shipped DBs have already recorded its
//! version as applied.
//!
//! A migration is either plain SQL (`MigrationKind::Sql`) or a Rust
//! function (`MigrationKind::Rust`) for data backfills and conditional DDL.
//!
//! Databases that predate this framework report `user_version = 0` but
//! already contain the baseline tables, so migrations 1–2 are written to
//! be safe to re-apply (`IF NOT EXISTS` / column-existence guards).

use rusqlite::{params, Connection, OptionalExtension, Result};

/// 0.22 release boundary. Documents created before 2026-07-14T00:00:00Z
/// retain Quillium's historical cross-restart undo behavior.
const LEGACY_PERSIST_HISTORY_CUTOFF_MS: i64 = 1_783_987_200_000;

pub enum MigrationKind {
    Sql(&'static str),
    Rust(fn(&Connection) -> Result<()>),
}

pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub kind: MigrationKind,
}

pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "baseline_schema",
        kind: MigrationKind::Sql(
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
        ),
    },
    Migration {
        version: 2,
        name: "snapshots_label",
        kind: MigrationKind::Rust(snapshots_label),
    },
    Migration {
        version: 3,
        name: "fts5_documents",
        kind: MigrationKind::Rust(fts5_documents),
    },
    Migration {
        version: 4,
        name: "backfill_body_text",
        kind: MigrationKind::Rust(backfill_body_text),
    },
    Migration {
        version: 5,
        name: "semantic_chunks",
        // Embedding dim must match embeddings::EMBEDDING_DIM (bge-small-en-v1.5).
        kind: MigrationKind::Sql(
            "
            CREATE TABLE IF NOT EXISTS chunks (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                chunk_index  INTEGER NOT NULL,
                content_hash TEXT NOT NULL,
                text         TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id, chunk_index);
            CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
                embedding float[384] distance_metric=cosine
            );
            ",
        ),
    },
    Migration {
        version: 6,
        name: "tabs_and_draft_tree",
        kind: MigrationKind::Rust(tabs_and_draft_tree),
    },
    Migration {
        version: 7,
        name: "draft_branch_relation",
        kind: MigrationKind::Rust(draft_branch_relation),
    },
    Migration {
        version: 8,
        name: "document_history_policy",
        kind: MigrationKind::Rust(document_history_policy),
    },
    Migration {
        version: 9,
        name: "grandfather_document_history_policy",
        kind: MigrationKind::Rust(grandfather_document_history_policy),
    },
    Migration {
        version: 10,
        name: "ai_conversations_and_profiles",
        kind: MigrationKind::Sql(
            "
            CREATE TABLE IF NOT EXISTS ai_conversations (
                draft_id      TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
                mode          TEXT NOT NULL CHECK (mode IN ('chat', 'feedback', 'revise')),
                messages_json TEXT NOT NULL DEFAULT '[]',
                updated_at    INTEGER NOT NULL,
                PRIMARY KEY (draft_id, mode)
            ) WITHOUT ROWID;

            CREATE TABLE IF NOT EXISTS document_ai_profiles (
                document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
                writer_brief TEXT NOT NULL DEFAULT '',
                updated_at  INTEGER NOT NULL
            ) WITHOUT ROWID;
            ",
        ),
    },
    Migration {
        version: 11,
        name: "document_editorial_decisions",
        kind: MigrationKind::Sql(
            "
            CREATE TABLE IF NOT EXISTS document_editorial_decisions (
                document_id   TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
                decisions_json TEXT NOT NULL DEFAULT '[]',
                updated_at     INTEGER NOT NULL
            ) WITHOUT ROWID;
            ",
        ),
    },
];

/// Applies all migrations newer than the DB's current `user_version`.
pub fn migrate(conn: &Connection) -> Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    for (i, m) in MIGRATIONS.iter().enumerate() {
        assert_eq!(
            m.version,
            i as i64 + 1,
            "MIGRATIONS must be consecutive starting at 1",
        );
        if m.version <= current {
            continue;
        }
        // unchecked_transaction: the db layer holds `&Connection` behind a
        // Mutex (see restore_to_snapshot for the long version of this note).
        let tx = conn.unchecked_transaction()?;
        match &m.kind {
            MigrationKind::Sql(sql) => tx.execute_batch(sql)?,
            MigrationKind::Rust(f) => f(&tx)?,
        }
        tx.pragma_update(None, "user_version", m.version)?;
        tx.commit()?;
    }
    Ok(())
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let exists = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|res| res.ok())
        .any(|name| name == column);
    Ok(exists)
}

fn snapshots_label(conn: &Connection) -> Result<()> {
    if !column_exists(conn, "snapshots", "label")? {
        conn.execute(
            "ALTER TABLE snapshots ADD COLUMN label TEXT DEFAULT NULL",
            [],
        )?;
    }
    Ok(())
}

/// Document tabs + draft branching (#160). Existing drafts are attached to
/// a default "Main" tab so pre-tabs documents keep loading through the new
/// active-tab/active-draft resolution path.
fn tabs_and_draft_tree(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS tabs (
            id          TEXT PRIMARY KEY,
            document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            tab_type    TEXT NOT NULL DEFAULT 'draft',
            label       TEXT NOT NULL DEFAULT 'Main',
            position    INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS doc_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            event_type  TEXT NOT NULL,
            payload     TEXT NOT NULL,
            created_at  INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_tabs_document ON tabs(document_id, position ASC);
        CREATE INDEX IF NOT EXISTS idx_doc_events_document ON doc_events(document_id, id DESC);
        ",
    )?;

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

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_drafts_tab ON drafts(tab_id)",
        [],
    )?;

    let doc_ids: Vec<String> = {
        let mut stmt =
            conn.prepare("SELECT DISTINCT document_id FROM drafts WHERE tab_id IS NULL")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>>>()?
    };

    for doc_id in doc_ids {
        let existing_tab = conn
            .query_row(
                "SELECT id FROM tabs WHERE document_id = ?1 AND deleted_at IS NULL
                 ORDER BY position ASC LIMIT 1",
                params![doc_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
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
                    params![id, doc_id, now],
                )?;
                id
            }
        };
        conn.execute(
            "UPDATE drafts SET tab_id = ?1 WHERE document_id = ?2 AND tab_id IS NULL",
            params![tab_id, doc_id],
        )?;
    }

    Ok(())
}

/// Splits the single draft-tree link into two relations (#160):
///   - `parent_draft_id` — the previous *iteration* (rendered as a flat run)
///   - `branched_from`    — the *branch* origin (rendered indented)
/// A draft sets at most one. Pre-existing children were created by the old
/// fork-as-child model, so their `parent_draft_id` link is reinterpreted as
/// a branch: move it to `branched_from` to preserve the existing tree shape.
fn draft_branch_relation(conn: &Connection) -> Result<()> {
    if !column_exists(conn, "drafts", "branched_from")? {
        conn.execute(
            "ALTER TABLE drafts ADD COLUMN branched_from TEXT DEFAULT NULL REFERENCES drafts(id) ON DELETE SET NULL",
            [],
        )?;
        // Old forks were children via parent_draft_id; they meant "branch".
        conn.execute(
            "UPDATE drafts SET branched_from = parent_draft_id, parent_draft_id = NULL
             WHERE parent_draft_id IS NOT NULL",
            [],
        )?;
    }
    Ok(())
}

/// Documents predating the 0.22 release keep cross-restart undo. Newer
/// documents explicitly set their policy at creation time, defaulting to the
/// safer session-only mode.
fn document_history_policy(conn: &Connection) -> Result<()> {
    if !column_exists(conn, "documents", "persist_history")? {
        conn.execute(
            "ALTER TABLE documents ADD COLUMN persist_history INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    Ok(())
}

/// Migration 9 is separate from the column addition so databases that already
/// ran migration 8 while dogfooding pre-release 0.22 still grandfather every
/// document created before the release boundary.
fn grandfather_document_history_policy(conn: &Connection) -> Result<()> {
    // Creation time is the temporary release-version proxy because legacy
    // documents do not record the app version that created them. The fixed UTC
    // boundary is deterministic across locales and migration dates.
    conn.execute(
        "UPDATE documents SET persist_history = 1 WHERE created_at < ?1",
        params![LEGACY_PERSIST_HISTORY_CUTOFF_MS],
    )?;
    Ok(())
}

/// Phase 1 of full-text search (#248): a denormalized `body_text` column on
/// `documents` plus an external-content FTS5 index kept in sync by triggers.
/// The UPDATE trigger fires only on the indexed columns so the per-keystroke
/// `updated_at` bump in append_event doesn't re-tokenize the document.
fn fts5_documents(conn: &Connection) -> Result<()> {
    if !column_exists(conn, "documents", "body_text")? {
        conn.execute(
            "ALTER TABLE documents ADD COLUMN body_text TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }
    conn.execute_batch(
        "
        CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
            title,
            body_text,
            tags,
            content='documents',
            content_rowid='rowid',
            tokenize='unicode61 remove_diacritics 2'
        );

        CREATE TRIGGER IF NOT EXISTS documents_fts_ai AFTER INSERT ON documents BEGIN
            INSERT INTO documents_fts(rowid, title, body_text, tags)
            VALUES (new.rowid, new.title, new.body_text, new.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS documents_fts_ad AFTER DELETE ON documents BEGIN
            INSERT INTO documents_fts(documents_fts, rowid, title, body_text, tags)
            VALUES ('delete', old.rowid, old.title, old.body_text, old.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS documents_fts_au
        AFTER UPDATE OF title, body_text, tags ON documents BEGIN
            INSERT INTO documents_fts(documents_fts, rowid, title, body_text, tags)
            VALUES ('delete', old.rowid, old.title, old.body_text, old.tags);
            INSERT INTO documents_fts(rowid, title, body_text, tags)
            VALUES (new.rowid, new.title, new.body_text, new.tags);
        END;

        INSERT INTO documents_fts(documents_fts) VALUES('rebuild');
        ",
    )?;
    Ok(())
}

/// One-time backfill of `documents.body_text` for documents created before
/// FTS existed. Reads each document's latest snapshot (snapshot-only — events
/// after the snapshot are missed, which self-heals on the next edit because
/// the live indexing path writes exact text). Corrupt or missing snapshots
/// are skipped rather than failing the migration.
fn backfill_body_text(conn: &Connection) -> Result<()> {
    let doc_ids: Vec<String> = conn
        .prepare("SELECT id FROM documents")?
        .query_map([], |row| row.get(0))?
        .filter_map(|res| res.ok())
        .collect();

    for doc_id in doc_ids {
        let Some(state_json) = latest_snapshot_json(conn, &doc_id)? else {
            continue;
        };
        let Some(text) = extract_doc_text(&state_json) else {
            continue;
        };
        // `body_text = ''` guard: never clobber text written by live indexing.
        conn.execute(
            "UPDATE documents SET body_text = ?1 WHERE id = ?2 AND body_text = ''",
            params![text, doc_id],
        )?;
    }
    Ok(())
}

/// Resolves the document's draft the same way load.rs does (explicit
/// `active_draft:{id}` _meta key, else first active draft) and returns the
/// latest snapshot's state_json.
fn latest_snapshot_json(conn: &Connection, doc_id: &str) -> Result<Option<String>> {
    let meta_key = format!("active_draft:{doc_id}");
    let draft_id: Option<String> = conn
        .query_row(
            "SELECT value FROM _meta WHERE key = ?1",
            params![meta_key],
            |row| row.get(0),
        )
        .optional()?
        .or(conn
            .query_row(
                "SELECT id FROM drafts WHERE document_id = ?1 AND is_active = 1
                 ORDER BY created_at ASC LIMIT 1",
                params![doc_id],
                |row| row.get(0),
            )
            .optional()?);
    let Some(draft_id) = draft_id else {
        return Ok(None);
    };
    conn.query_row(
        "SELECT state_json FROM snapshots WHERE draft_id = ?1
         ORDER BY up_to_event_id DESC LIMIT 1",
        params![draft_id],
        |row| row.get(0),
    )
    .optional()
}

/// Extracts the document text from a serialized CodeMirror EditorState.
/// `doc` is a plain string in current snapshots, but older code also typed
/// it as `string[]` (see Editor.svelte extractTitleFromStateJson) — handle both.
fn extract_doc_text(state_json: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(state_json).ok()?;
    match value.get("doc")? {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Array(lines) => Some(
            lines
                .iter()
                .filter_map(|l| l.as_str())
                .collect::<Vec<_>>()
                .join("\n"),
        ),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::open_db;

    #[test]
    fn fresh_db_reaches_latest_version() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_db(&dir.path().join("test.db")).unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.last().unwrap().version);
    }

    #[test]
    fn migrate_is_idempotent_on_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        {
            let conn = open_db(&path).unwrap();
            conn.execute(
                "INSERT INTO documents (id, title, created_at, updated_at) VALUES ('a', 'T', 0, 0)",
                [],
            )
            .unwrap();
        }
        // Re-opening runs migrate() again; must be a no-op, not an error.
        let conn = open_db(&path).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM documents", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn legacy_db_with_existing_schema_migrates_cleanly() {
        // Simulate a DB created before the migration framework existed:
        // baseline tables + label column already present, user_version = 0.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("legacy.db");
        {
            let conn = rusqlite::Connection::open(&path).unwrap();
            if let MigrationKind::Sql(sql) = &MIGRATIONS[0].kind {
                conn.execute_batch(sql).unwrap();
            }
            conn.execute(
                "ALTER TABLE snapshots ADD COLUMN label TEXT DEFAULT NULL",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO documents (id, title, created_at, updated_at, preview_text)
                 VALUES ('doc1', 'Old doc', 0, 0, 'preview')",
                [],
            )
            .unwrap();
        }
        let conn = open_db(&path).unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.last().unwrap().version);
        let persist_history: i64 = conn
            .query_row(
                "SELECT persist_history FROM documents WHERE id = 'doc1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(persist_history, 1);
        // FTS index was rebuilt from the existing row.
        let hits: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM documents_fts WHERE documents_fts MATCH '\"old\"'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(hits, 1);
    }

    #[test]
    fn document_history_policy_uses_release_cutoff() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        if let MigrationKind::Sql(sql) = &MIGRATIONS[0].kind {
            conn.execute_batch(sql).unwrap();
        }
        conn.execute(
            "INSERT INTO documents (id, created_at, updated_at) VALUES ('before', ?1, 0)",
            params![LEGACY_PERSIST_HISTORY_CUTOFF_MS - 1],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO documents (id, created_at, updated_at) VALUES ('at', ?1, 0)",
            params![LEGACY_PERSIST_HISTORY_CUTOFF_MS],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO documents (id, created_at, updated_at) VALUES ('after', ?1, 0)",
            params![LEGACY_PERSIST_HISTORY_CUTOFF_MS + 1],
        )
        .unwrap();

        document_history_policy(&conn).unwrap();
        grandfather_document_history_policy(&conn).unwrap();

        for (id, expected) in [("before", 1), ("at", 0), ("after", 0)] {
            let actual: i64 = conn
                .query_row(
                    "SELECT persist_history FROM documents WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(actual, expected, "unexpected policy for {id}");
        }
    }

    #[test]
    fn grandfathering_catches_documents_created_after_policy_column() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        if let MigrationKind::Sql(sql) = &MIGRATIONS[0].kind {
            conn.execute_batch(sql).unwrap();
        }
        document_history_policy(&conn).unwrap();
        conn.execute(
            "INSERT INTO documents (id, created_at, updated_at) VALUES ('late-legacy', ?1, 0)",
            params![LEGACY_PERSIST_HISTORY_CUTOFF_MS - 1],
        )
        .unwrap();

        grandfather_document_history_policy(&conn).unwrap();

        let actual: i64 = conn
            .query_row(
                "SELECT persist_history FROM documents WHERE id = 'late-legacy'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(actual, 1);
    }

    #[test]
    fn backfill_extracts_doc_text_from_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_db(&dir.path().join("test.db")).unwrap();
        conn.execute(
            "INSERT INTO documents (id, title, created_at, updated_at) VALUES ('d1', 'T', 0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO drafts (id, document_id, label, created_at, is_active)
             VALUES ('dr1', 'd1', 'Draft', 0, 1)",
            [],
        )
        .unwrap();
        let state = serde_json::json!({ "doc": "the quetzal hides in the canopy" });
        conn.execute(
            "INSERT INTO snapshots (draft_id, up_to_event_id, state_json, created_at)
             VALUES ('dr1', 1, ?1, 0)",
            params![state.to_string()],
        )
        .unwrap();

        backfill_body_text(&conn).unwrap();

        let body: String = conn
            .query_row(
                "SELECT body_text FROM documents WHERE id = 'd1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(body, "the quetzal hides in the canopy");
        // And the UPDATE trigger pushed it into FTS.
        let hits: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM documents_fts WHERE documents_fts MATCH '\"quetzal\"'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(hits, 1);
    }

    #[test]
    fn extract_doc_text_handles_string_and_array() {
        assert_eq!(
            extract_doc_text(r#"{"doc": "hello world"}"#),
            Some("hello world".to_string())
        );
        assert_eq!(
            extract_doc_text(r#"{"doc": ["line one", "line two"]}"#),
            Some("line one\nline two".to_string())
        );
        assert_eq!(extract_doc_text(r#"{"doc": 42}"#), None);
        assert_eq!(extract_doc_text("not json"), None);
    }
}
