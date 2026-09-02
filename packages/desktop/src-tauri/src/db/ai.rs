//! ai.rs — Draft-scoped AI conversations plus document-scoped editorial state.
//!
//! The database stores AI SDK messages as opaque JSON. The frontend owns the
//! message schema, while this module enforces ownership, valid modes, and JSON
//! syntax before a value reaches SQLite.

use rusqlite::{params, Connection, Error, OptionalExtension, Result};
use std::time::{SystemTime, UNIX_EPOCH};

const CONVERSATION_MODES: &[&str] = &["chat", "feedback", "revise"];

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn validate_mode(mode: &str) -> Result<()> {
    if CONVERSATION_MODES.contains(&mode) {
        return Ok(());
    }
    Err(Error::InvalidParameterName(format!(
        "unsupported AI conversation mode: {mode}",
    )))
}

fn validate_messages_json(messages_json: &str) -> Result<()> {
    let value: serde_json::Value = serde_json::from_str(messages_json)
        .map_err(|error| Error::InvalidParameterName(error.to_string()))?;
    if value.is_array() {
        return Ok(());
    }
    Err(Error::InvalidParameterName(
        "AI conversation messages must be a JSON array".to_string(),
    ))
}

fn validate_decisions_json(decisions_json: &str) -> Result<()> {
    let value: serde_json::Value = serde_json::from_str(decisions_json)
        .map_err(|error| Error::InvalidParameterName(error.to_string()))?;
    let Some(decisions) = value.as_array() else {
        return Err(Error::InvalidParameterName(
            "editorial decisions must be a JSON array".to_string(),
        ));
    };
    if decisions.iter().all(|decision| {
        decision
            .as_str()
            .is_some_and(|text| !text.trim().is_empty() && text.chars().count() <= 500)
    }) {
        return Ok(());
    }
    Err(Error::InvalidParameterName(
        "editorial decisions must be non-empty strings of at most 500 characters".to_string(),
    ))
}

pub fn load_conversation(conn: &Connection, draft_id: &str, mode: &str) -> Result<Option<String>> {
    validate_mode(mode)?;
    conn.query_row(
        "SELECT messages_json FROM ai_conversations WHERE draft_id = ?1 AND mode = ?2",
        params![draft_id, mode],
        |row| row.get(0),
    )
    .optional()
}

pub fn save_conversation(
    conn: &Connection,
    draft_id: &str,
    mode: &str,
    messages_json: &str,
) -> Result<()> {
    validate_mode(mode)?;
    validate_messages_json(messages_json)?;
    conn.execute(
        "INSERT INTO ai_conversations (draft_id, mode, messages_json, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(draft_id, mode) DO UPDATE SET
             messages_json = excluded.messages_json,
             updated_at = excluded.updated_at",
        params![draft_id, mode, messages_json, now_ms()],
    )?;
    Ok(())
}

pub fn clear_conversation(conn: &Connection, draft_id: &str, mode: &str) -> Result<()> {
    validate_mode(mode)?;
    conn.execute(
        "DELETE FROM ai_conversations WHERE draft_id = ?1 AND mode = ?2",
        params![draft_id, mode],
    )?;
    Ok(())
}

pub fn get_writer_brief(conn: &Connection, document_id: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT writer_brief FROM document_ai_profiles WHERE document_id = ?1",
        params![document_id],
        |row| row.get(0),
    )
    .optional()
}

pub fn set_writer_brief(conn: &Connection, document_id: &str, writer_brief: &str) -> Result<()> {
    if writer_brief.is_empty() {
        conn.execute(
            "DELETE FROM document_ai_profiles WHERE document_id = ?1",
            params![document_id],
        )?;
        return Ok(());
    }
    conn.execute(
        "INSERT INTO document_ai_profiles (document_id, writer_brief, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(document_id) DO UPDATE SET
             writer_brief = excluded.writer_brief,
             updated_at = excluded.updated_at",
        params![document_id, writer_brief, now_ms()],
    )?;
    Ok(())
}

pub fn get_editorial_decisions(conn: &Connection, document_id: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT decisions_json FROM document_editorial_decisions WHERE document_id = ?1",
        params![document_id],
        |row| row.get(0),
    )
    .optional()
}

pub fn set_editorial_decisions(
    conn: &Connection,
    document_id: &str,
    decisions_json: &str,
) -> Result<()> {
    validate_decisions_json(decisions_json)?;
    if decisions_json == "[]" {
        conn.execute(
            "DELETE FROM document_editorial_decisions WHERE document_id = ?1",
            params![document_id],
        )?;
        return Ok(());
    }
    conn.execute(
        "INSERT INTO document_editorial_decisions (document_id, decisions_json, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(document_id) DO UPDATE SET
             decisions_json = excluded.decisions_json,
             updated_at = excluded.updated_at",
        params![document_id, decisions_json, now_ms()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::open_db;

    fn seeded_db() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_db(&dir.path().join("test.db")).unwrap();
        conn.execute(
            "INSERT INTO documents (id, title, created_at, updated_at)
             VALUES ('doc-a', 'A', 0, 0), ('doc-b', 'B', 0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO drafts (id, document_id, label, created_at, is_active)
             VALUES ('draft-a', 'doc-a', 'Draft', 0, 1),
                    ('draft-b', 'doc-b', 'Draft', 0, 1)",
            [],
        )
        .unwrap();
        (dir, conn)
    }

    #[test]
    fn conversations_are_scoped_by_draft_and_mode() {
        let (_dir, conn) = seeded_db();
        save_conversation(&conn, "draft-a", "chat", r#"[{"id":"chat-a"}]"#).unwrap();
        save_conversation(&conn, "draft-a", "feedback", r#"[{"id":"feedback-a"}]"#).unwrap();
        save_conversation(&conn, "draft-b", "chat", r#"[{"id":"chat-b"}]"#).unwrap();

        assert_eq!(
            load_conversation(&conn, "draft-a", "chat").unwrap(),
            Some(r#"[{"id":"chat-a"}]"#.to_string()),
        );
        assert_eq!(
            load_conversation(&conn, "draft-a", "feedback").unwrap(),
            Some(r#"[{"id":"feedback-a"}]"#.to_string()),
        );
        assert_eq!(
            load_conversation(&conn, "draft-b", "chat").unwrap(),
            Some(r#"[{"id":"chat-b"}]"#.to_string()),
        );
    }

    #[test]
    fn clearing_one_conversation_leaves_the_other_modes() {
        let (_dir, conn) = seeded_db();
        save_conversation(&conn, "draft-a", "chat", "[]").unwrap();
        save_conversation(&conn, "draft-a", "revise", "[]").unwrap();

        clear_conversation(&conn, "draft-a", "chat").unwrap();

        assert_eq!(load_conversation(&conn, "draft-a", "chat").unwrap(), None);
        assert_eq!(
            load_conversation(&conn, "draft-a", "revise").unwrap(),
            Some("[]".to_string()),
        );
    }

    #[test]
    fn conversation_rejects_invalid_mode_and_payload() {
        let (_dir, conn) = seeded_db();
        assert!(save_conversation(&conn, "draft-a", "dictionary", "[]").is_err());
        assert!(save_conversation(&conn, "draft-a", "chat", "{}").is_err());
        assert!(save_conversation(&conn, "draft-a", "chat", "not json").is_err());
    }

    #[test]
    fn writer_briefs_are_document_scoped_and_empty_clears() {
        let (_dir, conn) = seeded_db();
        set_writer_brief(&conn, "doc-a", "Keep the narrator guarded.").unwrap();
        set_writer_brief(&conn, "doc-b", "Technical audience.").unwrap();

        assert_eq!(
            get_writer_brief(&conn, "doc-a").unwrap(),
            Some("Keep the narrator guarded.".to_string()),
        );
        assert_eq!(
            get_writer_brief(&conn, "doc-b").unwrap(),
            Some("Technical audience.".to_string()),
        );

        set_writer_brief(&conn, "doc-a", "").unwrap();
        assert_eq!(get_writer_brief(&conn, "doc-a").unwrap(), None);
        assert_eq!(
            get_writer_brief(&conn, "doc-b").unwrap(),
            Some("Technical audience.".to_string()),
        );
    }

    #[test]
    fn editorial_decisions_are_document_scoped_validated_and_clearable() {
        let (_dir, conn) = seeded_db();
        set_editorial_decisions(
            &conn,
            "doc-a",
            r#"["Keep the unresolved ending.","Retain first person."]"#,
        )
        .unwrap();

        assert_eq!(
            get_editorial_decisions(&conn, "doc-a").unwrap(),
            Some(r#"["Keep the unresolved ending.","Retain first person."]"#.to_string()),
        );
        assert_eq!(get_editorial_decisions(&conn, "doc-b").unwrap(), None);
        assert!(set_editorial_decisions(&conn, "doc-a", r#"[""]"#).is_err());
        assert!(set_editorial_decisions(&conn, "doc-a", "{}").is_err());

        set_editorial_decisions(&conn, "doc-a", "[]").unwrap();
        assert_eq!(get_editorial_decisions(&conn, "doc-a").unwrap(), None);
    }

    #[test]
    fn deleting_owners_cascades_ai_state() {
        let (_dir, conn) = seeded_db();
        save_conversation(&conn, "draft-a", "chat", "[]").unwrap();
        set_writer_brief(&conn, "doc-a", "Brief").unwrap();
        set_editorial_decisions(&conn, "doc-a", r#"["Keep the ending."]"#).unwrap();

        conn.execute("DELETE FROM documents WHERE id = 'doc-a'", [])
            .unwrap();

        assert_eq!(load_conversation(&conn, "draft-a", "chat").unwrap(), None);
        assert_eq!(get_writer_brief(&conn, "doc-a").unwrap(), None);
        assert_eq!(get_editorial_decisions(&conn, "doc-a").unwrap(), None);
    }
}
