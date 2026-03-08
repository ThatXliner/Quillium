use rusqlite::{params, Connection, Result};
use std::time::{SystemTime, UNIX_EPOCH};

use super::AppendEventResult;

const SNAPSHOT_EVENT_THRESHOLD: i64 = 50;
const SNAPSHOT_TIME_THRESHOLD_SECS: i64 = 120;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

pub fn append_event(
    conn: &Connection,
    draft_id: &str,
    payload_json: &str,
) -> Result<AppendEventResult> {
    let now = now_ms();

    // Determine next sequence number
    let next_seq: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(seq), -1) + 1 FROM events WHERE draft_id = ?1",
            params![draft_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    // Derive event_type from payload JSON
    let event_type = extract_event_type(payload_json);

    conn.execute(
        "INSERT INTO events (draft_id, seq, event_type, payload, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![draft_id, next_seq, event_type, payload_json, now],
    )?;

    // Update document updated_at via draft join
    conn.execute(
        "UPDATE documents SET updated_at = ?1
         WHERE id = (SELECT document_id FROM drafts WHERE id = ?2)",
        params![now, draft_id],
    )?;

    // Check snapshot threshold
    let needs_snapshot = check_snapshot_threshold(conn, draft_id, now)?;

    Ok(AppendEventResult {
        event_seq: next_seq,
        needs_snapshot,
    })
}

fn extract_event_type(payload_json: &str) -> String {
    // Fast parse: find "type":"..." without full JSON parse
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(payload_json) {
        if let Some(t) = v.get("type").and_then(|t| t.as_str()) {
            return t.to_string();
        }
    }
    "unknown".to_string()
}

fn check_snapshot_threshold(conn: &Connection, draft_id: &str, now_ms: i64) -> Result<bool> {
    // Get the latest snapshot for this draft
    let latest_snapshot: Option<(i64, i64)> = conn
        .query_row(
            "SELECT up_to_event_seq, created_at FROM snapshots
             WHERE draft_id = ?1 ORDER BY up_to_event_seq DESC LIMIT 1",
            params![draft_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .ok();

    match latest_snapshot {
        None => {
            // No snapshot at all — check total event count
            let total: i64 = conn.query_row(
                "SELECT COUNT(*) FROM events WHERE draft_id = ?1",
                params![draft_id],
                |row| row.get(0),
            )?;
            Ok(total >= SNAPSHOT_EVENT_THRESHOLD)
        }
        Some((last_seq, last_snap_time)) => {
            // Events since last snapshot
            let events_since: i64 = conn.query_row(
                "SELECT COUNT(*) FROM events WHERE draft_id = ?1 AND seq > ?2",
                params![draft_id, last_seq],
                |row| row.get(0),
            )?;
            let secs_since = (now_ms - last_snap_time) / 1000;
            Ok(events_since >= SNAPSHOT_EVENT_THRESHOLD
                || secs_since >= SNAPSHOT_TIME_THRESHOLD_SECS)
        }
    }
}

pub fn create_snapshot(
    conn: &Connection,
    draft_id: &str,
    state_json: &str,
    up_to_event_seq: i64,
) -> Result<()> {
    let now = now_ms();
    conn.execute(
        "INSERT INTO snapshots (draft_id, up_to_event_seq, state_json, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![draft_id, up_to_event_seq, state_json, now],
    )?;

    // Prune: keep only the latest 3 snapshots per draft
    conn.execute(
        "DELETE FROM snapshots WHERE draft_id = ?1
         AND id NOT IN (
             SELECT id FROM snapshots WHERE draft_id = ?1
             ORDER BY up_to_event_seq DESC LIMIT 3
         )",
        params![draft_id],
    )?;

    Ok(())
}
