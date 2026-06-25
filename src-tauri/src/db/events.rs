use rusqlite::{params, Connection, Result};
use std::time::{SystemTime, UNIX_EPOCH};

use super::{AppendEventResult, EventRecord, SnapshotMeta};

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

/// Returns the full append-only event stream for a draft, oldest first.
/// Unlike `load_document_state`, this ignores snapshots and never truncates —
/// it is the provenance/authorship-proof read path that needs every event.
pub fn list_draft_events(conn: &Connection, draft_id: &str) -> Result<Vec<EventRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, event_type, payload, created_at FROM events
         WHERE draft_id = ?1 ORDER BY id ASC",
    )?;
    let rows = stmt.query_map(params![draft_id], |row| {
        Ok(EventRecord {
            id: row.get(0)?,
            event_type: row.get(1)?,
            payload: row.get(2)?,
            created_at: row.get(3)?,
        })
    })?;
    rows.collect()
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
    let snapshot_id = conn.last_insert_rowid();
    // Named checkpoints are user-visible milestones — surface them in the
    // document-level timeline too.
    if let Ok((doc_id, draft_label)) = conn.query_row(
        "SELECT document_id, label FROM drafts WHERE id = ?1",
        params![draft_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    ) {
        let _ = super::tabs::log_doc_event(
            conn,
            &doc_id,
            "checkpoint_created",
            &serde_json::json!({ "draftId": draft_id, "draftLabel": draft_label, "label": label }),
        );
    }
    Ok(snapshot_id)
}

pub fn list_snapshots(conn: &Connection, draft_id: &str) -> Result<Vec<SnapshotMeta>> {
    let mut stmt = conn.prepare(
        "SELECT id, draft_id, up_to_event_id, created_at, label
         FROM snapshots WHERE draft_id = ?1
         ORDER BY created_at DESC, id DESC",
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

pub fn load_snapshot_state(conn: &Connection, snapshot_id: i64) -> Result<Option<String>> {
    match conn.query_row(
        "SELECT state_json FROM snapshots WHERE id = ?1",
        params![snapshot_id],
        |row| row.get(0),
    ) {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn get_snapshot_retention(conn: &Connection) -> Result<Option<i64>> {
    let result: rusqlite::Result<String> = conn.query_row(
        "SELECT value FROM _meta WHERE key = 'snapshot_retention_days'",
        [],
        |row| row.get(0),
    );
    match result {
        Ok(val) => {
            if val == "never" {
                Ok(None)
            } else {
                Ok(val.parse::<i64>().ok())
            }
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn set_snapshot_retention(conn: &Connection, days: Option<i64>) -> Result<()> {
    let value = match days {
        Some(d) => d.to_string(),
        None => "never".to_string(),
    };
    conn.execute(
        "INSERT INTO _meta (key, value) VALUES ('snapshot_retention_days', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![value],
    )?;
    Ok(())
}

pub fn get_snapshot_storage_size(conn: &Connection, draft_id: &str) -> Result<i64> {
    conn.query_row(
        "SELECT COALESCE(SUM(LENGTH(state_json)), 0) FROM snapshots WHERE draft_id = ?1",
        params![draft_id],
        |row| row.get(0),
    )
}

pub fn prune_snapshots_keep_last_n(conn: &Connection, draft_id: &str, keep_n: i64) -> Result<u64> {
    let deleted = conn.execute(
        "DELETE FROM snapshots
         WHERE draft_id = ?1
           AND label IS NULL
           AND id NOT IN (
               SELECT id FROM snapshots
               WHERE draft_id = ?1 AND label IS NULL
               ORDER BY created_at DESC
               LIMIT ?2
           )",
        params![draft_id, keep_n],
    )?;
    Ok(deleted as u64)
}

pub fn prune_snapshots_older_than(
    conn: &Connection,
    draft_id: &str,
    older_than_days: i64,
) -> Result<u64> {
    // Overflow safety: if the multiplication or subtraction overflows,
    // clamp to now_ms() so we never get cutoff_ms = 0 and delete everything.
    let cutoff_ms = older_than_days
        .checked_mul(86_400_000)
        .and_then(|o| now_ms().checked_sub(o))
        .unwrap_or_else(now_ms);
    let deleted = conn.execute(
        "DELETE FROM snapshots
         WHERE draft_id = ?1
           AND label IS NULL
           AND created_at < ?2",
        params![draft_id, cutoff_ms],
    )?;
    Ok(deleted as u64)
}

pub fn label_snapshot(conn: &Connection, snapshot_id: i64, label: &str) -> Result<()> {
    conn.execute(
        "UPDATE snapshots SET label = ?1 WHERE id = ?2",
        params![label, snapshot_id],
    )?;
    Ok(())
}

pub fn restore_to_snapshot(conn: &Connection, draft_id: &str, snapshot_id: i64) -> Result<()> {
    let up_to_event_id: i64 = conn.query_row(
        "SELECT up_to_event_id FROM snapshots WHERE id = ?1 AND draft_id = ?2",
        params![snapshot_id, draft_id],
        |row| row.get(0),
    )?;
    // SAFETY: `transaction()` requires `&mut Connection`, but the whole db
    // layer takes `&Connection` because `DbState` wraps a `Mutex<Connection>`
    // and `MutexGuard<Connection>` only derefs to a shared ref. This is the
    // standard rusqlite workaround for that pattern. Nested transactions are
    // impossible here because the `DbState` mutex serializes all Tauri
    // commands — only one command can hold the connection at a time.
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::open_db;
    use crate::db::tabs::create_tab;

    /// Fresh migrated DB with one document and two tabs (each tab owns a main
    /// draft); returns (conn, draft_a, draft_b) for two distinct draft_ids.
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
        let tab_a = create_tab(&conn, "doc", "A").unwrap();
        let tab_b = create_tab(&conn, "doc", "B").unwrap();
        let draft_a: String = conn
            .query_row(
                "SELECT id FROM drafts WHERE tab_id = ?1",
                params![tab_a.id],
                |r| r.get(0),
            )
            .unwrap();
        let draft_b: String = conn
            .query_row(
                "SELECT id FROM drafts WHERE tab_id = ?1",
                params![tab_b.id],
                |r| r.get(0),
            )
            .unwrap();
        (conn, draft_a, draft_b)
    }

    #[test]
    fn lists_all_events_for_draft_in_id_order() {
        let (conn, draft_a, draft_b) = setup();
        // Three events on A interleaved with one on B to prove isolation.
        append_event(&conn, &draft_a, r#"{"type":"doc","n":1}"#).unwrap();
        append_event(&conn, &draft_b, r#"{"type":"doc","n":99}"#).unwrap();
        append_event(&conn, &draft_a, r#"{"type":"doc","n":2}"#).unwrap();
        append_event(&conn, &draft_a, r#"{"type":"doc","n":3}"#).unwrap();

        let events = list_draft_events(&conn, &draft_a).unwrap();

        // (a) correct count for one draft (B's event excluded).
        assert_eq!(events.len(), 3);
        // (b) ordering by id ASC.
        let ids: Vec<i64> = events.iter().map(|e| e.id).collect();
        let mut sorted = ids.clone();
        sorted.sort();
        assert_eq!(ids, sorted);
        assert_eq!(events[0].payload, r#"{"type":"doc","n":1}"#);
        assert_eq!(events[1].payload, r#"{"type":"doc","n":2}"#);
        assert_eq!(events[2].payload, r#"{"type":"doc","n":3}"#);
        // (c) draft isolation: none of A's events belong to B's payload.
        assert!(events.iter().all(|e| !e.payload.contains("99")));
    }

    #[test]
    fn returns_empty_for_draft_with_no_events() {
        let (conn, draft_a, _draft_b) = setup();
        let events = list_draft_events(&conn, &draft_a).unwrap();
        assert!(events.is_empty());
    }
}
