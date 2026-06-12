use rusqlite::{params, Connection, Result};

use super::tabs::{get_active_draft, get_active_tab};
use super::{EventRecord, LoadResult};

/// Resolves the draft a bare document load should show: the active tab's
/// active draft. Falls back through first-tab/first-draft and finally the
/// pre-tabs `_meta` key so old databases keep loading correctly.
fn resolve_default_draft(conn: &Connection, doc_id: &str) -> Option<String> {
    let tab_id = match get_active_tab(conn, doc_id).ok().flatten() {
        Some(id) => Some(id),
        None => conn
            .query_row(
                "SELECT id FROM tabs WHERE document_id = ?1 ORDER BY position ASC LIMIT 1",
                params![doc_id],
                |row| row.get(0),
            )
            .ok(),
    };
    if let Some(tab_id) = tab_id {
        if let Some(draft) = get_active_draft(conn, &tab_id).ok().flatten() {
            return Some(draft);
        }
        if let Ok(draft) = conn.query_row(
            "SELECT id FROM drafts WHERE tab_id = ?1 ORDER BY created_at ASC LIMIT 1",
            params![tab_id],
            |row| row.get(0),
        ) {
            return Some(draft);
        }
    }
    // Legacy fallbacks for documents predating the tabs migration.
    let meta_key = format!("active_draft:{}", doc_id);
    if let Ok(draft) = conn.query_row(
        "SELECT value FROM _meta WHERE key = ?1",
        params![meta_key],
        |row| row.get(0),
    ) {
        return Some(draft);
    }
    conn.query_row(
        "SELECT id FROM drafts WHERE document_id = ?1 AND is_active = 1
         ORDER BY created_at ASC LIMIT 1",
        params![doc_id],
        |row| row.get(0),
    )
    .ok()
}

pub fn load_document_state(
    conn: &Connection,
    doc_id: &str,
    draft_id: Option<&str>,
) -> Result<LoadResult> {
    // Resolve draft_id: use provided, else active tab → that tab's active
    // draft, else legacy fallbacks (pre-tabs _meta key, first active draft).
    let resolved_draft_id = match draft_id {
        Some(id) => id.to_string(),
        None => resolve_default_draft(conn, doc_id).unwrap_or_default(),
    };

    if resolved_draft_id.is_empty() {
        return Ok(LoadResult {
            snapshot_state_json: None,
            snapshot_event_id: -1,
            events_since: vec![],
        });
    }

    // Get the latest snapshot
    let snapshot: Option<(String, i64)> = conn
        .query_row(
            "SELECT state_json, up_to_event_id FROM snapshots
             WHERE draft_id = ?1 ORDER BY up_to_event_id DESC LIMIT 1",
            params![resolved_draft_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .ok();

    let (snapshot_state_json, snapshot_event_id) = match snapshot {
        Some((json, id)) => (Some(json), id),
        None => (None, -1),
    };

    // Get events after the snapshot
    let mut stmt = conn.prepare(
        "SELECT id, event_type, payload, created_at FROM events
         WHERE draft_id = ?1 AND id > ?2 ORDER BY id ASC",
    )?;
    let events: Vec<EventRecord> = stmt
        .query_map(params![resolved_draft_id, snapshot_event_id], |row| {
            Ok(EventRecord {
                id: row.get(0)?,
                event_type: row.get(1)?,
                payload: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    Ok(LoadResult {
        snapshot_state_json,
        snapshot_event_id,
        events_since: events,
    })
}
