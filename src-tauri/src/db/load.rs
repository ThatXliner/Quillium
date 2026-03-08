use rusqlite::{params, Connection, Result};

use super::{EventRecord, LoadResult};

pub fn load_document_state(
    conn: &Connection,
    doc_id: &str,
    draft_id: Option<&str>,
) -> Result<LoadResult> {
    // Resolve draft_id: use provided, or find active draft for doc
    let resolved_draft_id = match draft_id {
        Some(id) => id.to_string(),
        None => {
            // Try _meta for active_draft:{doc_id}
            let meta_key = format!("active_draft:{}", doc_id);
            let from_meta: Option<String> = conn
                .query_row(
                    "SELECT value FROM _meta WHERE key = ?1",
                    params![meta_key],
                    |row| row.get(0),
                )
                .ok();

            if let Some(id) = from_meta {
                id
            } else {
                // Fall back to first active draft
                conn.query_row(
                    "SELECT id FROM drafts WHERE document_id = ?1 AND is_active = 1
                     ORDER BY created_at ASC LIMIT 1",
                    params![doc_id],
                    |row| row.get(0),
                )
                .unwrap_or_default()
            }
        }
    };

    if resolved_draft_id.is_empty() {
        return Ok(LoadResult {
            snapshot_state_json: None,
            snapshot_event_seq: -1,
            events_since: vec![],
        });
    }

    // Get the latest snapshot
    let snapshot: Option<(String, i64)> = conn
        .query_row(
            "SELECT state_json, up_to_event_seq FROM snapshots
             WHERE draft_id = ?1 ORDER BY up_to_event_seq DESC LIMIT 1",
            params![resolved_draft_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .ok();

    let (snapshot_state_json, snapshot_event_seq) = match snapshot {
        Some((json, seq)) => (Some(json), seq),
        None => (None, -1),
    };

    // Get events after the snapshot
    let mut stmt = conn.prepare(
        "SELECT id, seq, event_type, payload, created_at FROM events
         WHERE draft_id = ?1 AND seq > ?2 ORDER BY seq ASC",
    )?;
    let events: Vec<EventRecord> = stmt
        .query_map(params![resolved_draft_id, snapshot_event_seq], |row| {
            Ok(EventRecord {
                id: row.get(0)?,
                seq: row.get(1)?,
                event_type: row.get(2)?,
                payload: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

    Ok(LoadResult {
        snapshot_state_json,
        snapshot_event_seq,
        events_since: events,
    })
}
