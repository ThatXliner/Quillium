//! ai.rs — Durable AI conversations plus document-scoped editorial state.
//!
//! The database stores AI SDK messages as opaque JSON. The frontend owns the
//! message schema, while this module enforces ownership, valid modes, and JSON
//! syntax before a value reaches SQLite.

use super::{now_ms, Conversation, DbError, DbResult};

use rusqlite::{params, Connection, Error, OptionalExtension, Result, Row};

const CONVERSATION_MODES: &[&str] = &["chat", "feedback", "revise"];

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

fn validate_conversation_id(id: &str) -> DbResult<()> {
    if id.trim().is_empty() {
        return Err(DbError::Validation(
            "conversation id must not be empty".to_string(),
        ));
    }
    Ok(())
}

fn validate_conversation_title(title: &str) -> DbResult<()> {
    let length = title.chars().count();
    if title.trim().is_empty() || length > 200 {
        return Err(DbError::Validation(
            "conversation title must be non-empty and at most 200 characters".to_string(),
        ));
    }
    Ok(())
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

fn read_conversation(row: &Row<'_>) -> rusqlite::Result<Conversation> {
    Ok(Conversation {
        id: row.get(0)?,
        document_id: row.get(1)?,
        draft_id: row.get(2)?,
        draft_label: row.get(3)?,
        mode: row.get(4)?,
        title: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        archived: row.get::<_, i64>(8)? != 0,
        messages_json: row.get(9)?,
        source_conversation_id: row.get(10)?,
        source_message_id: row.get(11)?,
    })
}

const CONVERSATION_COLUMNS: &str =
    "id, document_id, draft_id, draft_label, mode, title, created_at, updated_at, archived,\
     messages_json, source_conversation_id, source_message_id";

/// Lists every saved conversation for a document, including archived rows.
/// Message JSON is returned with each record because the local history view
/// searches message content without another round trip per conversation.
pub fn list_conversations(conn: &Connection, document_id: &str) -> Result<Vec<Conversation>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {CONVERSATION_COLUMNS}
         FROM ai_conversation_history
         WHERE document_id = ?1
         ORDER BY updated_at DESC, created_at DESC, id DESC",
    ))?;
    let rows = stmt.query_map(params![document_id], read_conversation)?;
    rows.collect()
}

pub fn get_conversation(conn: &Connection, id: &str) -> Result<Option<Conversation>> {
    conn.query_row(
        &format!(
            "SELECT {CONVERSATION_COLUMNS}
             FROM ai_conversation_history
             WHERE id = ?1",
        ),
        params![id],
        read_conversation,
    )
    .optional()
}

/// Creates a conversation anchored to a draft. The draft label is copied into
/// the history row so the record remains descriptive after draft deletion.
/// Source references are intentionally opaque: a branch may retain an origin
/// conversation or message that is deleted later.
pub fn create_conversation(
    conn: &Connection,
    id: &str,
    document_id: &str,
    draft_id: &str,
    mode: &str,
    title: &str,
    messages_json: &str,
    source_conversation_id: Option<&str>,
    source_message_id: Option<&str>,
) -> DbResult<Conversation> {
    validate_conversation_id(id)?;
    validate_conversation_title(title)?;
    validate_mode(mode).map_err(DbError::from)?;
    validate_messages_json(messages_json).map_err(DbError::from)?;

    let draft_label: String = conn
        .query_row(
            "SELECT label FROM drafts WHERE id = ?1 AND document_id = ?2",
            params![draft_id, document_id],
            |row| row.get(0),
        )
        .map_err(|error| match error {
            Error::QueryReturnedNoRows => DbError::Validation(format!(
                "draft {draft_id} does not belong to document {document_id}"
            )),
            other => DbError::Sql(other),
        })?;
    let now = now_ms();
    conn.execute(
        "INSERT INTO ai_conversation_history
             (id, document_id, draft_id, draft_label, mode, title, created_at, updated_at,
              archived, messages_json, source_conversation_id, source_message_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, 0, ?8, ?9, ?10)",
        params![
            id,
            document_id,
            draft_id,
            draft_label,
            mode,
            title,
            now,
            messages_json,
            source_conversation_id,
            source_message_id,
        ],
    )?;
    get_conversation(conn, id)?.ok_or_else(|| {
        DbError::Validation(format!("conversation {id} was not found after creation"))
    })
}

/// Updates an existing conversation's messages. This deliberately uses an
/// UPDATE-only path: a stale writer cannot recreate a conversation that was
/// deleted while it was streaming.
pub fn save_conversation_messages(
    conn: &Connection,
    id: &str,
    messages_json: &str,
) -> DbResult<()> {
    validate_conversation_id(id)?;
    validate_messages_json(messages_json).map_err(DbError::from)?;
    let changed = conn.execute(
        "UPDATE ai_conversation_history
         SET messages_json = ?1, updated_at = ?2
         WHERE id = ?3",
        params![messages_json, now_ms(), id],
    )?;
    if changed == 0 {
        return Err(DbError::Validation(format!("conversation {id} not found")));
    }
    Ok(())
}

pub fn rename_conversation(conn: &Connection, id: &str, title: &str) -> DbResult<()> {
    validate_conversation_id(id)?;
    validate_conversation_title(title)?;
    let changed = conn.execute(
        "UPDATE ai_conversation_history
         SET title = ?1, updated_at = ?2
         WHERE id = ?3",
        params![title, now_ms(), id],
    )?;
    if changed == 0 {
        return Err(DbError::Validation(format!("conversation {id} not found")));
    }
    Ok(())
}

pub fn archive_conversation(conn: &Connection, id: &str, archived: bool) -> DbResult<()> {
    validate_conversation_id(id)?;
    let changed = conn.execute(
        "UPDATE ai_conversation_history
         SET archived = ?1, updated_at = ?2
         WHERE id = ?3",
        params![archived as i64, now_ms(), id],
    )?;
    if changed == 0 {
        return Err(DbError::Validation(format!("conversation {id} not found")));
    }
    Ok(())
}

pub fn delete_conversation(conn: &Connection, id: &str) -> DbResult<()> {
    validate_conversation_id(id)?;
    let changed = conn.execute(
        "DELETE FROM ai_conversation_history WHERE id = ?1",
        params![id],
    )?;
    if changed == 0 {
        return Err(DbError::Validation(format!("conversation {id} not found")));
    }
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
    fn history_crud_keeps_records_isolated_and_survives_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.db");
        let second_id = {
            let conn = open_db(&path).unwrap();
            conn.execute(
                "INSERT INTO documents (id, title, created_at, updated_at)
                 VALUES ('doc-a', 'A', 0, 0)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO drafts (id, document_id, label, created_at, is_active)
                 VALUES ('draft-a', 'doc-a', 'First take', 0, 1)",
                [],
            )
            .unwrap();

            let first = create_conversation(
                &conn,
                "conversation-1",
                "doc-a",
                "draft-a",
                "chat",
                "First conversation",
                r#"[{"id":"message-1"}]"#,
                None,
                None,
            )
            .unwrap();
            let second = create_conversation(
                &conn,
                "conversation-2",
                "doc-a",
                "draft-a",
                "chat",
                "Second conversation",
                r#"[{"id":"message-2"}]"#,
                Some(&first.id),
                Some("message-1"),
            )
            .unwrap();

            assert_eq!(first.draft_label, "First take");
            assert_eq!(
                second.source_conversation_id.as_deref(),
                Some(first.id.as_str())
            );
            assert_eq!(second.source_message_id.as_deref(), Some("message-1"));
            assert_eq!(list_conversations(&conn, "doc-a").unwrap().len(), 2);

            archive_conversation(&conn, &first.id, true).unwrap();
            rename_conversation(&conn, &second.id, "Renamed conversation").unwrap();
            save_conversation_messages(&conn, &second.id, r#"[{"id":"message-2b"}]"#).unwrap();

            let listed = list_conversations(&conn, "doc-a").unwrap();
            let archived = listed.iter().find(|item| item.id == first.id).unwrap();
            let renamed = listed.iter().find(|item| item.id == second.id).unwrap();
            assert!(archived.archived);
            assert_eq!(renamed.title, "Renamed conversation");
            assert_eq!(renamed.messages_json, r#"[{"id":"message-2b"}]"#);

            archive_conversation(&conn, &first.id, false).unwrap();
            assert!(
                !get_conversation(&conn, &first.id)
                    .unwrap()
                    .unwrap()
                    .archived
            );
            archive_conversation(&conn, &first.id, true).unwrap();

            delete_conversation(&conn, &first.id).unwrap();
            assert_eq!(get_conversation(&conn, &first.id).unwrap(), None);
            assert_eq!(list_conversations(&conn, "doc-a").unwrap().len(), 1);
            assert!(save_conversation_messages(&conn, &first.id, "[]").is_err());

            second.id
        };

        // The ID is caller-owned and the remaining row must be visible from a
        // fresh connection after the original connection is dropped.
        let conn = open_db(&path).unwrap();
        let reopened = get_conversation(&conn, &second_id).unwrap().unwrap();
        assert_eq!(reopened.id, "conversation-2");
        assert_eq!(reopened.title, "Renamed conversation");
        assert_eq!(reopened.messages_json, r#"[{"id":"message-2b"}]"#);
        assert_eq!(
            reopened.source_conversation_id.as_deref(),
            Some("conversation-1")
        );
        assert_eq!(reopened.source_message_id.as_deref(), Some("message-1"));
    }

    #[test]
    fn draft_deletion_keeps_history_and_source_refs() {
        let (_dir, conn) = seeded_db();
        let source = create_conversation(
            &conn,
            "source-conversation",
            "doc-a",
            "draft-a",
            "feedback",
            "Source",
            "[]",
            None,
            None,
        )
        .unwrap();
        let branch = create_conversation(
            &conn,
            "branch-conversation",
            "doc-a",
            "draft-a",
            "feedback",
            "Branch",
            "[]",
            Some(&source.id),
            Some("source-message"),
        )
        .unwrap();

        conn.execute("DELETE FROM drafts WHERE id = 'draft-a'", [])
            .unwrap();

        let retained = get_conversation(&conn, &branch.id).unwrap().unwrap();
        assert_eq!(retained.draft_id, "draft-a");
        assert_eq!(retained.draft_label, "Draft");
        assert_eq!(
            retained.source_conversation_id.as_deref(),
            Some(source.id.as_str())
        );
        assert_eq!(
            retained.source_message_id.as_deref(),
            Some("source-message")
        );
        save_conversation_messages(&conn, &branch.id, r#"[{"id":"late-message"}]"#).unwrap();

        delete_conversation(&conn, &source.id).unwrap();
        let retained = get_conversation(&conn, &branch.id).unwrap().unwrap();
        assert_eq!(
            retained.source_conversation_id.as_deref(),
            Some("source-conversation")
        );

        // The document owner still cascades physical deletion of its history.
        conn.execute("DELETE FROM documents WHERE id = 'doc-a'", [])
            .unwrap();
        assert!(get_conversation(&conn, &branch.id).unwrap().is_none());
    }

    #[test]
    fn history_creation_validates_draft_ownership_and_input() {
        let (_dir, conn) = seeded_db();
        assert!(create_conversation(
            &conn,
            "conversation-1",
            "doc-a",
            "draft-b",
            "chat",
            "Wrong draft",
            "[]",
            None,
            None,
        )
        .is_err());
        assert!(create_conversation(
            &conn,
            "conversation-1",
            "doc-a",
            "draft-a",
            "dictionary",
            "Bad mode",
            "[]",
            None,
            None,
        )
        .is_err());
        assert!(create_conversation(
            &conn,
            "conversation-1",
            "doc-a",
            "draft-a",
            "chat",
            "Bad messages",
            "{}",
            None,
            None,
        )
        .is_err());
        assert!(create_conversation(
            &conn,
            "conversation-1",
            "doc-a",
            "draft-a",
            "chat",
            " ",
            "[]",
            None,
            None,
        )
        .is_err());
        assert!(create_conversation(
            &conn,
            "",
            "doc-a",
            "draft-a",
            "chat",
            "Valid title",
            "[]",
            None,
            None,
        )
        .is_err());
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
