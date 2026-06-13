//! tabs.rs — Document tabs + draft-tree operations (#160).
//!
//! A document holds an ordered list of tabs; each draft-type tab holds a
//! tree of drafts (parent_draft_id links). Events and snapshots stay
//! draft-scoped — forking plants the parent's serialized state as a
//! labeled "Branch point" snapshot on the child, so each draft keeps an
//! independent event log.
//!
//! Structural operations are reversible: tab/draft deletion is a soft
//! delete (`deleted_at`), and every operation is recorded in the
//! document-level `doc_events` audit log so the version history can
//! show — and restore — tab CRUD and draft branching.

use rusqlite::{params, Connection, OptionalExtension, Result};
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use super::{DocEventRecord, DraftMeta, TabMeta};

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

// ── Document-level audit log ──────────────────────────────────────

/// Appends one entry to the document's structural audit log (#160:
/// "version history is document-wide"). Payload is a JSON object with
/// camelCase keys, consumed verbatim by the version-history timeline.
pub fn log_doc_event(
    conn: &Connection,
    doc_id: &str,
    event_type: &str,
    payload: &serde_json::Value,
) -> Result<()> {
    conn.execute(
        "INSERT INTO doc_events (document_id, event_type, payload, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![doc_id, event_type, payload.to_string(), now_ms()],
    )?;
    Ok(())
}

pub fn list_doc_events(conn: &Connection, doc_id: &str) -> Result<Vec<DocEventRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, document_id, event_type, payload, created_at
         FROM doc_events WHERE document_id = ?1 ORDER BY id DESC",
    )?;
    let rows = stmt.query_map(params![doc_id], |row| {
        Ok(DocEventRecord {
            id: row.get(0)?,
            document_id: row.get(1)?,
            event_type: row.get(2)?,
            payload: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;
    rows.collect()
}

// ── Tabs ──────────────────────────────────────────────────────────

pub fn list_tabs(conn: &Connection, doc_id: &str) -> Result<Vec<TabMeta>> {
    let mut stmt = conn.prepare(
        "SELECT id, document_id, tab_type, label, position, created_at
         FROM tabs WHERE document_id = ?1 AND deleted_at IS NULL
         ORDER BY position ASC, created_at ASC",
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
    log_doc_event(
        &tx,
        doc_id,
        "tab_created",
        &json!({ "tabId": tab_id, "label": label }),
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
    let (doc_id, previous): (String, String) = conn.query_row(
        "SELECT document_id, label FROM tabs WHERE id = ?1",
        params![tab_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE tabs SET label = ?1 WHERE id = ?2",
        params![label, tab_id],
    )?;
    log_doc_event(
        &tx,
        &doc_id,
        "tab_renamed",
        &json!({ "tabId": tab_id, "label": label, "previousLabel": previous }),
    )?;
    tx.commit()?;
    Ok(())
}

/// Soft-deletes a tab. Its drafts, events, and snapshots are untouched —
/// the tab disappears from the bar but can be restored from the
/// document's version history. Refuses to delete the last live tab.
pub fn delete_tab(conn: &Connection, tab_id: &str) -> Result<()> {
    let (doc_id, label): (String, String) = conn.query_row(
        "SELECT document_id, label FROM tabs WHERE id = ?1",
        params![tab_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let live: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tabs WHERE document_id = ?1 AND deleted_at IS NULL",
        params![doc_id],
        |row| row.get(0),
    )?;
    if live <= 1 {
        return Err(refuse("Cannot delete the last tab of a document"));
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE tabs SET deleted_at = ?1 WHERE id = ?2",
        params![now_ms(), tab_id],
    )?;
    log_doc_event(
        &tx,
        &doc_id,
        "tab_deleted",
        &json!({ "tabId": tab_id, "label": label }),
    )?;
    tx.commit()?;
    Ok(())
}

/// Restores a soft-deleted tab (from the version history or undo toast).
pub fn restore_tab(conn: &Connection, tab_id: &str) -> Result<()> {
    let (doc_id, label): (String, String) = conn.query_row(
        "SELECT document_id, label FROM tabs WHERE id = ?1",
        params![tab_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE tabs SET deleted_at = NULL WHERE id = ?1",
        params![tab_id],
    )?;
    log_doc_event(
        &tx,
        &doc_id,
        "tab_restored",
        &json!({ "tabId": tab_id, "label": label }),
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
    // Validate the persisted id still points at a live tab of this document.
    if let Some(id) = tab_id {
        let valid: Option<String> = conn
            .query_row(
                "SELECT id FROM tabs WHERE id = ?1 AND document_id = ?2 AND deleted_at IS NULL",
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
        "SELECT {DRAFT_COLS} FROM drafts
         WHERE tab_id = ?1 AND deleted_at IS NULL ORDER BY created_at ASC",
    ))?;
    let rows = stmt.query_map(params![tab_id], read_draft)?;
    rows.collect()
}

/// Forks a draft: creates a child draft seeded with the parent's current
/// state (passed in serialized, since event replay happens in the frontend).
/// Branches remain unlocked by default.
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
    log_doc_event(
        &tx,
        &doc_id,
        "draft_forked",
        &json!({
            "draftId": draft_id,
            "label": label,
            "parentDraftId": parent_draft_id,
            "tabId": tab_id,
        }),
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

/// Creates a root-level draft in a tab (a sibling of "main"), optionally
/// seeded with serialized state. Powers "+ New draft" for root drafts,
/// where there is no parent to fork from. The caller locks the source draft
/// when a previous sibling should be preserved.
pub fn create_tab_draft(
    conn: &Connection,
    tab_id: &str,
    label: &str,
    state_json: Option<&str>,
) -> Result<DraftMeta> {
    let doc_id: String = conn.query_row(
        "SELECT document_id FROM tabs WHERE id = ?1",
        params![tab_id],
        |row| row.get(0),
    )?;
    let draft_id = Uuid::new_v4().to_string();
    let now = now_ms();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO drafts (id, document_id, tab_id, label, created_at, is_active, locked)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, 0)",
        params![draft_id, doc_id, tab_id, label, now],
    )?;
    if let Some(json) = state_json {
        tx.execute(
            "INSERT INTO snapshots (draft_id, up_to_event_id, state_json, created_at, label)
             VALUES (?1, -1, ?2, ?3, 'Branch point')",
            params![draft_id, json, now],
        )?;
    }
    log_doc_event(
        &tx,
        &doc_id,
        "draft_created",
        &json!({ "draftId": draft_id, "label": label, "tabId": tab_id }),
    )?;
    tx.commit()?;
    Ok(DraftMeta {
        id: draft_id,
        document_id: doc_id,
        label: label.to_string(),
        created_at: now,
        is_active: true,
        tab_id: Some(tab_id.to_string()),
        parent_draft_id: None,
        locked: false,
    })
}

pub fn rename_draft(conn: &Connection, draft_id: &str, label: &str) -> Result<()> {
    let (doc_id, previous): (String, String) = conn.query_row(
        "SELECT document_id, label FROM drafts WHERE id = ?1",
        params![draft_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE drafts SET label = ?1 WHERE id = ?2",
        params![label, draft_id],
    )?;
    log_doc_event(
        &tx,
        &doc_id,
        "draft_renamed",
        &json!({ "draftId": draft_id, "label": label, "previousLabel": previous }),
    )?;
    tx.commit()?;
    Ok(())
}

pub fn set_draft_locked(conn: &Connection, draft_id: &str, locked: bool) -> Result<()> {
    let (doc_id, label): (String, String) = conn.query_row(
        "SELECT document_id, label FROM drafts WHERE id = ?1",
        params![draft_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE drafts SET locked = ?1 WHERE id = ?2",
        params![locked as i64, draft_id],
    )?;
    log_doc_event(
        &tx,
        &doc_id,
        if locked {
            "draft_locked"
        } else {
            "draft_unlocked"
        },
        &json!({ "draftId": draft_id, "label": label }),
    )?;
    tx.commit()?;
    Ok(())
}

/// Soft-deletes a leaf draft. Its events and snapshots are untouched, so
/// restoring from the version history brings the text back exactly.
/// Refuses if the draft has live children or is the tab's last live draft.
pub fn delete_draft(conn: &Connection, draft_id: &str) -> Result<()> {
    let (doc_id, label, tab_id): (String, String, Option<String>) = conn.query_row(
        "SELECT document_id, label, tab_id FROM drafts WHERE id = ?1",
        params![draft_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    let live_children: i64 = conn.query_row(
        "SELECT COUNT(*) FROM drafts WHERE parent_draft_id = ?1 AND deleted_at IS NULL",
        params![draft_id],
        |row| row.get(0),
    )?;
    if live_children > 0 {
        return Err(refuse("Cannot delete a draft that has branches"));
    }
    if let Some(ref tab) = tab_id {
        let live_siblings: i64 = conn.query_row(
            "SELECT COUNT(*) FROM drafts WHERE tab_id = ?1 AND deleted_at IS NULL",
            params![tab],
            |row| row.get(0),
        )?;
        if live_siblings <= 1 {
            return Err(refuse("Cannot delete the last draft of a tab"));
        }
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE drafts SET deleted_at = ?1 WHERE id = ?2",
        params![now_ms(), draft_id],
    )?;
    log_doc_event(
        &tx,
        &doc_id,
        "draft_deleted",
        &json!({ "draftId": draft_id, "label": label, "tabId": tab_id }),
    )?;
    tx.commit()?;
    Ok(())
}

/// Restores a soft-deleted draft without changing any related lock state.
pub fn restore_draft(conn: &Connection, draft_id: &str) -> Result<()> {
    let (doc_id, label): (String, String) = conn.query_row(
        "SELECT document_id, label FROM drafts WHERE id = ?1",
        params![draft_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE drafts SET deleted_at = NULL WHERE id = ?1",
        params![draft_id],
    )?;
    log_doc_event(
        &tx,
        &doc_id,
        "draft_restored",
        &json!({ "draftId": draft_id, "label": label }),
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
                "SELECT id FROM drafts WHERE id = ?1 AND tab_id = ?2 AND deleted_at IS NULL",
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
