//! college.rs — College setup and document activation persistence.
//!
//! College setup JSON is scoped to a tab, while the document remains the
//! ownership boundary used to validate command targets. The database stores
//! the JSON opaquely after validating the version-1 shape on writes so a newer
//! frontend can be read and blocked without being overwritten by an older one.

use super::tabs::create_tab_in_connection;
use super::{now_ms, DbError, DbResult, TabMeta};

use rusqlite::{params, Connection, Error, OptionalExtension, Result};
use serde::Deserialize;
use serde_json::json;

const MAX_SETUP_BYTES: usize = 128 * 1024;
const MAX_INITIAL_CONTENT_BYTES: usize = 12_000;
const CURRENT_SETUP_VERSION: i64 = 1;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollegeTabInput {
    pub label: String,
    pub setup_json: String,
    #[serde(default)]
    pub initial_content: Option<String>,
}

fn validate_tab_target(conn: &Connection, document_id: &str, tab_id: &str) -> Result<()> {
    let belongs_to_document: bool = conn.query_row(
        "SELECT EXISTS(
            SELECT 1
            FROM tabs
            WHERE id = ?1 AND document_id = ?2
        )",
        params![tab_id, document_id],
        |row| row.get(0),
    )?;
    if belongs_to_document {
        Ok(())
    } else {
        Err(Error::InvalidParameterName(
            "College tab setup target does not belong to the document".to_string(),
        ))
    }
}

fn validate_live_write_target(conn: &Connection, document_id: &str, tab_id: &str) -> Result<()> {
    let is_live: bool = conn.query_row(
        "SELECT EXISTS(
            SELECT 1
            FROM tabs
            JOIN documents ON documents.id = tabs.document_id
            WHERE tabs.id = ?1
              AND tabs.document_id = ?2
              AND tabs.deleted_at IS NULL
              AND documents.deleted_at IS NULL
        )",
        params![tab_id, document_id],
        |row| row.get(0),
    )?;
    if is_live {
        Ok(())
    } else {
        Err(Error::InvalidParameterName(
            "College tab setup requires a live tab in a live document".to_string(),
        ))
    }
}

fn validate_setup_json(setup_json: &str) -> Result<()> {
    if setup_json.len() > MAX_SETUP_BYTES {
        return Err(Error::InvalidParameterName(
            "College tab setup JSON must be at most 128 KiB".to_string(),
        ));
    }

    let value: serde_json::Value = serde_json::from_str(setup_json)
        .map_err(|error| Error::InvalidParameterName(error.to_string()))?;
    if !value.is_object() {
        return Err(Error::InvalidParameterName(
            "College tab setup must be a JSON object".to_string(),
        ));
    }
    if value.get("version").and_then(serde_json::Value::as_i64) != Some(CURRENT_SETUP_VERSION) {
        return Err(Error::InvalidParameterName(
            "College tab setup version must be numeric 1".to_string(),
        ));
    }
    Ok(())
}

fn validate_batch_setup_json(setup_json: &str) -> DbResult<()> {
    validate_setup_json(setup_json)?;
    let value: serde_json::Value = serde_json::from_str(setup_json)
        .map_err(|error| Error::InvalidParameterName(error.to_string()))?;
    let prompt_count = value
        .get("prompts")
        .and_then(serde_json::Value::as_array)
        .map(Vec::len);
    if prompt_count != Some(1) {
        return Err(DbError::Validation(
            "College tab setup must contain exactly one prompt when creating tabs".to_string(),
        ));
    }
    Ok(())
}

fn validate_live_document(conn: &Connection, document_id: &str) -> DbResult<()> {
    let is_live: bool = conn.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM documents WHERE id = ?1 AND deleted_at IS NULL
        )",
        params![document_id],
        |row| row.get(0),
    )?;
    if is_live {
        Ok(())
    } else {
        Err(DbError::Validation(
            "College tabs require a live document".to_string(),
        ))
    }
}

/// Returns whether College applications are enabled for a document. Missing
/// activation rows intentionally mean disabled so new documents remain
/// opt-in until the writer explicitly enables College.
pub fn get_college_document_enabled(conn: &Connection, document_id: &str) -> Result<bool> {
    let result: rusqlite::Result<i64> = conn.query_row(
        "SELECT enabled FROM college_document_activation WHERE document_id = ?1",
        params![document_id],
        |row| row.get(0),
    );
    match result {
        Ok(enabled) => Ok(enabled == 1),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
        Err(error) => Err(error),
    }
}

/// Persists the document's College opt-in after validating that the document
/// still exists and is live. The row is document-scoped so tab setups remain
/// intact when activation is toggled.
pub fn set_college_document_enabled(
    conn: &Connection,
    document_id: &str,
    enabled: bool,
) -> DbResult<()> {
    validate_live_document(conn, document_id)?;
    conn.execute(
        "INSERT INTO college_document_activation (document_id, enabled)
         VALUES (?1, ?2)
         ON CONFLICT(document_id) DO UPDATE SET enabled = excluded.enabled",
        params![document_id, enabled],
    )?;
    Ok(())
}

fn validate_batch_inputs(
    conn: &Connection,
    document_id: &str,
    entries: &[CollegeTabInput],
) -> DbResult<()> {
    validate_live_document(conn, document_id)?;
    if entries.is_empty() || entries.len() > 12 {
        return Err(DbError::Validation(
            "College tab creation requires between 1 and 12 entries".to_string(),
        ));
    }
    for entry in entries {
        if entry.label.trim().is_empty() {
            return Err(DbError::Validation(
                "College tab labels must not be blank".to_string(),
            ));
        }
        if entry.label.chars().count() > 200 {
            return Err(DbError::Validation(
                "College tab labels must be at most 200 characters".to_string(),
            ));
        }
        if let Some(initial_content) = entry.initial_content.as_deref() {
            if initial_content.len() > MAX_INITIAL_CONTENT_BYTES {
                return Err(DbError::Validation(
                    "College tab initial content must be at most 12000 bytes".to_string(),
                ));
            }
        }
        validate_batch_setup_json(&entry.setup_json)?;
    }
    Ok(())
}

fn insert_initial_snapshot(conn: &Connection, tab_id: &str, content: &str) -> Result<()> {
    let draft_id: String = conn.query_row(
        "SELECT id FROM drafts WHERE tab_id = ?1 ORDER BY created_at ASC LIMIT 1",
        params![tab_id],
        |row| row.get(0),
    )?;
    let cursor = content.encode_utf16().count();
    let state_json = json!({
        "doc": content,
        "selection": {
            "ranges": [{ "anchor": cursor, "head": cursor }],
            "main": 0,
        },
    })
    .to_string();
    conn.execute(
        "INSERT INTO snapshots (draft_id, up_to_event_id, state_json, created_at, label)
         VALUES (?1, 0, ?2, ?3, 'College prompt')",
        params![draft_id, state_json, now_ms()],
    )?;
    Ok(())
}

/// Loads a tab's College setup. Stored JSON is returned unchanged, including
/// versions newer than this backend understands, so the frontend can block
/// editing without losing data.
pub fn get_college_tab_setup(
    conn: &Connection,
    document_id: &str,
    tab_id: &str,
) -> Result<Option<String>> {
    validate_tab_target(conn, document_id, tab_id)?;
    conn.query_row(
        "SELECT setup_json FROM college_tab_setups WHERE tab_id = ?1",
        params![tab_id],
        |row| row.get(0),
    )
    .optional()
}

/// Replaces or clears a tab's College setup in one SQLite statement.
///
/// Writes target only live tabs in live documents. `None` deletes the setup
/// row and leaves all document-scoped writer state untouched.
pub fn set_college_tab_setup(
    conn: &Connection,
    document_id: &str,
    tab_id: &str,
    setup_json: Option<&str>,
) -> Result<()> {
    validate_live_write_target(conn, document_id, tab_id)?;
    if let Some(json) = setup_json {
        validate_setup_json(json)?;
        conn.execute(
            "INSERT INTO college_tab_setups (tab_id, setup_json, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(tab_id) DO UPDATE SET
                 setup_json = excluded.setup_json,
                 updated_at = excluded.updated_at",
            params![tab_id, json, now_ms()],
        )?;
    } else {
        conn.execute(
            "DELETE FROM college_tab_setups WHERE tab_id = ?1",
            params![tab_id],
        )?;
    }
    Ok(())
}

/// Creates tabs, root drafts, audit events, and tab-owned College setups as
/// one all-or-none operation. Inputs are fully validated before any row is
/// inserted, and this operation never changes active-tab metadata.
pub fn create_college_tabs(
    conn: &Connection,
    document_id: &str,
    entries: &[CollegeTabInput],
) -> DbResult<Vec<TabMeta>> {
    validate_batch_inputs(conn, document_id, entries)?;

    let tx = conn.unchecked_transaction()?;
    let mut tabs = Vec::with_capacity(entries.len());
    for entry in entries {
        let tab = create_tab_in_connection(&tx, document_id, &entry.label)?;
        set_college_tab_setup(&tx, document_id, &tab.id, Some(&entry.setup_json))?;
        if let Some(initial_content) = entry.initial_content.as_deref() {
            insert_initial_snapshot(&tx, &tab.id, initial_content)?;
        }
        tabs.push(tab);
    }
    tx.commit()?;
    Ok(tabs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::documents::{
        create_document, delete_document, restore_document, trash_document,
    };
    use crate::db::load::load_document_state;
    use crate::db::schema::open_db;
    use crate::db::tabs::{create_tab, list_tabs};

    fn batch_entry(label: &str, setup_json: &str) -> CollegeTabInput {
        CollegeTabInput {
            label: label.to_string(),
            setup_json: setup_json.to_string(),
            initial_content: None,
        }
    }

    fn batch_entry_with_content(
        label: &str,
        setup_json: &str,
        initial_content: &str,
    ) -> CollegeTabInput {
        CollegeTabInput {
            label: label.to_string(),
            setup_json: setup_json.to_string(),
            initial_content: Some(initial_content.to_string()),
        }
    }

    fn seeded_db() -> (tempfile::TempDir, Connection, String, String, String) {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_db(&dir.path().join("test.db")).unwrap();
        let document_a = create_document(&conn, "A", None).unwrap();
        let document_b = create_document(&conn, "B", None).unwrap();
        let tab_a = create_tab(&conn, &document_a, "A tab").unwrap().id;
        let tab_b = create_tab(&conn, &document_b, "B tab").unwrap().id;
        (dir, conn, document_a, tab_a, tab_b)
    }

    #[test]
    fn document_activation_defaults_to_false_and_is_isolated() {
        let (_dir, conn, document_a, _tab_a, _tab_b) = seeded_db();
        let document_b: String = conn
            .query_row(
                "SELECT id FROM documents WHERE id <> ?1",
                params![document_a],
                |row| row.get(0),
            )
            .unwrap();

        assert!(!get_college_document_enabled(&conn, &document_a).unwrap());
        assert!(!get_college_document_enabled(&conn, &document_b).unwrap());

        set_college_document_enabled(&conn, &document_a, true).unwrap();
        assert!(get_college_document_enabled(&conn, &document_a).unwrap());
        assert!(!get_college_document_enabled(&conn, &document_b).unwrap());

        set_college_document_enabled(&conn, &document_a, false).unwrap();
        assert!(!get_college_document_enabled(&conn, &document_a).unwrap());
    }

    #[test]
    fn document_activation_writes_require_a_live_document() {
        let (_dir, conn, document_a, _tab_a, _tab_b) = seeded_db();

        assert!(matches!(
            set_college_document_enabled(&conn, "missing", true),
            Err(DbError::Validation(_))
        ));
        trash_document(&conn, &document_a).unwrap();
        assert!(matches!(
            set_college_document_enabled(&conn, &document_a, true),
            Err(DbError::Validation(_))
        ));
    }

    #[test]
    fn setups_are_isolated_by_document_and_tab() {
        let (_dir, conn, document_a, tab_a, tab_b) = seeded_db();
        let document_b: String = conn
            .query_row(
                "SELECT document_id FROM tabs WHERE id = ?1",
                params![tab_b],
                |row| row.get(0),
            )
            .unwrap();
        let setup_a = r#"{"version":1,"prompts":["A"]}"#;
        let setup_b = r#"{"version":1,"prompts":["B"]}"#;

        set_college_tab_setup(&conn, &document_a, &tab_a, Some(setup_a)).unwrap();
        set_college_tab_setup(&conn, &document_b, &tab_b, Some(setup_b)).unwrap();

        assert_eq!(
            get_college_tab_setup(&conn, &document_a, &tab_a).unwrap(),
            Some(setup_a.to_string())
        );
        assert_eq!(
            get_college_tab_setup(&conn, &document_b, &tab_b).unwrap(),
            Some(setup_b.to_string())
        );
        assert!(get_college_tab_setup(&conn, &document_a, &tab_b).is_err());
    }

    #[test]
    fn invalid_writes_leave_the_previous_setup_untouched() {
        let (_dir, conn, document_a, tab_a, _tab_b) = seeded_db();
        let previous = r#"{"version":1,"prompts":["previous"]}"#;
        set_college_tab_setup(&conn, &document_a, &tab_a, Some(previous)).unwrap();

        assert!(set_college_tab_setup(&conn, &document_a, &tab_a, Some("[]")).is_err());
        assert!(
            set_college_tab_setup(&conn, &document_a, &tab_a, Some(r#"{"version":2}"#)).is_err()
        );
        assert!(set_college_tab_setup(&conn, &document_a, &tab_a, Some("{")).is_err());
        assert_eq!(
            get_college_tab_setup(&conn, &document_a, &tab_a).unwrap(),
            Some(previous.to_string())
        );
    }

    #[test]
    fn writes_reject_mismatched_or_non_live_targets() {
        let (_dir, conn, document_a, tab_a, tab_b) = seeded_db();
        let document_b: String = conn
            .query_row(
                "SELECT document_id FROM tabs WHERE id = ?1",
                params![tab_b],
                |row| row.get(0),
            )
            .unwrap();
        let setup = Some(r#"{"version":1}"#);

        assert!(set_college_tab_setup(&conn, &document_a, &tab_b, setup).is_err());
        trash_document(&conn, &document_a).unwrap();
        assert!(set_college_tab_setup(&conn, &document_a, &tab_a, setup).is_err());
        restore_document(&conn, &document_a).unwrap();
        conn.execute(
            "UPDATE tabs SET deleted_at = 10 WHERE id = ?1",
            params![tab_a],
        )
        .unwrap();
        assert!(set_college_tab_setup(&conn, &document_a, &tab_a, setup).is_err());
        assert!(set_college_tab_setup(&conn, &document_b, &tab_b, setup).is_ok());
    }

    #[test]
    fn clear_does_not_touch_document_writer_state_and_delete_cascades() {
        let (_dir, conn, document_a, tab_a, _tab_b) = seeded_db();
        let setup = r#"{"version":1,"prompts":["A"]}"#;
        set_college_tab_setup(&conn, &document_a, &tab_a, Some(setup)).unwrap();
        conn.execute(
            "INSERT INTO document_ai_profiles (document_id, writer_brief, updated_at)
             VALUES (?1, 'writer brief', 1)",
            params![document_a],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO document_editorial_decisions (document_id, decisions_json, updated_at)
             VALUES (?1, '[\"decision\"]', 1)",
            params![document_a],
        )
        .unwrap();

        set_college_tab_setup(&conn, &document_a, &tab_a, None).unwrap();
        assert_eq!(
            get_college_tab_setup(&conn, &document_a, &tab_a).unwrap(),
            None
        );
        assert_eq!(
            conn.query_row(
                "SELECT writer_brief FROM document_ai_profiles WHERE document_id = ?1",
                params![document_a],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
            "writer brief"
        );
        assert_eq!(
            conn.query_row(
                "SELECT decisions_json FROM document_editorial_decisions WHERE document_id = ?1",
                params![document_a],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
            r#"["decision"]"#
        );

        set_college_tab_setup(&conn, &document_a, &tab_a, Some(setup)).unwrap();
        trash_document(&conn, &document_a).unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT setup_json FROM college_tab_setups WHERE tab_id = ?1",
                params![tab_a],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
            setup
        );
        restore_document(&conn, &document_a).unwrap();
        delete_document(&conn, &document_a).unwrap();
        let setup_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM college_tab_setups", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(setup_count, 0);
    }

    #[test]
    fn future_version_is_returned_unchanged() {
        let (_dir, conn, document_a, tab_a, _tab_b) = seeded_db();
        let future = r#"{"version":2,"future":true}"#;
        conn.execute(
            "INSERT INTO college_tab_setups (tab_id, setup_json, updated_at)
             VALUES (?1, ?2, 1)",
            params![tab_a, future],
        )
        .unwrap();

        assert_eq!(
            get_college_tab_setup(&conn, &document_a, &tab_a).unwrap(),
            Some(future.to_string())
        );
    }

    #[test]
    fn batch_creation_creates_roots_events_and_setups_without_active_changes() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_db(&dir.path().join("test.db")).unwrap();
        let document_id = create_document(&conn, "College", None).unwrap();
        let setup_a = r#"{"version":1,"prompts":[{"id":"a"}]}"#;
        let setup_b = r#"{"version":1,"prompts":[{"id":"b"}]}"#;

        let tabs = create_college_tabs(
            &conn,
            &document_id,
            &[
                batch_entry("Common App", setup_a),
                batch_entry("UC PIQ", setup_b),
            ],
        )
        .unwrap();

        assert_eq!(tabs.len(), 2);
        assert_eq!(tabs[0].label, "Common App");
        assert_eq!(tabs[0].position, 0);
        assert_eq!(tabs[1].label, "UC PIQ");
        assert_eq!(tabs[1].position, 1);
        assert_eq!(list_tabs(&conn, &document_id).unwrap().len(), 2);
        assert_eq!(
            get_college_tab_setup(&conn, &document_id, &tabs[0].id).unwrap(),
            Some(setup_a.to_string())
        );
        assert_eq!(
            get_college_tab_setup(&conn, &document_id, &tabs[1].id).unwrap(),
            Some(setup_b.to_string())
        );

        let root_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM drafts WHERE document_id = ?1 AND tab_id IS NOT NULL",
                params![document_id],
                |row| row.get(0),
            )
            .unwrap();
        let event_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM doc_events WHERE document_id = ?1 AND event_type = 'tab_created'",
                params![document_id],
                |row| row.get(0),
            )
            .unwrap();
        let setup_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM college_tab_setups WHERE tab_id IN (?1, ?2)",
                params![tabs[0].id, tabs[1].id],
                |row| row.get(0),
            )
            .unwrap();
        let active_meta_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM _meta WHERE key = ?1 OR key = ?2",
                params![
                    format!("active_tab:{document_id}"),
                    format!("active_draft:{}", tabs[0].id)
                ],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(root_count, 2);
        assert_eq!(event_count, 2);
        assert_eq!(setup_count, 2);
        assert_eq!(active_meta_count, 0);

        for tab in &tabs {
            let (draft_tab_id, label, is_active): (String, String, i64) = conn
                .query_row(
                    "SELECT tab_id, label, is_active FROM drafts WHERE tab_id = ?1",
                    params![tab.id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .unwrap();
            assert_eq!(draft_tab_id, tab.id);
            assert_eq!(label, "main");
            assert_eq!(is_active, 1);
        }
    }

    #[test]
    fn batch_creation_prevalidates_all_entries_and_rolls_back() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_db(&dir.path().join("test.db")).unwrap();
        let document_id = create_document(&conn, "College", None).unwrap();
        let valid = r#"{"version":1,"prompts":[{"id":"a"}]}"#;
        let two_prompts = r#"{"version":1,"prompts":[{"id":"a"},{"id":"b"}]}"#;

        assert!(create_college_tabs(
            &conn,
            &document_id,
            &[
                batch_entry_with_content("First", valid, "This must not be persisted"),
                batch_entry("Second", two_prompts),
            ],
        )
        .is_err());
        assert_eq!(list_tabs(&conn, &document_id).unwrap().len(), 0);
        for table in ["drafts", "doc_events", "college_tab_setups", "snapshots"] {
            let count: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "{table} should remain empty after failed batch");
        }

        assert!(create_college_tabs(&conn, &document_id, &[batch_entry(" ", valid)],).is_err());
        assert!(create_college_tabs(
            &conn,
            &document_id,
            &[batch_entry("x".repeat(201).as_str(), valid)],
        )
        .is_err());
    }

    #[test]
    fn initial_content_is_saved_and_loaded_after_reopening_database() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("college-initial-content.db");
        let setup = r#"{"version":1,"prompts":[{"id":"essay"}]}"#;
        let content = "A short opening with an emoji: 👋";

        let (document_id, draft_id) = {
            let conn = open_db(&db_path).unwrap();
            let document_id = create_document(&conn, "College", None).unwrap();
            let tabs = create_college_tabs(
                &conn,
                &document_id,
                &[batch_entry_with_content("Essay", setup, content)],
            )
            .unwrap();
            let draft_id: String = conn
                .query_row(
                    "SELECT id FROM drafts WHERE tab_id = ?1",
                    params![tabs[0].id],
                    |row| row.get(0),
                )
                .unwrap();

            let loaded = load_document_state(&conn, &document_id, Some(&draft_id)).unwrap();
            assert_eq!(loaded.snapshot_event_id, 0);
            assert!(loaded.events_since.is_empty());
            let state: serde_json::Value =
                serde_json::from_str(loaded.snapshot_state_json.as_deref().unwrap()).unwrap();
            assert_eq!(state["doc"], content);
            let cursor = content.encode_utf16().count();
            assert_eq!(state["selection"]["ranges"][0]["anchor"], cursor);
            assert_eq!(state["selection"]["ranges"][0]["head"], cursor);
            assert_eq!(state["selection"]["main"], 0);

            let (snapshot_draft_id, up_to_event_id, label, created_at): (String, i64, String, i64) =
                conn.query_row(
                    "SELECT draft_id, up_to_event_id, label, created_at
                     FROM snapshots WHERE draft_id = ?1",
                    params![draft_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .unwrap();
            assert_eq!(snapshot_draft_id, draft_id);
            assert_eq!(up_to_event_id, 0);
            assert_eq!(label, "College prompt");
            assert!(created_at > 0);

            (document_id, draft_id)
        };

        let reopened = open_db(&db_path).unwrap();
        let loaded = load_document_state(&reopened, &document_id, Some(&draft_id)).unwrap();
        assert_eq!(loaded.snapshot_event_id, 0);
        let state: serde_json::Value =
            serde_json::from_str(loaded.snapshot_state_json.as_deref().unwrap()).unwrap();
        assert_eq!(state["doc"], content);
        assert_eq!(
            state["selection"]["ranges"][0]["anchor"],
            content.encode_utf16().count()
        );
    }

    #[test]
    fn older_college_tab_input_without_initial_content_is_supported() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_db(&dir.path().join("legacy-college-input.db")).unwrap();
        let document_id = create_document(&conn, "College", None).unwrap();
        let setup = r#"{"version":1,"prompts":[{"id":"legacy"}]}"#;
        let entry: CollegeTabInput = serde_json::from_value(serde_json::json!({
            "label": "Legacy",
            "setupJson": setup,
        }))
        .unwrap();

        assert!(entry.initial_content.is_none());
        let tabs = create_college_tabs(&conn, &document_id, &[entry]).unwrap();
        let draft_id: String = conn
            .query_row(
                "SELECT id FROM drafts WHERE tab_id = ?1",
                params![tabs[0].id],
                |row| row.get(0),
            )
            .unwrap();
        let loaded = load_document_state(&conn, &document_id, Some(&draft_id)).unwrap();
        assert!(loaded.snapshot_state_json.is_none());
        let snapshot_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM snapshots WHERE draft_id = ?1",
                params![draft_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(snapshot_count, 0);
    }

    #[test]
    fn initial_content_is_rejected_when_over_byte_limit() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_db(&dir.path().join("oversized-college-input.db")).unwrap();
        let document_id = create_document(&conn, "College", None).unwrap();
        let setup = r#"{"version":1,"prompts":[{"id":"essay"}]}"#;
        let oversized = "é".repeat(6_001);
        assert!(oversized.len() > MAX_INITIAL_CONTENT_BYTES);

        let error = create_college_tabs(
            &conn,
            &document_id,
            &[batch_entry_with_content("Essay", setup, &oversized)],
        )
        .unwrap_err();
        assert!(matches!(
            error,
            DbError::Validation(message) if message.contains("12000 bytes")
        ));
        assert_eq!(list_tabs(&conn, &document_id).unwrap().len(), 0);
        let snapshot_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM snapshots", [], |row| row.get(0))
            .unwrap();
        assert_eq!(snapshot_count, 0);
    }

    #[test]
    fn batch_creation_rejects_missing_or_trashed_documents() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_db(&dir.path().join("test.db")).unwrap();
        let document_id = create_document(&conn, "College", None).unwrap();
        let setup = r#"{"version":1,"prompts":[{"id":"a"}]}"#;
        let entry = [batch_entry("Common App", setup)];

        assert!(create_college_tabs(&conn, "missing", &entry).is_err());
        trash_document(&conn, &document_id).unwrap();
        assert!(create_college_tabs(&conn, &document_id, &entry).is_err());
        assert_eq!(list_tabs(&conn, &document_id).unwrap().len(), 0);
    }

    #[test]
    fn single_create_tab_still_creates_its_root_and_event() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_db(&dir.path().join("test.db")).unwrap();
        let document_id = create_document(&conn, "College", None).unwrap();

        let tab = create_tab(&conn, &document_id, "Single").unwrap();

        assert_eq!(tab.label, "Single");
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM drafts WHERE tab_id = ?1",
                params![tab.id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            1
        );
        assert_eq!(
            conn.query_row(
                "SELECT event_type FROM doc_events WHERE document_id = ?1",
                params![document_id],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
            "tab_created"
        );
    }

    #[test]
    fn setup_json_round_trips_after_reopening_database() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("reopen.db");
        let setup = r#"{"version":1,"research":{"url":"https://admissions.example.edu/apply/"}}"#;
        let (document_id, tab_id) = {
            let conn = open_db(&db_path).unwrap();
            let document_id = create_document(&conn, "Research", None).unwrap();
            let tab_id = create_tab(&conn, &document_id, "College").unwrap().id;
            set_college_tab_setup(&conn, &document_id, &tab_id, Some(setup)).unwrap();
            set_college_document_enabled(&conn, &document_id, true).unwrap();
            (document_id, tab_id)
        };

        let reopened = open_db(&db_path).unwrap();
        assert_eq!(
            get_college_tab_setup(&reopened, &document_id, &tab_id).unwrap(),
            Some(setup.to_string())
        );
        assert!(get_college_document_enabled(&reopened, &document_id).unwrap());
    }
}
