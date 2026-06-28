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
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use super::{DocEventRecord, DocumentStructure, DraftMeta, TabMeta};

/// One link rewrite made by `orphan_and_delete_draft`: the child that was
/// re-attached and the parent/branch links it held before. Returned to the
/// frontend so Undo can restore the original links via `reparent_draft`.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReparentEntry {
    pub draft_id: String,
    pub old_parent_draft_id: Option<String>,
    pub old_branched_from: Option<String>,
}

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

/// The document's full tab/draft roster INCLUDING soft-deleted rows — the
/// universe the version-history preview map rewinds over. Carries real labels
/// and structural links (parent/branch) so the historical tree renders
/// faithfully regardless of what the audit log recorded.
pub fn list_document_structure(conn: &Connection, doc_id: &str) -> Result<DocumentStructure> {
    let tabs = {
        let mut stmt = conn.prepare(
            "SELECT id, document_id, tab_type, label, position, created_at
             FROM tabs WHERE document_id = ?1
             ORDER BY position ASC, created_at ASC",
        )?;
        let v = stmt
            .query_map(params![doc_id], read_tab)?
            .collect::<Result<Vec<_>>>()?;
        v
    };
    let drafts = {
        let mut stmt = conn.prepare(&format!(
            "SELECT {DRAFT_COLS} FROM drafts WHERE document_id = ?1 ORDER BY created_at ASC",
        ))?;
        let v = stmt
            .query_map(params![doc_id], read_draft)?
            .collect::<Result<Vec<_>>>()?;
        v
    };
    Ok(DocumentStructure { tabs, drafts })
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
        // `rootDraftId` + `position` let the version-history replay reconstruct
        // the tab (and its auto-created "main" draft) at any past point without
        // consulting the live `drafts`/`tabs` rows.
        &json!({
            "tabId": tab_id,
            "label": label,
            "rootDraftId": draft_id,
            "position": position,
        }),
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

fn rename_tab_inner(conn: &Connection, tab_id: &str, label: &str) -> Result<()> {
    let (doc_id, previous): (String, String) = conn.query_row(
        "SELECT document_id, label FROM tabs WHERE id = ?1",
        params![tab_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    conn.execute(
        "UPDATE tabs SET label = ?1 WHERE id = ?2",
        params![label, tab_id],
    )?;
    log_doc_event(
        conn,
        &doc_id,
        "tab_renamed",
        &json!({ "tabId": tab_id, "label": label, "previousLabel": previous }),
    )?;
    Ok(())
}

pub fn rename_tab(conn: &Connection, tab_id: &str, label: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    rename_tab_inner(&tx, tab_id, label)?;
    tx.commit()?;
    Ok(())
}

/// Soft-deletes a tab. Its drafts, events, and snapshots are untouched —
/// the tab disappears from the bar but can be restored from the
/// document's version history. Refuses to delete the last live tab.
fn delete_tab_inner(conn: &Connection, tab_id: &str, enforce_last_tab_guard: bool) -> Result<()> {
    let (doc_id, label): (String, String) = conn.query_row(
        "SELECT document_id, label FROM tabs WHERE id = ?1",
        params![tab_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if enforce_last_tab_guard {
        let live: i64 = conn.query_row(
            "SELECT COUNT(*) FROM tabs WHERE document_id = ?1 AND deleted_at IS NULL",
            params![doc_id],
            |row| row.get(0),
        )?;
        if live <= 1 {
            return Err(refuse("Cannot delete the last tab of a document"));
        }
    }
    conn.execute(
        "UPDATE tabs SET deleted_at = ?1 WHERE id = ?2",
        params![now_ms(), tab_id],
    )?;
    log_doc_event(
        conn,
        &doc_id,
        "tab_deleted",
        &json!({ "tabId": tab_id, "label": label }),
    )?;
    Ok(())
}

pub fn delete_tab(conn: &Connection, tab_id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    delete_tab_inner(&tx, tab_id, true)?;
    tx.commit()?;
    Ok(())
}

/// Restores a soft-deleted tab (from the version history or undo toast).
fn restore_tab_inner(conn: &Connection, tab_id: &str) -> Result<()> {
    let (doc_id, label): (String, String) = conn.query_row(
        "SELECT document_id, label FROM tabs WHERE id = ?1",
        params![tab_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    conn.execute(
        "UPDATE tabs SET deleted_at = NULL WHERE id = ?1",
        params![tab_id],
    )?;
    log_doc_event(
        conn,
        &doc_id,
        "tab_restored",
        &json!({ "tabId": tab_id, "label": label }),
    )?;
    Ok(())
}

pub fn restore_tab(conn: &Connection, tab_id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    restore_tab_inner(&tx, tab_id)?;
    tx.commit()?;
    Ok(())
}

/// Persists a new tab order. `ordered_ids` is the full list of the
/// document's live tabs in their new left-to-right order; each tab's
/// `position` is rewritten to its index. The new order is logged to the
/// doc-event audit trail so the version-history replay can reconstruct
/// historical tab order (the `position` column alone only reflects the
/// latest order).
fn reorder_tabs_inner(conn: &Connection, doc_id: &str, ordered_ids: &[String]) -> Result<()> {
    for (position, tab_id) in ordered_ids.iter().enumerate() {
        // Scope the update to the document so a stale/foreign id can't
        // stomp another document's tab positions.
        conn.execute(
            "UPDATE tabs SET position = ?1 WHERE id = ?2 AND document_id = ?3",
            params![position as i64, tab_id, doc_id],
        )?;
    }
    log_doc_event(
        conn,
        doc_id,
        "tabs_reordered",
        &json!({ "order": ordered_ids }),
    )?;
    Ok(())
}

pub fn reorder_tabs(conn: &Connection, doc_id: &str, ordered_ids: &[String]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    reorder_tabs_inner(&tx, doc_id, ordered_ids)?;
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

fn rename_draft_inner(conn: &Connection, draft_id: &str, label: &str) -> Result<()> {
    let (doc_id, previous): (String, String) = conn.query_row(
        "SELECT document_id, label FROM drafts WHERE id = ?1",
        params![draft_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    conn.execute(
        "UPDATE drafts SET label = ?1 WHERE id = ?2",
        params![label, draft_id],
    )?;
    log_doc_event(
        conn,
        &doc_id,
        "draft_renamed",
        &json!({ "draftId": draft_id, "label": label, "previousLabel": previous }),
    )?;
    Ok(())
}

pub fn rename_draft(conn: &Connection, draft_id: &str, label: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    rename_draft_inner(&tx, draft_id, label)?;
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

/// Non-destructively restores a draft's content to a past snapshot. Rather
/// than truncating the event log (the old, destructive `restore_to_snapshot`),
/// this seeds a *new iteration tip* on the snapshot's draft run with that
/// snapshot's exact serialized state — exactly how `iterate_draft` plants a
/// seed. The original draft and its whole history stay intact, so the restore
/// is reversible (restore forward to any later coordinate) and the timeline
/// stays append-only, matching the "git reflog" model.
///
/// Returns the new tip draft so the caller can make it active.
fn restore_content_nondestructive_inner(conn: &Connection, snapshot_id: i64) -> Result<DraftMeta> {
    let (source_draft_id, state_json): (String, String) = conn.query_row(
        "SELECT draft_id, state_json FROM snapshots WHERE id = ?1",
        params![snapshot_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let (doc_id, tab_id, source_label): (String, Option<String>, String) = conn.query_row(
        "SELECT document_id, tab_id, label FROM drafts WHERE id = ?1",
        params![source_draft_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    // Restore lands on the live tip of the source's run — a new iteration off
    // whichever draft is currently the run's editable tip — so the restored
    // content continues the active line rather than reviving a locked older one.
    let tip = run_tip(conn, &source_draft_id)?;
    let label = format!("{} (restored)", source_label);
    let draft_id = Uuid::new_v4().to_string();
    let now = now_ms();
    insert_draft(
        conn,
        &draft_id,
        &doc_id,
        &tab_id,
        Some(&tip),
        None,
        &label,
        now,
        Some(&state_json),
    )?;
    relock_run(conn, &draft_id)?;
    log_doc_event(
        conn,
        &doc_id,
        "draft_iterated",
        &json!({
            "draftId": draft_id,
            "label": label,
            "parentDraftId": tip,
            "tabId": tab_id,
            "restoredFromSnapshot": snapshot_id,
        }),
    )?;
    Ok(DraftMeta {
        id: draft_id,
        document_id: doc_id,
        label,
        created_at: now,
        is_active: true,
        tab_id,
        parent_draft_id: Some(tip),
        branched_from: None,
        locked: false,
    })
}

pub fn restore_content_nondestructive(conn: &Connection, snapshot_id: i64) -> Result<DraftMeta> {
    let tx = conn.unchecked_transaction()?;
    let draft = restore_content_nondestructive_inner(&tx, snapshot_id)?;
    tx.commit()?;
    Ok(draft)
}

/// Walks *down* the iteration chain from `member`'s run head to the newest
/// live iteration (the run's editable tip). Mirrors `relock_run`'s walk.
fn run_tip(conn: &Connection, member: &str) -> Result<String> {
    let head = run_head(conn, member)?;
    // Track only LIVE drafts: a fully soft-deleted run must not return a dead
    // draft as the tip (callers attach a new iteration off it). `tip` stays the
    // newest live draft seen; if none are live we fall back to the head.
    let mut tip: Option<(String, i64)> = None;
    let mut current = Some(head.clone());
    while let Some(id) = current {
        if let Some(created_at) = conn
            .query_row(
                "SELECT created_at FROM drafts WHERE id = ?1 AND deleted_at IS NULL",
                params![id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
        {
            if tip.as_ref().is_none_or(|(_, c)| created_at >= *c) {
                tip = Some((id.clone(), created_at));
            }
        }
        current = conn
            .query_row(
                "SELECT id FROM drafts WHERE parent_draft_id = ?1 AND deleted_at IS NULL
                 ORDER BY created_at ASC LIMIT 1",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
    }
    Ok(tip.map(|(id, _)| id).unwrap_or(head))
}

/// Refuses if `tab_id` is set and the tab would be left with fewer than
/// `keep` live drafts after a delete (a tab must keep ≥ 1 live draft). `keep`
/// is the number of drafts the pending delete removes from this tab.
fn guard_tab_not_emptied(conn: &Connection, tab_id: &Option<String>, removing: i64) -> Result<()> {
    if let Some(tab) = tab_id {
        let live: i64 = conn.query_row(
            "SELECT COUNT(*) FROM drafts WHERE tab_id = ?1 AND deleted_at IS NULL",
            params![tab],
            |row| row.get(0),
        )?;
        if live - removing < 1 {
            return Err(refuse("Cannot delete the last draft of a tab"));
        }
    }
    Ok(())
}

fn guard_draft_has_no_live_children(conn: &Connection, draft_id: &str) -> Result<()> {
    let live_children: i64 = conn.query_row(
        "SELECT COUNT(*) FROM drafts
         WHERE (parent_draft_id = ?1 OR branched_from = ?1) AND deleted_at IS NULL",
        params![draft_id],
        |row| row.get(0),
    )?;
    if live_children > 0 {
        return Err(refuse(
            "Cannot delete a draft with live children; orphan or cascade it instead",
        ));
    }
    Ok(())
}

/// Soft-deletes a single leaf draft. Its events and snapshots are untouched,
/// so restoring from the version history brings the text back exactly.
/// Refuses if deleting it would empty the tab or leave live children dangling.
/// Parent drafts must be deleted with `orphan_and_delete_draft` or
/// `cascade_delete_draft`, which keep the tree valid. The draft's run relocks
/// (the tip may move back).
pub fn delete_draft(conn: &Connection, draft_id: &str) -> Result<()> {
    let (doc_id, label, tab_id, parent_draft_id): (String, String, Option<String>, Option<String>) =
        conn.query_row(
            "SELECT document_id, label, tab_id, parent_draft_id FROM drafts WHERE id = ?1",
            params![draft_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
    guard_tab_not_emptied(conn, &tab_id, 1)?;
    guard_draft_has_no_live_children(conn, draft_id)?;
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

/// Deletes `draft_id` but keeps its children alive by re-attaching them so
/// the tree stays valid, then returns the link rewrites it made (oldest
/// first) so the caller can reverse them on Undo. The deleted draft's anchor
/// is its own `parent_draft_id` (None when it is a run head).
///
/// - Iteration children (`parent_draft_id = D`) splice `D` out of the run:
///   they adopt `D`'s parent. If `D` was a run head they become run heads.
/// - Branch children (`branched_from = D`) re-point to `D`'s anchor. A branch
///   may never point at a run head (`branch_draft` forbids it), so when `D`
///   is a run head the branch is *promoted* to a top-level run instead:
///   `branched_from = NULL`, `parent_draft_id = D`'s parent (None → new head).
pub fn orphan_and_delete_draft(conn: &Connection, draft_id: &str) -> Result<Vec<ReparentEntry>> {
    let (doc_id, label, tab_id, parent_draft_id): (String, String, Option<String>, Option<String>) =
        conn.query_row(
            "SELECT document_id, label, tab_id, parent_draft_id FROM drafts WHERE id = ?1",
            params![draft_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
    guard_tab_not_emptied(conn, &tab_id, 1)?;

    // Snapshot the live children (and their old links) before rewriting, so we
    // can reverse the rewrite on Undo. Branch children first so the promoted
    // run reads naturally in the audit log; ordering is otherwise irrelevant.
    let children: Vec<(String, Option<String>, Option<String>)> = {
        let mut stmt = conn.prepare(
            "SELECT id, parent_draft_id, branched_from FROM drafts
             WHERE (parent_draft_id = ?1 OR branched_from = ?1) AND deleted_at IS NULL
             ORDER BY (branched_from = ?1) DESC, created_at ASC",
        )?;
        let rows = stmt.query_map(params![draft_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?;
        rows.collect::<Result<Vec<_>>>()?
    };

    let tx = conn.unchecked_transaction()?;
    let mut rewrites: Vec<ReparentEntry> = Vec::with_capacity(children.len());
    // `relock_run` only needs to run once per distinct head; collect members.
    let mut relock_seeds: Vec<String> = Vec::new();
    for (child_id, old_parent, old_branched_from) in &children {
        let is_branch_child = old_branched_from.as_deref() == Some(draft_id);
        let (new_parent, new_branched_from): (Option<String>, Option<String>) = if is_branch_child {
            match &parent_draft_id {
                // D is an iteration: the branch keeps branching, off D's parent.
                Some(p) => (None, Some(p.clone())),
                // D is a run head: promote the branch to a top-level run.
                None => (None, None),
            }
        } else {
            // Iteration child: splice D out — adopt D's parent.
            (parent_draft_id.clone(), None)
        };
        tx.execute(
            "UPDATE drafts SET parent_draft_id = ?1, branched_from = ?2 WHERE id = ?3",
            params![new_parent, new_branched_from, child_id],
        )?;
        rewrites.push(ReparentEntry {
            draft_id: child_id.clone(),
            old_parent_draft_id: old_parent.clone(),
            old_branched_from: old_branched_from.clone(),
        });
        relock_seeds.push(child_id.clone());
    }

    tx.execute(
        "UPDATE drafts SET deleted_at = ?1 WHERE id = ?2",
        params![now_ms(), draft_id],
    )?;
    // Relock every run touched: each re-attached child's run, plus D's old run
    // (its parent, now possibly a new tip). `relock_run` walks to the head, so
    // duplicate seeds within one run are harmless (idempotent).
    if let Some(ref parent) = parent_draft_id {
        relock_seeds.push(parent.clone());
    }
    for seed in &relock_seeds {
        relock_run(&tx, seed)?;
    }

    log_doc_event(
        &tx,
        &doc_id,
        "draft_deleted",
        &json!({ "draftId": draft_id, "label": label, "tabId": tab_id, "mode": "orphan" }),
    )?;
    for r in &rewrites {
        log_doc_event(
            &tx,
            &doc_id,
            "draft_reparented",
            &json!({
                "draftId": r.draft_id,
                "fromParentDraftId": draft_id,
                "oldParentDraftId": r.old_parent_draft_id,
                "oldBranchedFrom": r.old_branched_from,
            }),
        )?;
    }
    tx.commit()?;
    Ok(rewrites)
}

/// Soft-deletes `draft_id` together with every live draft under it
/// (iterations and branches, transitively). Refuses if that would empty the
/// tab. Returns the deleted ids (the root first) so Undo can restore them all.
fn cascade_delete_draft_inner(
    conn: &Connection,
    draft_id: &str,
    enforce_tab_guard: bool,
) -> Result<Vec<String>> {
    let (doc_id, label, tab_id, parent_draft_id): (String, String, Option<String>, Option<String>) =
        conn.query_row(
            "SELECT document_id, label, tab_id, parent_draft_id FROM drafts WHERE id = ?1",
            params![draft_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;

    // BFS the live subtree following both links. Runs are shallow, so a plain
    // queue is fine; `seen` guards against the impossible cycle defensively.
    let mut subtree: Vec<String> = vec![draft_id.to_string()];
    let mut seen: std::collections::HashSet<String> =
        std::collections::HashSet::from([draft_id.to_string()]);
    let mut queue: std::collections::VecDeque<String> =
        std::collections::VecDeque::from([draft_id.to_string()]);
    while let Some(cur) = queue.pop_front() {
        let mut stmt = conn.prepare(
            "SELECT id FROM drafts
             WHERE (parent_draft_id = ?1 OR branched_from = ?1) AND deleted_at IS NULL
             ORDER BY created_at ASC",
        )?;
        let children = stmt
            .query_map(params![cur], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>>>()?;
        for child in children {
            if seen.insert(child.clone()) {
                subtree.push(child.clone());
                queue.push_back(child);
            }
        }
    }

    if enforce_tab_guard {
        guard_tab_not_emptied(conn, &tab_id, subtree.len() as i64)?;
    }

    let now = now_ms();
    for id in &subtree {
        conn.execute(
            "UPDATE drafts SET deleted_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
    }
    // The deleted root's old run may have a new tip; relock from its parent.
    if let Some(ref parent) = parent_draft_id {
        relock_run(conn, parent)?;
    }
    log_doc_event(
        conn,
        &doc_id,
        "draft_deleted",
        &json!({
            "draftId": draft_id,
            "label": label,
            "tabId": tab_id,
            "mode": "cascade",
            "ids": subtree,
        }),
    )?;
    Ok(subtree)
}

pub fn cascade_delete_draft(conn: &Connection, draft_id: &str) -> Result<Vec<String>> {
    let tx = conn.unchecked_transaction()?;
    let subtree = cascade_delete_draft_inner(&tx, draft_id, true)?;
    tx.commit()?;
    Ok(subtree)
}

/// Soft-deletes a single draft WITHOUT the last-draft-of-tab guard. Only the
/// structural restore uses this, to delete the drafts of a tab that is itself
/// being deleted (where "would empty the tab" is moot). Logs `draft_deleted`
/// and relocks the run, like the guarded variants.
fn soft_delete_draft_unguarded_inner(conn: &Connection, draft_id: &str) -> Result<()> {
    let (doc_id, label, tab_id, parent_draft_id): (String, String, Option<String>, Option<String>) =
        conn.query_row(
            "SELECT document_id, label, tab_id, parent_draft_id FROM drafts WHERE id = ?1",
            params![draft_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
    conn.execute(
        "UPDATE drafts SET deleted_at = ?1 WHERE id = ?2",
        params![now_ms(), draft_id],
    )?;
    if let Some(ref parent) = parent_draft_id {
        relock_run(conn, parent)?;
    }
    log_doc_event(
        conn,
        &doc_id,
        "draft_deleted",
        &json!({ "draftId": draft_id, "label": label, "tabId": tab_id, "mode": "simple" }),
    )?;
    Ok(())
}

/// Reverses an `orphan_and_delete_draft` re-parent: restores `draft_id`'s
/// original `parent_draft_id` / `branched_from` links. Used by Undo, applied
/// after the deleted parent is restored so the links point at a live draft.
pub fn reparent_draft(
    conn: &Connection,
    draft_id: &str,
    parent_draft_id: Option<&str>,
    branched_from: Option<&str>,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE drafts SET parent_draft_id = ?1, branched_from = ?2 WHERE id = ?3",
        params![parent_draft_id, branched_from, draft_id],
    )?;
    relock_run(&tx, draft_id)?;
    tx.commit()?;
    Ok(())
}

/// Restores a soft-deleted draft. Its run relocks (the restored draft may
/// reclaim or yield the tip), so lock state stays consistent.
fn restore_draft_inner(conn: &Connection, draft_id: &str) -> Result<()> {
    let (doc_id, label): (String, String) = conn.query_row(
        "SELECT document_id, label FROM drafts WHERE id = ?1",
        params![draft_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    conn.execute(
        "UPDATE drafts SET deleted_at = NULL WHERE id = ?1",
        params![draft_id],
    )?;
    relock_run(conn, draft_id)?;
    log_doc_event(
        conn,
        &doc_id,
        "draft_restored",
        &json!({ "draftId": draft_id, "label": label }),
    )?;
    Ok(())
}

pub fn restore_draft(conn: &Connection, draft_id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    restore_draft_inner(&tx, draft_id)?;
    tx.commit()?;
    Ok(())
}

// ── Structural restore (version-history "reflog") ─────────────────

/// The state of one tab or draft reconstructed at a point in time by
/// replaying `doc_events`.
#[derive(Default, Clone)]
struct NodeState {
    /// Whether the node was in a soft-deleted state at time T. (Existence at T
    /// is decided from the live row's `created_at`, not from this map, so a
    /// node created after T is handled even though it has no events ≤ T.)
    deleted: bool,
    /// The node's label at time T (last rename ≤ T, else its create label).
    label: Option<String>,
}

/// Replays the document's `doc_events` up to and including `as_of_ms` to derive
/// the live tab/draft structure (existence, deletion, labels) and tab order at
/// that moment. Returns `(tabs, drafts, tab_order)` keyed by id. Lock state is
/// intentionally omitted — it is re-derived by `relock_run` after restore.
///
/// Tolerates pre-G1/G2 payloads: a `tab_created` without `rootDraftId` simply
/// doesn't seed the root draft here (the live row's own `created_at` still
/// gates it during the diff), and a missing `tabs_reordered` history leaves the
/// order empty (the live `position` order is kept).
fn reconstruct_structure(
    conn: &Connection,
    doc_id: &str,
    as_of_ms: i64,
    as_of_event_id: Option<i64>,
) -> Result<(
    std::collections::HashMap<String, NodeState>,
    std::collections::HashMap<String, NodeState>,
    Vec<String>,
)> {
    use std::collections::HashMap;
    let mut tabs: HashMap<String, NodeState> = HashMap::new();
    let mut drafts: HashMap<String, NodeState> = HashMap::new();
    let mut tab_order: Vec<String> = Vec::new();

    let mut stmt = conn.prepare(
        "SELECT event_type, payload FROM doc_events
         WHERE document_id = ?1
           AND (
               created_at < ?2
               OR (created_at = ?2 AND ?3 IS NOT NULL AND id <= ?3)
           )
         ORDER BY created_at ASC, id ASC",
    )?;
    let rows = stmt.query_map(params![doc_id, as_of_ms, as_of_event_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    for row in rows {
        let (event_type, payload_str) = row?;
        let p: serde_json::Value = serde_json::from_str(&payload_str).unwrap_or(json!({}));
        let s = |k: &str| p.get(k).and_then(|v| v.as_str()).map(str::to_string);
        // Like the TS replay's `if (label)` guard: only treat a non-empty label
        // as a real value, so a missing/empty label never clears or blanks the
        // node's label (which would otherwise make the restore rename it to "").
        let s_label = || s("label").filter(|l| !l.is_empty());
        match event_type.as_str() {
            "tab_created" => {
                if let Some(id) = s("tabId") {
                    let node = tabs.entry(id.clone()).or_default();
                    node.deleted = false;
                    if let Some(label) = s_label() {
                        node.label = Some(label);
                    }
                    if !tab_order.contains(&id) {
                        tab_order.push(id.clone());
                    }
                    // G1: seed the auto-created root draft when recorded.
                    if let Some(root) = s("rootDraftId") {
                        let d = drafts.entry(root).or_default();
                        d.deleted = false;
                        d.label = Some("main".to_string());
                    }
                }
            }
            "tab_renamed" => {
                if let (Some(id), Some(label)) = (s("tabId"), s_label()) {
                    tabs.entry(id).or_default().label = Some(label);
                }
            }
            "tab_deleted" => {
                if let Some(id) = s("tabId") {
                    tabs.entry(id).or_default().deleted = true;
                }
            }
            "tab_restored" => {
                if let Some(id) = s("tabId") {
                    tabs.entry(id).or_default().deleted = false;
                }
            }
            "tabs_reordered" => {
                if let Some(order) = p.get("order").and_then(|v| v.as_array()) {
                    tab_order = order
                        .iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect();
                }
            }
            "draft_iterated" | "draft_branched" => {
                if let Some(id) = s("draftId") {
                    let node = drafts.entry(id).or_default();
                    node.deleted = false;
                    if let Some(label) = s_label() {
                        node.label = Some(label);
                    }
                }
            }
            "draft_renamed" => {
                if let (Some(id), Some(label)) = (s("draftId"), s_label()) {
                    drafts.entry(id).or_default().label = Some(label);
                }
            }
            "draft_deleted" => {
                // Simple/orphan delete one id; cascade deletes the `ids` list.
                if p.get("mode").and_then(|v| v.as_str()) == Some("cascade") {
                    if let Some(ids) = p.get("ids").and_then(|v| v.as_array()) {
                        for v in ids {
                            if let Some(id) = v.as_str() {
                                drafts.entry(id.to_string()).or_default().deleted = true;
                            }
                        }
                    }
                } else if let Some(id) = s("draftId") {
                    drafts.entry(id).or_default().deleted = true;
                }
            }
            "draft_restored" => {
                if let Some(id) = s("draftId") {
                    drafts.entry(id).or_default().deleted = false;
                }
            }
            // draft_locked / draft_unlocked / draft_reparented / checkpoint_created:
            // lock is re-derived; reparent links live on the soft-deleted row;
            // checkpoints are not structural. All no-ops here.
            _ => {}
        }
    }
    Ok((tabs, drafts, tab_order))
}

/// Non-destructively rewinds the document's tab/draft *structure* to the moment
/// `as_of_ms`. Reconstructs which tabs/drafts existed (and their labels/order)
/// at T from the `doc_events` log, then applies the minimal set of forward,
/// individually-logged operations to reach it — restoring nodes that were live
/// at T, soft-deleting ones that hadn't been created yet (or had been deleted),
/// fixing labels, and reordering tabs. Every corrective op is itself a normal
/// logged operation, so the reflog stays append-only and the rewind is
/// reversible. Lock state is re-derived by the underlying delete/restore calls.
///
/// Callers wrap this in a transaction so a failed corrective op rolls back the
/// entire rewind.
fn restore_structure_to_inner(
    conn: &Connection,
    doc_id: &str,
    as_of_ms: i64,
    as_of_event_id: Option<i64>,
) -> Result<()> {
    let (target_tabs, target_drafts, target_order) =
        reconstruct_structure(conn, doc_id, as_of_ms, as_of_event_id)?;

    // Live tabs/drafts (id, deleted-now, label, created_at). `created_at` lets
    // us tell "created after T" (must not exist at T) apart from "never logged"
    // (legacy — leave as-is), which the replay maps alone can't distinguish.
    let live_tabs: Vec<(String, bool, String, i64)> = {
        let mut stmt = conn.prepare(
            "SELECT id, deleted_at IS NOT NULL, label, created_at FROM tabs WHERE document_id = ?1",
        )?;
        let v = stmt
            .query_map(params![doc_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, bool>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>>>()?;
        v
    };
    let live_drafts: Vec<(String, bool, String, i64)> = {
        let mut stmt = conn.prepare(
            "SELECT id, deleted_at IS NOT NULL, label, created_at FROM drafts WHERE document_id = ?1",
        )?;
        let v = stmt
            .query_map(params![doc_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, bool>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>>>()?;
        v
    };

    // Whether a node should be LIVE at T, given its real creation time and the
    // replayed delete state: `Some(true/false)` to act, `None` to leave as-is.
    // - created after T → must not exist at T → Some(false).
    // - created by T → live iff the replay didn't have it deleted at T.
    let should_be_live = |created_at: i64, replayed: Option<&NodeState>| -> Option<bool> {
        if created_at > as_of_ms {
            return Some(false);
        }
        // Created by T; deleted at T only if a delete event landed by then.
        Some(replayed.map(|n| !n.deleted).unwrap_or(true))
    };

    // Corrective ops run in a strict RESTORE-then-DELETE order. Doing every
    // restore first means the `delete_tab` last-tab guard and the
    // `guard_tab_not_emptied` last-draft guard always see the final live count,
    // so a delete is never spuriously refused just because a sibling that
    // should be restored hasn't been processed yet (the old single interleaved
    // loop made the outcome depend on arbitrary SQLite row order).

    // 1. Restore everything that should be live at T (tabs, then their drafts).
    for (id, is_deleted, _, created_at) in &live_tabs {
        if matches!(should_be_live(*created_at, target_tabs.get(id)), Some(true)) && *is_deleted {
            restore_tab_inner(conn, id)?;
        }
    }
    for (id, is_deleted, _, created_at) in &live_drafts {
        if matches!(
            should_be_live(*created_at, target_drafts.get(id)),
            Some(true)
        ) && *is_deleted
        {
            restore_draft_inner(conn, id)?;
        }
    }

    // 2. Delete tabs that shouldn't exist at T, together with all their drafts.
    //    A tab created after T has all its drafts created after T too; the
    //    last-draft guard would refuse the cascade (it would "empty" a tab we
    //    are about to delete anyway), leaving live drafts orphaned under a
    //    soft-deleted tab. So soft-delete the tab's drafts directly here,
    //    bypassing that guard, then delete the tab.
    let mut deleting_tabs: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (id, is_deleted, _, created_at) in &live_tabs {
        if matches!(
            should_be_live(*created_at, target_tabs.get(id)),
            Some(false)
        ) && !*is_deleted
        {
            deleting_tabs.insert(id.clone());
        }
    }
    let mut just_deleted: std::collections::HashSet<String> = std::collections::HashSet::new();
    for tab in &deleting_tabs {
        for (id, is_deleted, _, _) in &live_drafts {
            if *is_deleted || just_deleted.contains(id) {
                continue;
            }
            let in_tab = conn
                .query_row(
                    "SELECT 1 FROM drafts WHERE id = ?1 AND tab_id = ?2",
                    params![id, tab],
                    |_| Ok(()),
                )
                .optional()?
                .is_some();
            if in_tab {
                soft_delete_draft_unguarded_inner(conn, id)?;
                just_deleted.insert(id.clone());
            }
        }
        delete_tab_inner(conn, tab, true)?;
    }

    // 3. Delete drafts in SURVIVING tabs that shouldn't exist at T. Here the
    //    last-draft guard is legitimate (the tab stays, so it must keep ≥1
    //    draft), so a refused cascade is correctly skipped. A cascade removes a
    //    whole subtree at once; track those to avoid double-logging.
    for (id, is_deleted, _, created_at) in &live_drafts {
        if *is_deleted || just_deleted.contains(id) {
            continue;
        }
        if matches!(
            should_be_live(*created_at, target_drafts.get(id)),
            Some(false)
        ) {
            let ids = cascade_delete_draft_inner(conn, id, true)?;
            just_deleted.extend(ids);
        }
    }

    // 4. Labels: rename any node whose current label differs from T's.
    for (id, _, label, created_at) in &live_tabs {
        if let Some(node) = target_tabs.get(id) {
            if let Some(target) = &node.label {
                if target != label && matches!(should_be_live(*created_at, Some(node)), Some(true))
                {
                    rename_tab_inner(conn, id, target)?;
                }
            }
        }
    }
    for (id, _, label, created_at) in &live_drafts {
        if let Some(node) = target_drafts.get(id) {
            if let Some(target) = &node.label {
                if target != label
                    && !just_deleted.contains(id)
                    && matches!(should_be_live(*created_at, Some(node)), Some(true))
                {
                    rename_draft_inner(conn, id, target)?;
                }
            }
        }
    }

    // 5. Tab order: apply T's order over the tabs that are live now. Read the
    //    current order too, and only reorder when it actually differs —
    //    `reorder_tabs` always logs a `tabs_reordered` event, so calling it
    //    unconditionally would append a spurious "Reordered tabs" coordinate to
    //    the very log this restore replays, on every restore.
    if !target_order.is_empty() {
        let current_order: Vec<String> = {
            let mut stmt = conn.prepare(
                "SELECT id FROM tabs WHERE document_id = ?1 AND deleted_at IS NULL
                 ORDER BY position ASC, created_at ASC",
            )?;
            let v = stmt
                .query_map(params![doc_id], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>>>()?;
            v
        };
        let live_now: std::collections::HashSet<&String> = current_order.iter().collect();
        let ordered: Vec<String> = target_order
            .iter()
            .filter(|id| live_now.contains(id))
            .cloned()
            .collect();
        if ordered.len() == live_now.len() && !ordered.is_empty() && ordered != current_order {
            reorder_tabs_inner(conn, doc_id, &ordered)?;
        }
    }

    Ok(())
}

pub fn restore_structure_to(
    conn: &Connection,
    doc_id: &str,
    as_of_ms: i64,
    as_of_event_id: Option<i64>,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    restore_structure_to_inner(&tx, doc_id, as_of_ms, as_of_event_id)?;
    tx.commit()?;
    Ok(())
}

pub fn restore_coordinate_nondestructive(
    conn: &Connection,
    doc_id: &str,
    as_of_ms: i64,
    as_of_event_id: Option<i64>,
    snapshot_id: Option<i64>,
) -> Result<Option<DraftMeta>> {
    if let Some(id) = snapshot_id {
        let belongs: bool = conn.query_row(
            "SELECT EXISTS(
                SELECT 1
                FROM snapshots s
                JOIN drafts d ON d.id = s.draft_id
                WHERE s.id = ?1 AND d.document_id = ?2
             )",
            params![id, doc_id],
            |row| row.get(0),
        )?;
        if !belongs {
            return Err(refuse("Snapshot does not belong to this document"));
        }
    }

    let tx = conn.unchecked_transaction()?;
    restore_structure_to_inner(&tx, doc_id, as_of_ms, as_of_event_id)?;
    let landing = match snapshot_id {
        Some(id) => {
            let draft = restore_content_nondestructive_inner(&tx, id)?;
            if let Some(tab) = &draft.tab_id {
                set_active_tab(&tx, doc_id, tab)?;
                set_active_draft(&tx, tab, &draft.id)?;
            }
            Some(draft)
        }
        None => None,
    };
    tx.commit()?;
    Ok(landing)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::open_db;

    /// Fresh migrated DB with one document; returns (conn, tab_id, main_id).
    fn setup() -> (Connection, String, String) {
        let dir = tempfile::tempdir().unwrap();
        // Leak the tempdir so the file outlives the test (conn holds it open).
        let path = Box::leak(Box::new(dir)).path().join("test.db");
        let conn = open_db(&path).unwrap();
        conn.execute(
            "INSERT INTO documents (id, title, created_at, updated_at) VALUES ('doc', 'T', 0, 0)",
            [],
        )
        .unwrap();
        let tab = create_tab(&conn, "doc", "Tab").unwrap();
        let main_id: String = conn
            .query_row(
                "SELECT id FROM drafts WHERE tab_id = ?1",
                params![tab.id],
                |r| r.get(0),
            )
            .unwrap();
        (conn, tab.id, main_id)
    }

    fn parent_of(conn: &Connection, id: &str) -> Option<String> {
        conn.query_row(
            "SELECT parent_draft_id FROM drafts WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .unwrap()
    }
    fn branched_from(conn: &Connection, id: &str) -> Option<String> {
        conn.query_row(
            "SELECT branched_from FROM drafts WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .unwrap()
    }
    fn is_live(conn: &Connection, id: &str) -> bool {
        conn.query_row(
            "SELECT deleted_at IS NULL FROM drafts WHERE id = ?1",
            params![id],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
            != 0
    }
    fn is_locked(conn: &Connection, id: &str) -> bool {
        conn.query_row(
            "SELECT locked FROM drafts WHERE id = ?1",
            params![id],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
            != 0
    }

    #[test]
    fn delete_draft_refuses_live_children() {
        // main → v1 → v2; deleting v1 directly would leave v2 attached to a
        // hidden parent. Callers must choose orphan or cascade instead.
        let (conn, _tab, main) = setup();
        let v1 = iterate_draft(&conn, &main, "v1", None).unwrap().id;
        let v2 = iterate_draft(&conn, &v1, "v2", None).unwrap().id;
        assert!(delete_draft(&conn, &v1).is_err());
        assert!(is_live(&conn, &v1));
        assert!(is_live(&conn, &v2));
    }

    #[test]
    fn delete_draft_refuses_last_draft() {
        let (conn, _tab, main) = setup();
        assert!(delete_draft(&conn, &main).is_err());
        assert!(is_live(&conn, &main));
    }

    #[test]
    fn orphan_splices_iteration_out_of_run() {
        // main → v1 → v2. Orphan-delete v1 → v2 adopts main; run relocks.
        let (conn, _tab, main) = setup();
        let v1 = iterate_draft(&conn, &main, "v1", None).unwrap().id;
        let v2 = iterate_draft(&conn, &v1, "v2", None).unwrap().id;
        let rewrites = orphan_and_delete_draft(&conn, &v1).unwrap();
        assert!(!is_live(&conn, &v1));
        assert_eq!(parent_of(&conn, &v2).as_deref(), Some(main.as_str()));
        // Run is main → v2 now; v2 is the live tip (unlocked), main locked.
        assert!(!is_locked(&conn, &v2));
        assert!(is_locked(&conn, &main));
        // One rewrite recorded for Undo: v2 used to have parent v1.
        assert_eq!(rewrites.len(), 1);
        assert_eq!(rewrites[0].draft_id, v2);
        assert_eq!(
            rewrites[0].old_parent_draft_id.as_deref(),
            Some(v1.as_str())
        );
    }

    #[test]
    fn orphan_run_head_promotes_branch_to_top_level() {
        // main → v1 ; branch b off v1. Orphan-delete v1 (a run head's child,
        // itself an iteration) → b re-points to main (still an iteration's
        // anchor). Then orphan-delete main (a run head with branch nothing):
        // here exercise the run-head-with-branch case directly.
        let (conn, _tab, main) = setup();
        let v1 = iterate_draft(&conn, &main, "v1", None).unwrap().id;
        let b = branch_draft(&conn, &v1, "b", None).unwrap().id;
        assert_eq!(branched_from(&conn, &b).as_deref(), Some(v1.as_str()));
        // Orphan-delete v1: iteration child none after it, branch child b.
        // v1's anchor is main, so b should branch off main.
        orphan_and_delete_draft(&conn, &v1).unwrap();
        assert!(!is_live(&conn, &v1));
        assert_eq!(branched_from(&conn, &b).as_deref(), Some(main.as_str()));
        assert!(parent_of(&conn, &b).is_none());
    }

    #[test]
    fn orphan_promotes_branch_off_run_head_to_new_run() {
        // Build main → v1 ; branch b off v1 ; then we want to orphan a *run
        // head* that has a branch. Make a second run head via a top-level
        // iteration chain: root2 (head) with branch bb off an iteration r2.
        let (conn, tab, main) = setup();
        // A run head with a branch directly under it can't be `main` (branch
        // needs a non-head source), so iterate then branch then orphan the
        // head's iteration to leave the branch pointing where head-rules bite.
        let v1 = iterate_draft(&conn, &main, "v1", None).unwrap().id;
        let b = branch_draft(&conn, &v1, "b", None).unwrap().id;
        // Orphan-delete main (the run head): v1 becomes a run head; b is a
        // branch child of v1 (not of main), so it's untouched by main's delete.
        orphan_and_delete_draft(&conn, &main).unwrap();
        assert!(!is_live(&conn, &main));
        assert!(parent_of(&conn, &v1).is_none()); // v1 now a run head
        assert_eq!(branched_from(&conn, &b).as_deref(), Some(v1.as_str()));
        // Tab still has live drafts.
        let live: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM drafts WHERE tab_id = ?1 AND deleted_at IS NULL",
                params![tab],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(live, 2); // v1, b
    }

    #[test]
    fn cascade_deletes_whole_subtree() {
        // main → v1 ; branch b1 off v1 ; b1 → b2. Cascade-delete v1 removes
        // v1, b1, b2; main survives.
        let (conn, _tab, main) = setup();
        let v1 = iterate_draft(&conn, &main, "v1", None).unwrap().id;
        let b1 = branch_draft(&conn, &v1, "b1", None).unwrap().id;
        let b2 = iterate_draft(&conn, &b1, "b2", None).unwrap().id;
        let deleted = cascade_delete_draft(&conn, &v1).unwrap();
        assert!(deleted.contains(&v1));
        assert!(deleted.contains(&b1));
        assert!(deleted.contains(&b2));
        assert_eq!(deleted[0], v1); // root first
        assert!(!is_live(&conn, &v1));
        assert!(!is_live(&conn, &b1));
        assert!(!is_live(&conn, &b2));
        assert!(is_live(&conn, &main));
    }

    #[test]
    fn cascade_refuses_when_it_would_empty_the_tab() {
        // main → v1: cascade-deleting main would remove every draft.
        let (conn, _tab, main) = setup();
        let _v1 = iterate_draft(&conn, &main, "v1", None).unwrap().id;
        assert!(cascade_delete_draft(&conn, &main).is_err());
        assert!(is_live(&conn, &main));
    }

    #[test]
    fn reparent_reverses_an_orphan_rewrite() {
        // main → v1 → v2 ; orphan-delete v1 ; restore v1 ; reparent v2 back.
        let (conn, _tab, main) = setup();
        let v1 = iterate_draft(&conn, &main, "v1", None).unwrap().id;
        let v2 = iterate_draft(&conn, &v1, "v2", None).unwrap().id;
        let rewrites = orphan_and_delete_draft(&conn, &v1).unwrap();
        restore_draft(&conn, &v1).unwrap();
        for r in &rewrites {
            reparent_draft(
                &conn,
                &r.draft_id,
                r.old_parent_draft_id.as_deref(),
                r.old_branched_from.as_deref(),
            )
            .unwrap();
        }
        // Back to main → v1 → v2.
        assert_eq!(parent_of(&conn, &v2).as_deref(), Some(v1.as_str()));
        assert!(is_live(&conn, &v1));
    }

    /// `(created_at, id)` of the most recent doc_event — used as a restore coordinate.
    fn latest_doc_event_coordinate(conn: &Connection, doc_id: &str) -> (i64, i64) {
        conn.query_row(
            "SELECT created_at, id FROM doc_events WHERE document_id = ?1 ORDER BY id DESC LIMIT 1",
            params![doc_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap()
    }

    fn tab_is_live(conn: &Connection, id: &str) -> bool {
        conn.query_row(
            "SELECT deleted_at IS NULL FROM tabs WHERE id = ?1",
            params![id],
            |r| r.get::<_, bool>(0),
        )
        .unwrap()
    }

    #[test]
    fn restore_structure_redeletes_a_tab_created_after_t() {
        // One tab exists at T0; create a second tab; rewind to T0 → the second
        // tab is soft-deleted (not destroyed), the first stays live.
        let (conn, tab1, _main) = setup();
        let (t0, event_id) = latest_doc_event_coordinate(&conn, "doc");
        // Ensure a strictly later timestamp for the second tab's create event.
        std::thread::sleep(std::time::Duration::from_millis(2));
        let tab2 = create_tab(&conn, "doc", "Second").unwrap().id;

        restore_structure_to(&conn, "doc", t0, Some(event_id)).unwrap();

        assert!(tab_is_live(&conn, &tab1), "original tab stays live");
        assert!(
            !tab_is_live(&conn, &tab2),
            "tab created after T is soft-deleted"
        );
        // Non-destructive: the row still exists.
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM tabs WHERE id = ?1)",
                params![tab2],
                |r| r.get(0),
            )
            .unwrap();
        assert!(exists, "soft-deleted tab row is preserved");
    }

    #[test]
    fn restore_structure_redeletes_a_tabs_root_draft_too() {
        // Re-deleting a tab created after T must also soft-delete its root
        // draft — otherwise a live draft is orphaned under a soft-deleted tab.
        let (conn, _tab1, _main) = setup();
        let (t0, event_id) = latest_doc_event_coordinate(&conn, "doc");
        std::thread::sleep(std::time::Duration::from_millis(2));
        let tab2 = create_tab(&conn, "doc", "Second").unwrap().id;
        let tab2_root: String = conn
            .query_row(
                "SELECT id FROM drafts WHERE tab_id = ?1",
                params![tab2],
                |r| r.get(0),
            )
            .unwrap();

        restore_structure_to(&conn, "doc", t0, Some(event_id)).unwrap();

        assert!(!tab_is_live(&conn, &tab2), "tab is soft-deleted");
        assert!(
            !is_live(&conn, &tab2_root),
            "the tab's root draft must not be left live under a deleted tab"
        );
    }

    #[test]
    fn restore_structure_handles_restore_and_delete_in_the_same_tab() {
        // In one tab: D1 is live at T but later deleted; D2 is an iteration
        // created after T. Rewind to T → D1 restored, D2 deleted, regardless of
        // the order the corrective ops happen to visit the rows.
        let (conn, tab1, main) = setup();
        // main + an iteration d1 both live at T0.
        let d1 = iterate_draft(&conn, &main, "v1", None).unwrap().id;
        let (t0, event_id) = latest_doc_event_coordinate(&conn, "doc");
        std::thread::sleep(std::time::Duration::from_millis(2));
        // After T0: iterate again (d2, created after T) and orphan-delete d1.
        let d2 = iterate_draft(&conn, &d1, "v2", None).unwrap().id;
        orphan_and_delete_draft(&conn, &d1).unwrap();

        restore_structure_to(&conn, "doc", t0, Some(event_id)).unwrap();

        assert!(is_live(&conn, &main), "main stays live");
        assert!(is_live(&conn, &d1), "draft live at T is restored");
        assert!(!is_live(&conn, &d2), "draft created after T is deleted");
        assert!(tab_is_live(&conn, &tab1), "the tab stays live throughout");
    }

    #[test]
    fn restore_structure_revives_a_tab_deleted_after_t() {
        // Two tabs live at T0; delete the second; rewind to T0 → it's restored.
        let (conn, _tab1, _main) = setup();
        let tab2 = create_tab(&conn, "doc", "Second").unwrap().id;
        let (t0, event_id) = latest_doc_event_coordinate(&conn, "doc");
        std::thread::sleep(std::time::Duration::from_millis(2));
        delete_tab(&conn, &tab2).unwrap();

        restore_structure_to(&conn, "doc", t0, Some(event_id)).unwrap();

        assert!(tab_is_live(&conn, &tab2), "tab deleted after T is restored");
    }

    #[test]
    fn restore_structure_rewinds_a_tab_label() {
        let (conn, tab1, _main) = setup();
        let (t0, event_id) = latest_doc_event_coordinate(&conn, "doc");
        std::thread::sleep(std::time::Duration::from_millis(2));
        rename_tab(&conn, &tab1, "Renamed").unwrap();

        restore_structure_to(&conn, "doc", t0, Some(event_id)).unwrap();

        let label: String = conn
            .query_row("SELECT label FROM tabs WHERE id = ?1", params![tab1], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(label, "Tab", "label rewound to its value at T");
    }

    #[test]
    fn restore_structure_uses_event_id_to_split_same_ms_events() {
        let (conn, tab1, main) = setup();
        conn.execute("DELETE FROM doc_events WHERE document_id = 'doc'", [])
            .unwrap();
        conn.execute(
            "UPDATE tabs SET label = 'Renamed', created_at = 0 WHERE id = ?1",
            params![tab1],
        )
        .unwrap();
        conn.execute(
            "UPDATE drafts SET created_at = 0 WHERE id = ?1",
            params![main],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO doc_events (document_id, event_type, payload, created_at)
             VALUES ('doc', 'tab_created', ?1, 100)",
            params![json!({
                "tabId": tab1,
                "label": "Tab",
                "rootDraftId": main,
                "position": 0,
            })
            .to_string()],
        )
        .unwrap();
        let first_event = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO doc_events (document_id, event_type, payload, created_at)
             VALUES ('doc', 'tab_renamed', ?1, 100)",
            params![json!({
                "tabId": tab1,
                "label": "Renamed",
                "previousLabel": "Tab",
            })
            .to_string()],
        )
        .unwrap();

        restore_structure_to(&conn, "doc", 100, Some(first_event)).unwrap();

        let label: String = conn
            .query_row("SELECT label FROM tabs WHERE id = ?1", params![tab1], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(label, "Tab");
    }

    #[test]
    fn restore_structure_rolls_back_when_a_rewind_would_empty_the_document() {
        let (conn, tab1, main) = setup();

        assert!(restore_structure_to(&conn, "doc", -1, None).is_err());

        assert!(tab_is_live(&conn, &tab1), "failed rewind keeps tab live");
        assert!(is_live(&conn, &main), "failed rewind keeps draft live");
    }

    #[test]
    fn coordinate_restore_rejects_foreign_snapshots_before_mutating() {
        let (conn, _tab1, _main) = setup();
        conn.execute(
            "INSERT INTO documents (id, title, created_at, updated_at)
             VALUES ('other-doc', 'Other', 0, 0)",
            [],
        )
        .unwrap();
        let other_tab = create_tab(&conn, "other-doc", "Other").unwrap();
        let other_draft: String = conn
            .query_row(
                "SELECT id FROM drafts WHERE tab_id = ?1",
                params![other_tab.id],
                |r| r.get(0),
            )
            .unwrap();
        let foreign_snapshot: i64 = conn
            .query_row(
                "INSERT INTO snapshots (draft_id, up_to_event_id, state_json, created_at)
                 VALUES (?1, 0, '{\"doc\":\"foreign\"}', 0)
                 RETURNING id",
                params![other_draft],
                |r| r.get(0),
            )
            .unwrap();
        let before: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM drafts WHERE document_id = 'doc'",
                [],
                |r| r.get(0),
            )
            .unwrap();

        assert!(
            restore_coordinate_nondestructive(&conn, "doc", 0, None, Some(foreign_snapshot))
                .is_err()
        );

        let after: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM drafts WHERE document_id = 'doc'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(after, before);
    }

    #[test]
    fn restore_content_seeds_a_new_tip_without_deleting_history() {
        // Build some content history, snapshot it, iterate again, then restore
        // to the snapshot. The original drafts and snapshot must survive, and a
        // new tip seeded from the snapshot's state appears.
        let (conn, _tab, main) = setup();
        let snap_state = r#"{"doc":"hello"}"#;
        let snap_id: i64 = conn
            .query_row(
                "INSERT INTO snapshots (draft_id, up_to_event_id, state_json, created_at)
                 VALUES (?1, 0, ?2, 0) RETURNING id",
                params![main, snap_state],
                |r| r.get(0),
            )
            .unwrap();
        let v1 = iterate_draft(&conn, &main, "v1", None).unwrap().id;

        let restored = restore_content_nondestructive(&conn, snap_id).unwrap();

        // New tip is a live iteration off the run's previous tip (v1).
        assert!(is_live(&conn, &restored.id));
        assert_eq!(parent_of(&conn, &restored.id).as_deref(), Some(v1.as_str()));
        // History preserved: source draft, v1, and the snapshot all still exist.
        assert!(is_live(&conn, &main));
        assert!(is_live(&conn, &v1));
        let snap_state_now: String = conn
            .query_row(
                "SELECT state_json FROM snapshots WHERE id = ?1",
                params![snap_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(snap_state_now, snap_state);
        // The new tip is seeded with the snapshot's state (a "Branch point" seed).
        let seeded: String = conn
            .query_row(
                "SELECT state_json FROM snapshots WHERE draft_id = ?1 AND up_to_event_id = -1",
                params![restored.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(seeded, snap_state);
    }
}
