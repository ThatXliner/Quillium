use quillium_lib::db::{
    documents::{create_document, create_draft, list_documents},
    events::{append_event, create_snapshot},
    load::load_document_state,
    schema::init_schema,
};
use rusqlite::Connection;

fn in_memory_db() -> Connection {
    let conn = Connection::open_in_memory().expect("in-memory DB");
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;",
    )
    .expect("pragmas");
    init_schema(&conn).expect("schema init");
    conn
}

#[test]
fn test_schema_creation() {
    let conn = in_memory_db();
    // All tables should exist — verify by running a simple query on each
    conn.execute_batch(
        "SELECT * FROM documents LIMIT 0;
         SELECT * FROM drafts LIMIT 0;
         SELECT * FROM events LIMIT 0;
         SELECT * FROM snapshots LIMIT 0;
         SELECT * FROM _meta LIMIT 0;",
    )
    .expect("all tables exist");
}

#[test]
fn test_append_event_increments_id() {
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Test Doc").expect("create doc");
    let draft_id = create_draft(&conn, &doc_id, "Draft").expect("create draft");

    let payload = r#"{"type":"doc_change","changes":[]}"#;

    let r0 = append_event(&conn, &draft_id, payload).expect("append 0");
    let r1 = append_event(&conn, &draft_id, payload).expect("append 1");
    let r2 = append_event(&conn, &draft_id, payload).expect("append 2");

    // IDs must be strictly increasing (autoincrement guarantees this)
    assert!(r0.event_id < r1.event_id);
    assert!(r1.event_id < r2.event_id);
}

#[test]
fn test_snapshot_threshold_event_count() {
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Test Doc").expect("create doc");
    let draft_id = create_draft(&conn, &doc_id, "Draft").expect("create draft");

    let payload = r#"{"type":"doc_change","changes":[]}"#;

    // First 49 events — should not trigger snapshot
    for i in 0..49 {
        let r = append_event(&conn, &draft_id, payload).expect("append");
        assert!(!r.needs_snapshot, "event {i}: should not need snapshot yet");
    }

    // 50th event — threshold reached
    let r = append_event(&conn, &draft_id, payload).expect("append 50th");
    assert!(r.needs_snapshot, "50th event should trigger snapshot");
}

#[test]
fn test_snapshot_threshold_time() {
    // This test injects a fake old snapshot to simulate time passage.
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Test Doc").expect("create doc");
    let draft_id = create_draft(&conn, &doc_id, "Draft").expect("create draft");

    // Insert a snapshot that's 130 seconds old
    let old_time_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
        - 130_000; // 130 seconds ago

    conn.execute(
        "INSERT INTO snapshots (draft_id, up_to_event_id, state_json, created_at)
         VALUES (?1, -1, '{}', ?2)",
        rusqlite::params![draft_id, old_time_ms],
    )
    .expect("insert old snapshot");

    // Even just 1 event should trigger a snapshot because 130s > 120s threshold
    let payload = r#"{"type":"doc_change","changes":[]}"#;
    let r = append_event(&conn, &draft_id, payload).expect("append");
    assert!(r.needs_snapshot, "time threshold should trigger snapshot");
}

#[test]
fn test_load_with_events_since_snapshot() {
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Test Doc").expect("create doc");
    let draft_id = create_draft(&conn, &doc_id, "Draft").expect("create draft");

    // Register active draft in _meta
    conn.execute(
        "INSERT OR REPLACE INTO _meta (key, value) VALUES (?1, ?2)",
        rusqlite::params![format!("active_draft:{}", doc_id), draft_id],
    )
    .expect("set meta");

    // Seed snapshot at event_id -1 (before any events)
    create_snapshot(&conn, &draft_id, r#"{"doc":"hello"}"#, -1).expect("snapshot");

    // Append 3 events
    let payload = r#"{"type":"doc_change","changes":[]}"#;
    append_event(&conn, &draft_id, payload).expect("e0");
    append_event(&conn, &draft_id, payload).expect("e1");
    append_event(&conn, &draft_id, payload).expect("e2");

    let result = load_document_state(&conn, &doc_id, None).expect("load");
    assert!(result.snapshot_state_json.is_some());
    assert_eq!(result.snapshot_event_id, -1);
    assert_eq!(result.events_since.len(), 3);
    // IDs must be strictly increasing
    assert!(result.events_since[0].id < result.events_since[1].id);
    assert!(result.events_since[1].id < result.events_since[2].id);
}
