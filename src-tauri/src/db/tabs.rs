//! tabs.rs — Document tabs + draft-tree operations (#160).
//!
//! A document holds an ordered list of tabs; each draft-type tab holds a
//! tree of drafts (parent_draft_id links). Events and snapshots stay
//! draft-scoped — forking plants the parent's serialized state as a
//! labeled "Branch point" snapshot on the child, so each draft keeps an
//! independent event log.

use rusqlite::{params, Connection, OptionalExtension, Result};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use super::{DraftMeta, TabMeta};

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

/// Builds a constraint-style error carrying a human-readable message,
/// which the command layer surfaces via `e.to_string()`.
fn refuse(msg: &str) -> rusqlite::Error {
    rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
        Some(msg.to_string()),
    )
}

fn read_tab(row: &rusqlite::Row) -> rusqlite::Result<TabMeta> {
    Ok(TabMeta {
        id: row.get(0)?,
        document_id: row.get(1)?,
        tab_type: row.get(2)?,
        label: row.get(3)?,
        position: row.get(4)?,
        created_at: row.get(5)?,
    })
}

fn read_draft(row: &rusqlite::Row) -> rusqlite::Result<DraftMeta> {
    Ok(DraftMeta {
        id: row.get(0)?,
        document_id: row.get(1)?,
        label: row.get(2)?,
        created_at: row.get(3)?,
        is_active: row.get::<_, i64>(4)? != 0,
        tab_id: row.get(5)?,
        parent_draft_id: row.get(6)?,
        locked: row.get::<_, i64>(7)? != 0,
    })
}

const DRAFT_COLS: &str =
    "id, document_id, label, created_at, is_active, tab_id, parent_draft_id, locked";

// ── Tabs ──────────────────────────────────────────────────────────

pub fn list_tabs(conn: &Connection, doc_id: &str) -> Result<Vec<TabMeta>> {
    let mut stmt = conn.prepare(
        "SELECT id, document_id, tab_type, label, position, created_at
         FROM tabs WHERE document_id = ?1 ORDER BY position ASC, created_at ASC",
    )?;
    let rows = stmt.query_map(params![doc_id], read_tab)?;
    rows.collect()
}

/// Creates a tab plus its root draft ("main") atomically.
pub fn create_tab(conn: &Connection, doc_id: &str, label: &str) -> Result<TabMeta> {
    let tab_id = Uuid::new_v4().to_string();
    let draft_id = Uuid::new_v4().to_string();
    let now = now_ms();
    let tx = conn.unchecked_transaction()?;
    let position: i64 = tx.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM tabs WHERE document_id = ?1",
        params![doc_id],
        |row| row.get(0),
    )?;
    tx.execute(
        "INSERT INTO tabs (id, document_id, tab_type, label, position, created_at)
         VALUES (?1, ?2, 'draft', ?3, ?4, ?5)",
        params![tab_id, doc_id, label, position, now],
    )?;
    tx.execute(
        "INSERT INTO drafts (id, document_id, tab_id, label, created_at, is_active, locked)
         VALUES (?1, ?2, ?3, 'main', ?4, 1, 0)",
        params![draft_id, doc_id, tab_id, now],
    )?;
    tx.commit()?;
    Ok(TabMeta {
        id: tab_id,
        document_id: doc_id.to_string(),
        tab_type: "draft".to_string(),
        label: label.to_string(),
        position,
        created_at: now,
    })
}

pub fn rename_tab(conn: &Connection, tab_id: &str, label: &str) -> Result<()> {
    conn.execute(
        "UPDATE tabs SET label = ?1 WHERE id = ?2",
        params![label, tab_id],
    )?;
    Ok(())
}

/// Deletes a tab and all its drafts (events/snapshots cascade).
/// Refuses to delete a document's last tab.
pub fn delete_tab(conn: &Connection, tab_id: &str) -> Result<()> {
    let doc_id: String = conn.query_row(
        "SELECT document_id FROM tabs WHERE id = ?1",
        params![tab_id],
        |row| row.get(0),
    )?;
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tabs WHERE document_id = ?1",
        params![doc_id],
        |row| row.get(0),
    )?;
    if count <= 1 {
        return Err(refuse("Cannot delete the last tab of a document"));
    }
    let tx = conn.unchecked_transaction()?;
    // Explicit cleanup; the ALTER-added FK cascade also covers drafts.
    tx.execute(
        "DELETE FROM snapshots WHERE draft_id IN (SELECT id FROM drafts WHERE tab_id = ?1)",
        params![tab_id],
    )?;
    tx.execute(
        "DELETE FROM events WHERE draft_id IN (SELECT id FROM drafts WHERE tab_id = ?1)",
        params![tab_id],
    )?;
    tx.execute("DELETE FROM drafts WHERE tab_id = ?1", params![tab_id])?;
    tx.execute("DELETE FROM tabs WHERE id = ?1", params![tab_id])?;
    tx.execute(
        "DELETE FROM _meta WHERE key = ?1 OR (key LIKE 'active_tab:%' AND value = ?2)",
        params![format!("active_draft:{}", tab_id), tab_id],
    )?;
    tx.commit()?;
    Ok(())
}

pub fn get_active_tab(conn: &Connection, doc_id: &str) -> Result<Option<String>> {
    let key = format!("active_tab:{}", doc_id);
    let tab_id: Option<String> = conn
        .query_row(
            "SELECT value FROM _meta WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()?;
    // Validate the persisted id still exists for this document.
    if let Some(id) = tab_id {
        let valid: Option<String> = conn
            .query_row(
                "SELECT id FROM tabs WHERE id = ?1 AND document_id = ?2",
                params![id, doc_id],
                |row| row.get(0),
            )
            .optional()?;
        return Ok(valid);
    }
    Ok(None)
}

pub fn set_active_tab(conn: &Connection, doc_id: &str, tab_id: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO _meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![format!("active_tab:{}", doc_id), tab_id],
    )?;
    Ok(())
}

// ── Draft tree ────────────────────────────────────────────────────

pub fn list_tab_drafts(conn: &Connection, tab_id: &str) -> Result<Vec<DraftMeta>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {DRAFT_COLS} FROM drafts WHERE tab_id = ?1 ORDER BY created_at ASC",
    ))?;
    let rows = stmt.query_map(params![tab_id], read_draft)?;
    rows.collect()
}

/// Forks a draft: creates a child draft seeded with the parent's current
/// state (passed in serialized, since event replay happens in the frontend)
/// and locks the parent so the branched-from text stays stable.
pub fn fork_draft(
    conn: &Connection,
    parent_draft_id: &str,
    label: &str,
    state_json: Option<&str>,
) -> Result<DraftMeta> {
    let (doc_id, tab_id): (String, Option<String>) = conn.query_row(
        "SELECT document_id, tab_id FROM drafts WHERE id = ?1",
        params![parent_draft_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let draft_id = Uuid::new_v4().to_string();
    let now = now_ms();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO drafts (id, document_id, tab_id, parent_draft_id, label, created_at, is_active, locked)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 0)",
        params![draft_id, doc_id, tab_id, parent_draft_id, label, now],
    )?;
    if let Some(json) = state_json {
        // Labeled snapshot: exempt from auto-prune, so the branch base
        // can never be garbage-collected out from under the child.
        tx.execute(
            "INSERT INTO snapshots (draft_id, up_to_event_id, state_json, created_at, label)
             VALUES (?1, -1, ?2, ?3, 'Branch point')",
            params![draft_id, json, now],
        )?;
    }
    tx.execute(
        "UPDATE drafts SET locked = 1 WHERE id = ?1",
        params![parent_draft_id],
    )?;
    tx.commit()?;
    Ok(DraftMeta {
        id: draft_id,
        document_id: doc_id,
        label: label.to_string(),
        created_at: now,
        is_active: true,
        tab_id,
        parent_draft_id: Some(parent_draft_id.to_string()),
        locked: false,
    })
}

pub fn rename_draft(conn: &Connection, draft_id: &str, label: &str) -> Result<()> {
    conn.execute(
        "UPDATE drafts SET label = ?1 WHERE id = ?2",
        params![label, draft_id],
    )?;
    Ok(())
}

pub fn set_draft_locked(conn: &Connection, draft_id: &str, locked: bool) -> Result<()> {
    conn.execute(
        "UPDATE drafts SET locked = ?1 WHERE id = ?2",
        params![locked as i64, draft_id],
    )?;
    Ok(())
}

/// Deletes a leaf draft. Refuses if the draft has children or is the
/// last draft in its tab.
pub fn delete_draft(conn: &Connection, draft_id: &str) -> Result<()> {
    let children: i64 = conn.query_row(
        "SELECT COUNT(*) FROM drafts WHERE parent_draft_id = ?1",
        params![draft_id],
        |row| row.get(0),
    )?;
    if children > 0 {
        return Err(refuse("Cannot delete a draft that has branches"));
    }
    let tab_id: Option<String> = conn.query_row(
        "SELECT tab_id FROM drafts WHERE id = ?1",
        params![draft_id],
        |row| row.get(0),
    )?;
    if let Some(ref tab) = tab_id {
        let siblings: i64 = conn.query_row(
            "SELECT COUNT(*) FROM drafts WHERE tab_id = ?1",
            params![tab],
            |row| row.get(0),
        )?;
        if siblings <= 1 {
            return Err(refuse("Cannot delete the last draft of a tab"));
        }
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM snapshots WHERE draft_id = ?1",
        params![draft_id],
    )?;
    tx.execute("DELETE FROM events WHERE draft_id = ?1", params![draft_id])?;
    tx.execute("DELETE FROM drafts WHERE id = ?1", params![draft_id])?;
    tx.execute(
        "DELETE FROM _meta WHERE value = ?1 AND key LIKE 'active_draft:%'",
        params![draft_id],
    )?;
    tx.commit()?;
    Ok(())
}

pub fn get_active_draft(conn: &Connection, tab_id: &str) -> Result<Option<String>> {
    let key = format!("active_draft:{}", tab_id);
    let draft_id: Option<String> = conn
        .query_row(
            "SELECT value FROM _meta WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(id) = draft_id {
        let valid: Option<String> = conn
            .query_row(
                "SELECT id FROM drafts WHERE id = ?1 AND tab_id = ?2",
                params![id, tab_id],
                |row| row.get(0),
            )
            .optional()?;
        return Ok(valid);
    }
    Ok(None)
}

pub fn set_active_draft(conn: &Connection, tab_id: &str, draft_id: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO _meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![format!("active_draft:{}", tab_id), draft_id],
    )?;
    Ok(())
}
