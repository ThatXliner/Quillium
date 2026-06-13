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
        branched_from: row.get(7)?,
        locked: row.get::<_, i64>(8)? != 0,
    })
}

const DRAFT_COLS: &str =
    "id, document_id, label, created_at, is_active, tab_id, parent_draft_id, branched_from, locked";

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

/// Walks up `parent_draft_id` from `draft_id` to the run head — the draft
/// in the same iteration chain that is itself not an iteration (`main` or a
/// branch root). A "run" is one flat iteration line; branches start new runs.
fn run_head(conn: &Connection, draft_id: &str) -> Result<String> {
    let mut current = draft_id.to_string();
    loop {
        let parent: Option<String> = conn.query_row(
            "SELECT parent_draft_id FROM drafts WHERE id = ?1",
            params![current],
            |row| row.get(0),
        )?;
        match parent {
            Some(p) => current = p,
            None => return Ok(current),
        }
    }
}

/// Re-derives lock state for the iteration run containing `member`: every
/// live draft in the run is locked except the newest (the live tip), which
/// is the only editable one. Idempotent; called after iterate/delete/restore.
/// A run is the chain of `parent_draft_id` links sharing one head, so each
/// branch line locks independently (#160).
fn relock_run(conn: &Connection, member: &str) -> Result<()> {
    let head = run_head(conn, member)?;
    // Collect the live run in iteration order by following children down.
    let mut chain: Vec<(String, i64)> = Vec::new();
    let mut current = Some(head);
    while let Some(id) = current {
        let live: Option<i64> = conn
            .query_row(
                "SELECT created_at FROM drafts WHERE id = ?1 AND deleted_at IS NULL",
                params![id],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(created_at) = live {
            chain.push((id.clone(), created_at));
        }
        // Follow the single iteration child (a run is linear by construction).
        current = conn
            .query_row(
                "SELECT id FROM drafts WHERE parent_draft_id = ?1 AND deleted_at IS NULL
                 ORDER BY created_at ASC LIMIT 1",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
    }
    if chain.is_empty() {
        return Ok(());
    }
    // Tip = newest live draft in the run; everything else locks.
    let tip = chain
        .iter()
        .max_by_key(|(_, created_at)| *created_at)
        .map(|(id, _)| id.clone())
        .unwrap();
    for (id, _) in &chain {
        let locked = *id != tip;
        conn.execute(
            "UPDATE drafts SET locked = ?1 WHERE id = ?2",
            params![locked as i64, id],
        )?;
    }
    Ok(())
}

fn insert_draft(
    conn: &Connection,
    draft_id: &str,
    doc_id: &str,
    tab_id: &Option<String>,
    parent_draft_id: Option<&str>,
    branched_from: Option<&str>,
    label: &str,
    now: i64,
    state_json: Option<&str>,
) -> Result<()> {
    conn.execute(
        "INSERT INTO drafts
         (id, document_id, tab_id, parent_draft_id, branched_from, label, created_at, is_active, locked)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, 0)",
        params![draft_id, doc_id, tab_id, parent_draft_id, branched_from, label, now],
    )?;
    if let Some(json) = state_json {
        // Labeled snapshot: exempt from auto-prune, so the seed state can
        // never be garbage-collected out from under the new draft.
        conn.execute(
            "INSERT INTO snapshots (draft_id, up_to_event_id, state_json, created_at, label)
             VALUES (?1, -1, ?2, ?3, 'Branch point')",
            params![draft_id, json, now],
        )?;
    }
    Ok(())
}

/// Iterate: the common "next version" action. Creates the next draft in
/// `source`'s iteration run (linked by `parent_draft_id`, rendered flat),
/// seeded from `source`'s state. The run relocks so only the new tip is
/// editable; superseded iterations lock.
pub fn iterate_draft(
    conn: &Connection,
    source_draft_id: &str,
    label: &str,
    state_json: Option<&str>,
) -> Result<DraftMeta> {
    let (doc_id, tab_id): (String, Option<String>) = conn.query_row(
        "SELECT document_id, tab_id FROM drafts WHERE id = ?1",
        params![source_draft_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let draft_id = Uuid::new_v4().to_string();
    let now = now_ms();
    let tx = conn.unchecked_transaction()?;
    insert_draft(
        &tx,
        &draft_id,
        &doc_id,
        &tab_id,
        Some(source_draft_id),
        None,
        label,
        now,
        state_json,
    )?;
    relock_run(&tx, &draft_id)?;
    log_doc_event(
        &tx,
        &doc_id,
        "draft_iterated",
        &json!({
            "draftId": draft_id,
            "label": label,
            "parentDraftId": source_draft_id,
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
        parent_draft_id: Some(source_draft_id.to_string()),
        branched_from: None,
        locked: false,
    })
}

/// Branch: the rarer "different take" action. Creates a new run rooted off
/// `source` (linked by `branched_from`, rendered indented), seeded from
/// `source`'s state. Nothing locks — both the source and the branch stay
/// live, parallel explorations. Refused on a run head (`main` / branch root,
/// `parent_draft_id IS NULL`): a top-level take is a new tab.
pub fn branch_draft(
    conn: &Connection,
    source_draft_id: &str,
    label: &str,
    state_json: Option<&str>,
) -> Result<DraftMeta> {
    let (doc_id, tab_id, parent): (String, Option<String>, Option<String>) = conn.query_row(
        "SELECT document_id, tab_id, parent_draft_id FROM drafts WHERE id = ?1",
        params![source_draft_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    if parent.is_none() {
        return Err(refuse(
            "Can't branch from a top-level draft — create a new tab instead",
        ));
    }
    let draft_id = Uuid::new_v4().to_string();
    let now = now_ms();
    let tx = conn.unchecked_transaction()?;
    insert_draft(
        &tx,
        &draft_id,
        &doc_id,
        &tab_id,
        None,
        Some(source_draft_id),
        label,
        now,
        state_json,
    )?;
    log_doc_event(
        &tx,
        &doc_id,
        "draft_branched",
        &json!({
            "draftId": draft_id,
            "label": label,
            "branchedFrom": source_draft_id,
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
        parent_draft_id: None,
        branched_from: Some(source_draft_id.to_string()),
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
/// Refuses if the draft has live iterations or branches off it, or is the
/// tab's last live draft. The draft's run relocks (the tip may move back).
pub fn delete_draft(conn: &Connection, draft_id: &str) -> Result<()> {
    let (doc_id, label, tab_id, parent_draft_id): (String, String, Option<String>, Option<String>) =
        conn.query_row(
            "SELECT document_id, label, tab_id, parent_draft_id FROM drafts WHERE id = ?1",
            params![draft_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
    // A leaf has no live iteration after it and nothing branched off it.
    let live_descendants: i64 = conn.query_row(
        "SELECT COUNT(*) FROM drafts
         WHERE (parent_draft_id = ?1 OR branched_from = ?1) AND deleted_at IS NULL",
        params![draft_id],
        |row| row.get(0),
    )?;
    if live_descendants > 0 {
        return Err(refuse(
            "Cannot delete a draft that has iterations or branches",
        ));
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
    // The run this draft belonged to may have a new tip now. Relock from the
    // parent (the deleted draft is gone; its parent is still in the run).
    if let Some(ref parent) = parent_draft_id {
        relock_run(&tx, parent)?;
    }
    log_doc_event(
        &tx,
        &doc_id,
        "draft_deleted",
        &json!({ "draftId": draft_id, "label": label, "tabId": tab_id }),
    )?;
    tx.commit()?;
    Ok(())
}

/// Restores a soft-deleted draft. Its run relocks (the restored draft may
/// reclaim or yield the tip), so lock state stays consistent.
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
    relock_run(&tx, draft_id)?;
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
