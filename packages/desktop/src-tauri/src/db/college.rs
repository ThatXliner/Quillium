//! college.rs — Per-tab College plugin setup persistence.
//!
//! College setup JSON is scoped to a tab, while the document remains the
//! ownership boundary used to validate command targets. The database stores
//! the JSON opaquely after validating the version-1 shape on writes so a newer
//! frontend can be read and blocked without being overwritten by an older one.

use super::now_ms;

use rusqlite::{params, Connection, Error, OptionalExtension, Result};

const MAX_SETUP_BYTES: usize = 128 * 1024;
const CURRENT_SETUP_VERSION: i64 = 1;

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::documents::{
        create_document, delete_document, restore_document, trash_document,
    };
    use crate::db::schema::open_db;
    use crate::db::tabs::create_tab;

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
}
