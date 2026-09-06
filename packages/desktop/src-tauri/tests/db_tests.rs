use quillium_lib::db::{
    documents::{create_document, create_draft},
    events::{append_event, create_snapshot},
    load::load_document_state,
    schema::open_db,
    tabs::{
        branch_draft, create_tab, delete_draft, delete_tab, get_active_draft, iterate_draft,
        list_doc_events, list_tab_drafts, list_tabs, orphan_and_delete_draft, rename_tab,
        restore_draft, restore_tab, set_active_draft, set_active_tab, set_draft_locked,
    },
    DbError,
};
use rusqlite::Connection;

// open_db (rather than bare init_schema) so the tabs/draft-tree migration
// runs — production code assumes its ALTER-added columns exist.
fn in_memory_db() -> Connection {
    // open_db handles pragmas, extension registration, and migrations;
    // SQLite treats the ":memory:" path specially.
    open_db(std::path::Path::new(":memory:")).expect("in-memory DB")
}

#[test]
fn validation_errors_are_distinct_and_keep_command_messages() {
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Test", None).unwrap();
    let tab_id = create_tab(&conn, &doc_id, "Main").unwrap().id;
    let error = delete_tab(&conn, &tab_id).unwrap_err();
    assert!(matches!(error, DbError::Validation(_)));
    assert_eq!(
        error.to_string(),
        "Cannot delete the last tab of a document"
    );

    let error = delete_tab(&conn, "missing").unwrap_err();
    assert!(matches!(
        error,
        DbError::Sql(rusqlite::Error::QueryReturnedNoRows)
    ));
    assert_eq!(
        error.to_string(),
        rusqlite::Error::QueryReturnedNoRows.to_string()
    );

    // A genuine SQLite constraint must retain its SQL identity.
    let error = create_tab(&conn, "missing-document", "Invalid").unwrap_err();
    assert!(matches!(
        error,
        DbError::Sql(rusqlite::Error::SqliteFailure(..))
    ));
}

#[test]
fn activity_failure_rolls_back_tab_and_seeded_iteration() {
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Test", None).unwrap();
    let tab_id = create_tab(&conn, &doc_id, "Main").unwrap().id;
    let root_id = list_tab_drafts(&conn, &tab_id).unwrap()[0].id.clone();
    let activity_count = list_doc_events(&conn, &doc_id).unwrap().len();
    conn.execute_batch(
        "CREATE TRIGGER reject_activity BEFORE INSERT ON doc_events
         BEGIN SELECT RAISE(ABORT, 'activity unavailable'); END;",
    )
    .unwrap();

    for error in [
        create_tab(&conn, &doc_id, "New tab").unwrap_err(),
        iterate_draft(&conn, &root_id, "Next", Some(r#"{"doc":"seed"}"#)).unwrap_err(),
    ] {
        assert!(matches!(error, DbError::Sql(_)));
        assert_eq!(error.to_string(), "activity unavailable");
    }

    assert_eq!(list_tabs(&conn, &doc_id).unwrap().len(), 1);
    let drafts = list_tab_drafts(&conn, &tab_id).unwrap();
    assert_eq!(drafts.len(), 1);
    assert!(!drafts[0].locked);
    let snapshots: i64 = conn
        .query_row("SELECT COUNT(*) FROM snapshots", [], |r| r.get(0))
        .unwrap();
    assert_eq!(snapshots, 0);
    assert_eq!(
        list_doc_events(&conn, &doc_id).unwrap().len(),
        activity_count
    );
    assert!(conn.is_autocommit());
}

#[test]
fn later_activity_failure_rolls_back_orphan_rewrites_and_earlier_events() {
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Test", None).unwrap();
    let tab_id = create_tab(&conn, &doc_id, "Main").unwrap().id;
    let root_id = list_tab_drafts(&conn, &tab_id).unwrap()[0].id.clone();
    let middle = iterate_draft(&conn, &root_id, "Middle", None).unwrap();
    let child = iterate_draft(&conn, &middle.id, "Child", None).unwrap();
    let before = serde_json::to_value(list_tab_drafts(&conn, &tab_id).unwrap()).unwrap();
    let activity_count = list_doc_events(&conn, &doc_id).unwrap().len();
    conn.execute_batch(
        "CREATE TRIGGER reject_reparent_activity BEFORE INSERT ON doc_events
         WHEN NEW.event_type = 'draft_reparented'
         BEGIN SELECT RAISE(ABORT, 'reparent activity unavailable'); END;",
    )
    .unwrap();

    let error = orphan_and_delete_draft(&conn, &middle.id).unwrap_err();
    assert!(matches!(error, DbError::Sql(_)));
    assert_eq!(error.to_string(), "reparent activity unavailable");
    assert_eq!(
        serde_json::to_value(list_tab_drafts(&conn, &tab_id).unwrap()).unwrap(),
        before
    );
    assert_eq!(
        list_doc_events(&conn, &doc_id).unwrap().len(),
        activity_count
    );
    assert!(conn.is_autocommit());

    conn.execute_batch("DROP TRIGGER reject_reparent_activity")
        .unwrap();
    let rewrites = orphan_and_delete_draft(&conn, &middle.id).unwrap();
    assert_eq!(rewrites.len(), 1);
    assert_eq!(rewrites[0].draft_id, child.id);
    assert_eq!(
        list_doc_events(&conn, &doc_id).unwrap().len(),
        activity_count + 2
    );
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
    let doc_id = create_document(&conn, "Test Doc", None).expect("create doc");
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
    let doc_id = create_document(&conn, "Test Doc", None).expect("create doc");
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
    let doc_id = create_document(&conn, "Test Doc", None).expect("create doc");
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
    let doc_id = create_document(&conn, "Test Doc", None).expect("create doc");
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
    let doc_id = create_document(&conn, "Doc", None).expect("doc");
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
    let doc_id = create_document(&conn, "Doc", None).expect("doc");
    let tab = create_tab(&conn, &doc_id, "Notes").expect("tab");

    assert_eq!(tab.label, "Notes");
    let drafts = list_tab_drafts(&conn, &tab.id).expect("drafts");
    assert_eq!(drafts.len(), 1);
    assert_eq!(drafts[0].label, "main");
    assert_eq!(drafts[0].parent_draft_id, None);
}

#[test]
fn test_iterate_chains_and_locks_superseded() {
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Doc", None).expect("doc");
    let tab = create_tab(&conn, &doc_id, "Main").expect("tab");
    let root = list_tab_drafts(&conn, &tab.id).expect("drafts")[0].clone_id();

    let v1 = iterate_draft(&conn, &root, "v1", Some(r#"{"doc":"hello"}"#)).expect("iterate");
    assert_eq!(v1.parent_draft_id.as_deref(), Some(root.as_str()));
    assert_eq!(v1.branched_from, None);

    // Iterating locks the source (superseded), leaves the new tip editable.
    let locked = |id: &str| -> bool {
        list_tab_drafts(&conn, &tab.id)
            .expect("drafts")
            .iter()
            .find(|d| d.id == id)
            .map(|d| d.locked)
            .unwrap_or(false)
    };
    assert!(locked(&root), "source iteration locks");
    assert!(!locked(&v1.id), "new tip stays editable");

    // A second iteration locks v1 too — only the newest in the run is live.
    let v2 = iterate_draft(&conn, &v1.id, "v2", None).expect("iterate 2");
    assert!(locked(&root));
    assert!(locked(&v1.id));
    assert!(!locked(&v2.id), "only the run tip is editable");

    // The seed-state snapshot is labeled so auto-prune can't remove it.
    let label: String = conn
        .query_row(
            "SELECT label FROM snapshots WHERE draft_id = ?1",
            rusqlite::params![v1.id],
            |row| row.get(0),
        )
        .expect("snapshot label");
    assert_eq!(label, "Branch point");
}

#[test]
fn test_branch_starts_new_run_without_locking() {
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Doc", None).expect("doc");
    let tab = create_tab(&conn, &doc_id, "Main").expect("tab");
    let root = list_tab_drafts(&conn, &tab.id).expect("drafts")[0].clone_id();

    let b1 = branch_draft(&conn, &root, "take 2", Some(r#"{"doc":"alt"}"#)).expect("branch");
    assert_eq!(b1.branched_from.as_deref(), Some(root.as_str()));
    assert_eq!(b1.parent_draft_id, None, "a branch is a new run head");

    let locked = |id: &str| -> bool {
        list_tab_drafts(&conn, &tab.id)
            .expect("drafts")
            .iter()
            .find(|d| d.id == id)
            .map(|d| d.locked)
            .unwrap_or(false)
    };
    // Branching locks nothing: main and the branch stay live.
    assert!(!locked(&root), "branch source stays editable");
    assert!(!locked(&b1.id), "branch stays editable");

    let loaded = load_document_state(&conn, &doc_id, Some(&b1.id)).expect("load");
    assert_eq!(
        loaded.snapshot_state_json.as_deref(),
        Some(r#"{"doc":"alt"}"#)
    );
}

#[test]
fn test_branch_from_root_is_allowed() {
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Doc", None).expect("doc");
    let tab = create_tab(&conn, &doc_id, "Main").expect("tab");
    let root = list_tab_drafts(&conn, &tab.id).expect("drafts")[0].clone_id();

    let branch = branch_draft(&conn, &root, "take 2", None).expect("branch");
    assert_eq!(branch.branched_from.as_deref(), Some(root.as_str()));
    assert_eq!(branch.parent_draft_id, None);
}

#[test]
fn test_delete_draft_refusals() {
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Doc", None).expect("doc");
    let tab = create_tab(&conn, &doc_id, "Main").expect("tab");
    let root = list_tab_drafts(&conn, &tab.id).expect("drafts")[0].clone_id();

    // The storyline root cannot be deleted.
    assert!(delete_draft(&conn, &root).is_err());

    let v1 = iterate_draft(&conn, &root, "v1", None).expect("iterate");
    // The storyline root stays protected even when other drafts exist.
    assert!(delete_draft(&conn, &root).is_err());

    let b1 = branch_draft(&conn, &v1.id, "take 2", None).expect("branch");

    // A leaf with siblings can be deleted.
    delete_draft(&conn, &b1.id).expect("delete leaf");
    assert_eq!(list_tab_drafts(&conn, &tab.id).expect("drafts").len(), 2);
}

#[test]
fn test_delete_tab_is_soft_and_restorable() {
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Doc", None).expect("doc");
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
    // Soft delete: the drafts' events survive for restore.
    let surviving: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM events WHERE draft_id = ?1",
            rusqlite::params![tab2_draft],
            |row| row.get(0),
        )
        .expect("count");
    assert_eq!(surviving, 1, "tab deletion keeps its drafts' events");

    restore_tab(&conn, &tab2.id).expect("restore tab2");
    assert_eq!(list_tabs(&conn, &doc_id).expect("tabs").len(), 2);
    let drafts = list_tab_drafts(&conn, &tab2.id).expect("drafts");
    assert_eq!(drafts.len(), 1, "restored tab still has its draft");
}

#[test]
fn test_delete_draft_is_soft_and_restorable() {
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Doc", None).expect("doc");
    let tab = create_tab(&conn, &doc_id, "Main").expect("tab");
    let root = list_tab_drafts(&conn, &tab.id).expect("drafts")[0].clone_id();
    let v1 = iterate_draft(&conn, &root, "v1", Some(r#"{"doc":"hi"}"#)).expect("iterate");

    delete_draft(&conn, &v1.id).expect("delete v1");
    assert_eq!(list_tab_drafts(&conn, &tab.id).expect("drafts").len(), 1);

    restore_draft(&conn, &v1.id).expect("restore v1");
    let drafts = list_tab_drafts(&conn, &tab.id).expect("drafts");
    assert_eq!(drafts.len(), 2);
    // The seed-state snapshot survived the delete/restore round-trip.
    let loaded = load_document_state(&conn, &doc_id, Some(&v1.id)).expect("load");
    assert_eq!(
        loaded.snapshot_state_json.as_deref(),
        Some(r#"{"doc":"hi"}"#)
    );
}

#[test]
fn test_run_tip_moves_back_on_delete_and_returns_on_restore() {
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Doc", None).expect("doc");
    let tab = create_tab(&conn, &doc_id, "Main").expect("tab");
    let root = list_tab_drafts(&conn, &tab.id).expect("drafts")[0].clone_id();
    let v1 = iterate_draft(&conn, &root, "v1", None).expect("iterate");
    let v2 = iterate_draft(&conn, &v1.id, "v2", None).expect("iterate 2");

    let locked = |id: &str| -> bool {
        list_tab_drafts(&conn, &tab.id)
            .expect("drafts")
            .iter()
            .find(|d| d.id == id)
            .map(|d| d.locked)
            .unwrap_or(false)
    };
    assert!(locked(&v1.id) && !locked(&v2.id), "v2 is the tip");

    // Deleting the tip promotes v1 back to the editable tip.
    delete_draft(&conn, &v2.id).expect("delete tip");
    assert!(!locked(&v1.id), "v1 is now the live tip");

    // Restoring v2 hands the tip back to it; v1 re-locks.
    restore_draft(&conn, &v2.id).expect("restore tip");
    assert!(locked(&v1.id) && !locked(&v2.id), "v2 reclaims the tip");
    let _ = doc_id;
}

#[test]
fn test_doc_events_record_structural_ops() {
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Doc", None).expect("doc");
    let tab = create_tab(&conn, &doc_id, "Main").expect("tab");
    let root = list_tab_drafts(&conn, &tab.id).expect("drafts")[0].clone_id();
    let v1 = iterate_draft(&conn, &root, "v1", None).expect("iterate");
    rename_tab(&conn, &tab.id, "Chapter 1").expect("rename tab");
    delete_draft(&conn, &v1.id).expect("delete draft");
    restore_draft(&conn, &v1.id).expect("restore draft");

    let events = list_doc_events(&conn, &doc_id).expect("doc events");
    let types: Vec<&str> = events.iter().map(|e| e.event_type.as_str()).collect();
    // Newest first.
    assert_eq!(
        types,
        vec![
            "draft_restored",
            "draft_deleted",
            "tab_renamed",
            "draft_iterated",
            "tab_created",
        ]
    );
    // Payloads carry enough to render and restore from the timeline.
    assert!(events[1].payload.contains(&v1.id));
    assert!(events[2].payload.contains("Chapter 1"));
}

#[test]
fn test_load_resolves_active_tab_and_draft() {
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Doc", None).expect("doc");
    let tab1 = create_tab(&conn, &doc_id, "Main").expect("tab1");
    let tab2 = create_tab(&conn, &doc_id, "Notes").expect("tab2");

    let tab2_root = list_tab_drafts(&conn, &tab2.id).expect("drafts")[0].clone_id();
    let tab2_v1 = iterate_draft(&conn, &tab2_root, "v1", Some(r#"{"doc":"branch"}"#))
        .expect("iterate")
        .id;

    set_active_tab(&conn, &doc_id, &tab2.id).expect("set tab");
    set_active_draft(&conn, &tab2.id, &tab2_v1).expect("set draft");

    // A bare load must land on tab2's active draft, not tab1's root.
    let loaded = load_document_state(&conn, &doc_id, None).expect("load");
    assert_eq!(
        loaded.snapshot_state_json.as_deref(),
        Some(r#"{"doc":"branch"}"#)
    );

    // Stale active pointers fall back gracefully: deleting the active draft
    // clears the pointer; resolution then finds the run's remaining draft
    // (tab2's root, which has no seed snapshot).
    delete_draft(&conn, &tab2_v1).expect("delete tip");
    assert_eq!(get_active_draft(&conn, &tab2.id).expect("active"), None);
    let fallback = load_document_state(&conn, &doc_id, None).expect("load fallback");
    assert!(fallback.snapshot_state_json.is_none());
    let _ = tab1; // tab1 exists to prove resolution prefers the active tab
}

#[test]
fn test_migration_backfills_pre_tabs_drafts() {
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Old Doc", None).expect("doc");
    // Simulate a pre-migration draft: inserted without a tab.
    conn.execute(
        "INSERT INTO drafts (id, document_id, label, created_at, is_active)
         VALUES ('old-draft', ?1, 'Draft', 0, 1)",
        rusqlite::params![doc_id],
    )
    .expect("legacy draft");
    // Rewind the schema past migration 12 as well so the replay exercises the
    // creator-version migration against a genuinely pre-column database.
    conn.execute("ALTER TABLE documents DROP COLUMN created_with_version", [])
        .expect("drop creator-version column");
    conn.pragma_update(None, "user_version", 5)
        .expect("rewind version");

    quillium_lib::db::migrations::migrate(&conn).expect("re-run migration");

    let tabs = list_tabs(&conn, &doc_id).expect("tabs");
    assert_eq!(tabs.len(), 1);
    let drafts = list_tab_drafts(&conn, &tabs[0].id).expect("drafts");
    assert_eq!(drafts.len(), 1);
    assert_eq!(drafts[0].id, "old-draft");
}

#[test]
fn test_set_draft_locked_roundtrip() {
    let conn = in_memory_db();
    let doc_id = create_document(&conn, "Doc", None).expect("doc");
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
