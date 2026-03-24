use rusqlite::{params, Connection, Result};
use std::time::{SystemTime, UNIX_EPOCH};

use super::{AppendEventResult, SnapshotMeta};

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

    // Derive event_type from payload JSON
    let event_type = extract_event_type(payload_json);

    conn.execute(
        "INSERT INTO events (draft_id, event_type, payload, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![draft_id, event_type, payload_json, now],
    )?;

    // The AUTOINCREMENT id is the canonical event identifier.
    let event_id = conn.last_insert_rowid();

    // Update document updated_at via draft join
    conn.execute(
        "UPDATE documents SET updated_at = ?1
         WHERE id = (SELECT document_id FROM drafts WHERE id = ?2)",
        params![now, draft_id],
    )?;

    // Check snapshot threshold
    let needs_snapshot = check_snapshot_threshold(conn, draft_id, now)?;

    Ok(AppendEventResult {
        event_id,
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
            "SELECT up_to_event_id, created_at FROM snapshots
             WHERE draft_id = ?1 ORDER BY up_to_event_id DESC LIMIT 1",
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
        Some((last_event_id, last_snap_time)) => {
            // Events since last snapshot
            let events_since: i64 = conn.query_row(
                "SELECT COUNT(*) FROM events WHERE draft_id = ?1 AND id > ?2",
                params![draft_id, last_event_id],
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
    up_to_event_id: i64,
) -> Result<()> {
    let now = now_ms();
    conn.execute(
        "INSERT INTO snapshots (draft_id, up_to_event_id, state_json, created_at, label)
         VALUES (?1, ?2, ?3, ?4, NULL)",
        params![draft_id, up_to_event_id, state_json, now],
    )?;
    Ok(())
}

pub fn create_named_snapshot(
    conn: &Connection,
    draft_id: &str,
    state_json: &str,
    up_to_event_id: i64,
    label: &str,
) -> Result<i64> {
    let now = now_ms();
    conn.execute(
        "INSERT INTO snapshots (draft_id, up_to_event_id, state_json, created_at, label)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![draft_id, up_to_event_id, state_json, now, label],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_snapshots(conn: &Connection, draft_id: &str) -> Result<Vec<SnapshotMeta>> {
    let mut stmt = conn.prepare(
        "SELECT id, draft_id, up_to_event_id, created_at, label
         FROM snapshots WHERE draft_id = ?1
         ORDER BY up_to_event_id DESC",
    )?;
    let rows = stmt.query_map(params![draft_id], |row| {
        Ok(SnapshotMeta {
            id: row.get(0)?,
            draft_id: row.get(1)?,
            up_to_event_id: row.get(2)?,
            created_at: row.get(3)?,
            label: row.get(4)?,
        })
    })?;
    rows.collect()
}

pub fn label_snapshot(conn: &Connection, snapshot_id: i64, label: &str) -> Result<()> {
    conn.execute(
        "UPDATE snapshots SET label = ?1 WHERE id = ?2",
        params![label, snapshot_id],
    )?;
    Ok(())
}

pub fn restore_to_snapshot(
    conn: &Connection,
    draft_id: &str,
    snapshot_id: i64,
) -> Result<()> {
    let up_to_event_id: i64 = conn.query_row(
        "SELECT up_to_event_id FROM snapshots WHERE id = ?1 AND draft_id = ?2",
        params![snapshot_id, draft_id],
        |row| row.get(0),
    )?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM events WHERE draft_id = ?1 AND id > ?2",
        params![draft_id, up_to_event_id],
    )?;
    tx.execute(
        "DELETE FROM snapshots WHERE draft_id = ?1 AND up_to_event_id > ?2",
        params![draft_id, up_to_event_id],
    )?;
    tx.commit()?;
    Ok(())
}
