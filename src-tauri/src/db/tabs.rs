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

use super::{DocEventRecord, DraftMeta, TabMeta};

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

/// Persists a new tab order. `ordered_ids` is the full list of the
/// document's live tabs in their new left-to-right order; each tab's
/// `position` is rewritten to its index. Reordering is purely cosmetic, so
/// it isn't logged to the doc-event audit trail.
pub fn reorder_tabs(conn: &Connection, doc_id: &str, ordered_ids: &[String]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    for (position, tab_id) in ordered_ids.iter().enumerate() {
        // Scope the update to the document so a stale/foreign id can't
        // stomp another document's tab positions.
        tx.execute(
            "UPDATE tabs SET position = ?1 WHERE id = ?2 AND document_id = ?3",
            params![position as i64, tab_id, doc_id],
        )?;
    }
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
/// live, parallel explorations. Any live draft can be branched, including the
/// storyline root and branch roots.
pub fn branch_draft(
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

fn guard_not_storyline_root(
    parent_draft_id: &Option<String>,
    branched_from: &Option<String>,
) -> Result<()> {
    if parent_draft_id.is_none() && branched_from.is_none() {
        return Err(refuse("Cannot delete the storyline root draft"));
    }
    Ok(())
}

/// Soft-deletes a single draft. Its events and snapshots are untouched, so
/// restoring from the version history brings the text back exactly. Refuses
/// if it is the storyline root or the tab's last live draft — a draft with
/// iterations or branches off it can be deleted, but callers must first
/// detach/relocate or cascade those children (see `orphan_and_delete_draft` /
/// `cascade_delete_draft`). The draft's run relocks (the tip may move back).
pub fn delete_draft(conn: &Connection, draft_id: &str) -> Result<()> {
    let (doc_id, label, tab_id, parent_draft_id, branched_from): (
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
    ) =
        conn.query_row(
            "SELECT document_id, label, tab_id, parent_draft_id, branched_from FROM drafts WHERE id = ?1",
            params![draft_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )?;
    guard_not_storyline_root(&parent_draft_id, &branched_from)?;
    guard_tab_not_emptied(conn, &tab_id, 1)?;
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
/// is its `parent_draft_id` when it is an iteration, or its `branched_from`
/// source when it is a branch root. The storyline root has no anchor and is
/// protected from deletion.
///
/// - Iteration children (`parent_draft_id = D`) splice `D` out of the run:
///   they adopt `D`'s parent. If `D` was a branch root, they become branch
///   roots off `D`'s original source.
/// - Branch children (`branched_from = D`) re-point to `D`'s anchor, whether
///   that anchor is an iteration parent or the source of the deleted branch
///   root.
pub fn orphan_and_delete_draft(conn: &Connection, draft_id: &str) -> Result<Vec<ReparentEntry>> {
    let (doc_id, label, tab_id, parent_draft_id, branched_from): (
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
    ) =
        conn.query_row(
            "SELECT document_id, label, tab_id, parent_draft_id, branched_from FROM drafts WHERE id = ?1",
            params![draft_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )?;
    guard_not_storyline_root(&parent_draft_id, &branched_from)?;
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
    let reattach_anchor = parent_draft_id.clone().or_else(|| branched_from.clone());
    for (child_id, old_parent, old_branched_from) in &children {
        let is_branch_child = old_branched_from.as_deref() == Some(draft_id);
        let (new_parent, new_branched_from): (Option<String>, Option<String>) = if is_branch_child {
            (None, reattach_anchor.clone())
        } else {
            // Iteration child: splice D out. If D was a branch root, its first
            // iteration becomes the new branch root off D's original source.
            let branch_anchor = if parent_draft_id.is_none() {
                branched_from.clone()
            } else {
                None
            };
            (parent_draft_id.clone(), branch_anchor)
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
/// (iterations and branches, transitively). Refuses if that would delete the
/// storyline root or empty the tab. Returns the deleted ids (the root first)
/// so Undo can restore them all.
pub fn cascade_delete_draft(conn: &Connection, draft_id: &str) -> Result<Vec<String>> {
    let (doc_id, label, tab_id, parent_draft_id, branched_from): (
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
    ) =
        conn.query_row(
            "SELECT document_id, label, tab_id, parent_draft_id, branched_from FROM drafts WHERE id = ?1",
            params![draft_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )?;
    guard_not_storyline_root(&parent_draft_id, &branched_from)?;

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

    guard_tab_not_emptied(conn, &tab_id, subtree.len() as i64)?;

    let tx = conn.unchecked_transaction()?;
    let now = now_ms();
    for id in &subtree {
        tx.execute(
            "UPDATE drafts SET deleted_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
    }
    // The deleted root's old run may have a new tip; relock from its parent.
    if let Some(ref parent) = parent_draft_id {
        relock_run(&tx, parent)?;
    }
    log_doc_event(
        &tx,
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
    tx.commit()?;
    Ok(subtree)
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
    fn branch_draft_allows_storyline_root() {
        let (conn, _tab, main) = setup();
        let b = branch_draft(&conn, &main, "b", None).unwrap().id;

        assert!(parent_of(&conn, &b).is_none());
        assert_eq!(branched_from(&conn, &b).as_deref(), Some(main.as_str()));
    }

    #[test]
    fn branch_draft_allows_branch_roots() {
        let (conn, _tab, main) = setup();
        let b1 = branch_draft(&conn, &main, "b1", None).unwrap().id;
        let b2 = branch_draft(&conn, &b1, "b2", None).unwrap().id;

        assert!(parent_of(&conn, &b2).is_none());
        assert_eq!(branched_from(&conn, &b2).as_deref(), Some(b1.as_str()));
    }

    #[test]
    fn delete_draft_allows_a_parent_now() {
        // main → v1 → v2; deleting v1 (a non-leaf) used to be refused.
        let (conn, _tab, main) = setup();
        let v1 = iterate_draft(&conn, &main, "v1", None).unwrap().id;
        let _v2 = iterate_draft(&conn, &v1, "v2", None).unwrap().id;
        // delete_draft itself is the childless primitive; the orphan/cascade
        // callers handle children. It must still reject the tab's last draft.
        assert!(delete_draft(&conn, &v1).is_ok());
        assert!(!is_live(&conn, &v1));
    }

    #[test]
    fn delete_draft_refuses_storyline_root() {
        let (conn, _tab, main) = setup();
        let _v1 = iterate_draft(&conn, &main, "v1", None).unwrap().id;
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
    fn orphan_iteration_reattaches_branch_to_parent() {
        // main → v1 ; branch b off v1. Orphan-delete v1 → b re-points to main.
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
    fn orphan_refuses_storyline_root() {
        let (conn, _tab, main) = setup();
        let _v1 = iterate_draft(&conn, &main, "v1", None).unwrap().id;

        assert!(orphan_and_delete_draft(&conn, &main).is_err());
        assert!(is_live(&conn, &main));
    }

    #[test]
    fn orphan_branch_root_reattaches_children_to_branch_source() {
        // main ├ b1 → b2
        //      └ b3
        //
        // Orphan-delete b1: b2 and b3 survive as branches off main.
        let (conn, _tab, main) = setup();
        let b1 = branch_draft(&conn, &main, "b1", None).unwrap().id;
        let b2 = iterate_draft(&conn, &b1, "b2", None).unwrap().id;
        let b3 = branch_draft(&conn, &b1, "b3", None).unwrap().id;

        orphan_and_delete_draft(&conn, &b1).unwrap();

        assert!(!is_live(&conn, &b1));
        assert!(parent_of(&conn, &b2).is_none());
        assert_eq!(branched_from(&conn, &b2).as_deref(), Some(main.as_str()));
        assert!(parent_of(&conn, &b3).is_none());
        assert_eq!(branched_from(&conn, &b3).as_deref(), Some(main.as_str()));
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
        // main → v1: the storyline root is protected.
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
}
