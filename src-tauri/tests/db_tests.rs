use quillium_lib::db::{
    documents::{create_document, create_draft, list_documents},
    events::{append_event, create_snapshot},
    load::load_document_state,
    schema::open_db,
    tabs::{
        create_tab, delete_draft, delete_tab, fork_draft, get_active_draft, list_tab_drafts,
        list_tabs, set_active_draft, set_active_tab, set_draft_locked,
    },
};
use rusqlite::Connection;

// open_db (rather than bare init_schema) so the tabs/draft-tree migration
// runs — production code assumes its ALTER-added columns exist.
fn in_memory_db() -> Connection {
    open_db(std::path::Path::new(":memory:")).expect("in-memory DB")
}

#[test]
fn test_schema_creation() {
    let conn = in_memory_db();
    // All tables should exist — verify by running a simple query on each
    conn.execute_batch(
        "SELECT * FROM documents LIMIT 0;
         SELECT * FROM tabs LIMIT 0;
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

// ── Tabs & draft tree (#160) ──────────────────────────────────────

#[test]
fn test_create_draft_creates_main_tab() {
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Doc").expect("doc");
    let draft_id = create_draft(&conn, &doc_id, "Draft").expect("draft");

    let tabs = list_tabs(&conn, &doc_id).expect("tabs");
    assert_eq!(tabs.len(), 1);
    assert_eq!(tabs[0].label, "Main");
    assert_eq!(tabs[0].tab_type, "draft");

    let drafts = list_tab_drafts(&conn, &tabs[0].id).expect("drafts");
    assert_eq!(drafts.len(), 1);
    assert_eq!(drafts[0].id, draft_id);
    assert_eq!(drafts[0].parent_draft_id, None);
    assert!(!drafts[0].locked);
}

#[test]
fn test_create_tab_seeds_root_draft() {
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Doc").expect("doc");
    let tab = create_tab(&conn, &doc_id, "Notes").expect("tab");

    assert_eq!(tab.label, "Notes");
    let drafts = list_tab_drafts(&conn, &tab.id).expect("drafts");
    assert_eq!(drafts.len(), 1);
    assert_eq!(drafts[0].label, "main");
    assert_eq!(drafts[0].parent_draft_id, None);
}

#[test]
fn test_fork_draft_plants_branch_point_and_locks_parent() {
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Doc").expect("doc");
    let tab = create_tab(&conn, &doc_id, "Main").expect("tab");
    let parent = &list_tab_drafts(&conn, &tab.id).expect("drafts")[0];

    let child = fork_draft(&conn, &parent.id, "v1", Some(r#"{"doc":"hello"}"#)).expect("fork");
    assert_eq!(child.parent_draft_id.as_deref(), Some(parent.id.as_str()));
    assert_eq!(child.tab_id.as_deref(), Some(tab.id.as_str()));

    // Parent is now soft-locked.
    let drafts = list_tab_drafts(&conn, &tab.id).expect("drafts");
    let parent_after = drafts.iter().find(|d| d.id == parent.id).unwrap();
    assert!(parent_after.locked);

    // The child loads the branch-point state with an empty event log.
    let loaded = load_document_state(&conn, &doc_id, Some(&child.id)).expect("load");
    assert_eq!(
        loaded.snapshot_state_json.as_deref(),
        Some(r#"{"doc":"hello"}"#)
    );
    assert_eq!(loaded.events_since.len(), 0);

    // The branch-point snapshot is labeled so auto-prune can't remove it.
    let label: String = conn
        .query_row(
            "SELECT label FROM snapshots WHERE draft_id = ?1",
            rusqlite::params![child.id],
            |row| row.get(0),
        )
        .expect("snapshot label");
    assert_eq!(label, "Branch point");
}

#[test]
fn test_delete_draft_refusals() {
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Doc").expect("doc");
    let tab = create_tab(&conn, &doc_id, "Main").expect("tab");
    let root = list_tab_drafts(&conn, &tab.id).expect("drafts")[0].clone_id();

    // Last draft of the tab cannot be deleted.
    assert!(delete_draft(&conn, &root).is_err());

    let child = fork_draft(&conn, &root, "v1", None).expect("fork");
    // A draft with children cannot be deleted.
    assert!(delete_draft(&conn, &root).is_err());
    // A leaf with siblings can.
    delete_draft(&conn, &child.id).expect("delete leaf");
    assert_eq!(list_tab_drafts(&conn, &tab.id).expect("drafts").len(), 1);
}

#[test]
fn test_delete_tab_refuses_last_and_cascades() {
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Doc").expect("doc");
    let tab1 = create_tab(&conn, &doc_id, "Main").expect("tab1");
    assert!(
        delete_tab(&conn, &tab1.id).is_err(),
        "last tab must be kept"
    );

    let tab2 = create_tab(&conn, &doc_id, "Notes").expect("tab2");
    let tab2_draft = list_tab_drafts(&conn, &tab2.id).expect("drafts")[0].clone_id();
    append_event(&conn, &tab2_draft, r#"{"type":"doc_change","changes":[]}"#).expect("event");

    delete_tab(&conn, &tab2.id).expect("delete tab2");
    assert_eq!(list_tabs(&conn, &doc_id).expect("tabs").len(), 1);
    let orphans: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM events WHERE draft_id = ?1",
            rusqlite::params![tab2_draft],
            |row| row.get(0),
        )
        .expect("count");
    assert_eq!(orphans, 0, "tab deletion removes its drafts' events");
}

#[test]
fn test_load_resolves_active_tab_and_draft() {
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Doc").expect("doc");
    let tab1 = create_tab(&conn, &doc_id, "Main").expect("tab1");
    let tab2 = create_tab(&conn, &doc_id, "Notes").expect("tab2");

    let tab2_root = list_tab_drafts(&conn, &tab2.id).expect("drafts")[0].clone_id();
    let tab2_child = fork_draft(&conn, &tab2_root, "v1", Some(r#"{"doc":"branch"}"#))
        .expect("fork")
        .id;

    set_active_tab(&conn, &doc_id, &tab2.id).expect("set tab");
    set_active_draft(&conn, &tab2.id, &tab2_child).expect("set draft");

    // A bare load must land on tab2's active draft, not tab1's root.
    let loaded = load_document_state(&conn, &doc_id, None).expect("load");
    assert_eq!(
        loaded.snapshot_state_json.as_deref(),
        Some(r#"{"doc":"branch"}"#)
    );

    // Stale active pointers fall back gracefully.
    delete_draft(&conn, &tab2_child).expect("delete child");
    assert_eq!(get_active_draft(&conn, &tab2.id).expect("active"), None);
    let fallback = load_document_state(&conn, &doc_id, None).expect("load fallback");
    assert!(fallback.snapshot_state_json.is_none());
    let _ = tab1; // tab1 exists to prove resolution prefers the active tab
}

#[test]
fn test_migration_backfills_pre_tabs_drafts() {
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Old Doc").expect("doc");
    // Simulate a pre-migration draft: inserted without a tab.
    conn.execute(
        "INSERT INTO drafts (id, document_id, label, created_at, is_active)
         VALUES ('old-draft', ?1, 'Draft', 0, 1)",
        rusqlite::params![doc_id],
    )
    .expect("legacy draft");

    quillium_lib::db::schema::migrate_tabs_and_draft_tree(&conn).expect("re-run migration");

    let tabs = list_tabs(&conn, &doc_id).expect("tabs");
    assert_eq!(tabs.len(), 1);
    let drafts = list_tab_drafts(&conn, &tabs[0].id).expect("drafts");
    assert_eq!(drafts.len(), 1);
    assert_eq!(drafts[0].id, "old-draft");
}

#[test]
fn test_set_draft_locked_roundtrip() {
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Doc").expect("doc");
    let tab = create_tab(&conn, &doc_id, "Main").expect("tab");
    let draft = list_tab_drafts(&conn, &tab.id).expect("drafts")[0].clone_id();

    set_draft_locked(&conn, &draft, true).expect("lock");
    assert!(list_tab_drafts(&conn, &tab.id).expect("drafts")[0].locked);
    set_draft_locked(&conn, &draft, false).expect("unlock");
    assert!(!list_tab_drafts(&conn, &tab.id).expect("drafts")[0].locked);
}

// Small helper: DraftMeta isn't Clone; tests only need the id.
trait CloneId {
    fn clone_id(&self) -> String;
}
impl CloneId for quillium_lib::db::DraftMeta {
    fn clone_id(&self) -> String {
        self.id.clone()
    }
}
