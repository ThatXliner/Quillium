use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::Deserialize;
use std::collections::HashMap;
use uuid::Uuid;

use super::{now_ms, DocumentMeta, DraftMeta};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateDraftState {
    pub source_draft_id: String,
    pub source_event_id: i64,
    pub state_json: String,
}

pub fn list_documents(conn: &Connection) -> Result<Vec<DocumentMeta>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, created_at, updated_at, word_count, preview_text, tags, deleted_at,
                persist_history, created_with_version
         FROM documents WHERE deleted_at IS NULL ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(DocumentMeta {
            id: row.get(0)?,
            title: row.get(1)?,
            created_at: row.get(2)?,
            updated_at: row.get(3)?,
            word_count: row.get(4)?,
            preview_text: row.get(5)?,
            tags: row.get(6)?,
            deleted_at: row.get(7)?,
            persist_history: row.get(8)?,
            created_with_version: row.get(9)?,
        })
    })?;
    rows.collect()
}

pub fn list_trashed_documents(conn: &Connection) -> Result<Vec<DocumentMeta>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, created_at, updated_at, word_count, preview_text, tags, deleted_at,
                persist_history, created_with_version
         FROM documents WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(DocumentMeta {
            id: row.get(0)?,
            title: row.get(1)?,
            created_at: row.get(2)?,
            updated_at: row.get(3)?,
            word_count: row.get(4)?,
            preview_text: row.get(5)?,
            tags: row.get(6)?,
            deleted_at: row.get(7)?,
            persist_history: row.get(8)?,
            created_with_version: row.get(9)?,
        })
    })?;
    rows.collect()
}

pub fn get_document(conn: &Connection, id: &str) -> Result<Option<DocumentMeta>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, created_at, updated_at, word_count, preview_text, tags, deleted_at,
                persist_history, created_with_version
         FROM documents WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], |row| {
        Ok(DocumentMeta {
            id: row.get(0)?,
            title: row.get(1)?,
            created_at: row.get(2)?,
            updated_at: row.get(3)?,
            word_count: row.get(4)?,
            preview_text: row.get(5)?,
            tags: row.get(6)?,
            deleted_at: row.get(7)?,
            persist_history: row.get(8)?,
            created_with_version: row.get(9)?,
        })
    })?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub fn create_document(
    conn: &Connection,
    title: &str,
    created_with_version: Option<&str>,
) -> Result<String> {
    create_document_with_history(conn, title, false, created_with_version)
}

pub fn create_document_with_history(
    conn: &Connection,
    title: &str,
    persist_history: bool,
    created_with_version: Option<&str>,
) -> Result<String> {
    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    conn.execute(
        "INSERT INTO documents
             (id, title, created_at, updated_at, word_count, preview_text, tags, persist_history,
              created_with_version)
         VALUES (?1, ?2, ?3, ?4, 0, '', '[]', ?5, ?6)",
        params![id, title, now, now, persist_history, created_with_version],
    )?;
    Ok(id)
}

/// Atomically duplicates the live document structure using fully materialized
/// draft states supplied by the frontend. Event and structural history are
/// intentionally not copied; each new draft starts from one compact snapshot.
pub fn duplicate_document(
    conn: &Connection,
    source_document_id: &str,
    draft_states: &[DuplicateDraftState],
) -> Result<String> {
    let tx = conn.unchecked_transaction()?;
    let source = tx
        .query_row(
            "SELECT title, word_count, preview_text, tags, body_text, persist_history,
                    created_with_version
             FROM documents WHERE id = ?1 AND deleted_at IS NULL",
            params![source_document_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, bool>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            },
        )
        .optional()?
        .ok_or(rusqlite::Error::QueryReturnedNoRows)?;

    let tabs = {
        let mut stmt = tx.prepare(
            "SELECT id, tab_type, label, position FROM tabs
             WHERE document_id = ?1 AND deleted_at IS NULL
             ORDER BY position ASC, created_at ASC",
        )?;
        let rows = stmt.query_map(params![source_document_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>>>()?
    };
    let drafts = {
        let mut stmt = tx.prepare(
            "SELECT id, tab_id, label, is_active, parent_draft_id, branched_from, locked
             FROM drafts WHERE document_id = ?1 AND deleted_at IS NULL
             ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![source_document_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, bool>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, bool>(6)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>>>()?
    };

    let states: HashMap<&str, &DuplicateDraftState> = draft_states
        .iter()
        .map(|state| (state.source_draft_id.as_str(), state))
        .collect();
    if states.len() != draft_states.len()
        || states.len() != drafts.len()
        || drafts
            .iter()
            .any(|draft| !states.contains_key(draft.0.as_str()))
    {
        return Err(rusqlite::Error::InvalidParameterName(
            "draftStates must contain exactly one state for every live draft".to_string(),
        ));
    }
    for (source_id, _, _, _, _, _, _) in &drafts {
        let latest_event_id: i64 = tx.query_row(
            "SELECT COALESCE(MAX(id), -1) FROM events WHERE draft_id = ?1",
            params![source_id],
            |row| row.get(0),
        )?;
        if states[source_id.as_str()].source_event_id != latest_event_id {
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "draft {source_id} changed while duplication was being prepared",
            )));
        }
    }

    let document_id = Uuid::new_v4().to_string();
    let title = format!("{} — Copy", source.0);
    let now = now_ms();
    tx.execute(
        "INSERT INTO documents
         (id, title, created_at, updated_at, word_count, preview_text, tags, body_text,
          persist_history, created_with_version)
         VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            document_id,
            title,
            now,
            source.1,
            source.2,
            source.3,
            source.4,
            source.5,
            source.6,
        ],
    )?;

    let tab_ids: HashMap<String, String> = tabs
        .iter()
        .map(|(source_id, _, _, _)| (source_id.clone(), Uuid::new_v4().to_string()))
        .collect();
    let draft_ids: HashMap<String, String> = drafts
        .iter()
        .map(|(source_id, _, _, _, _, _, _)| (source_id.clone(), Uuid::new_v4().to_string()))
        .collect();

    for (source_id, tab_type, label, position) in &tabs {
        tx.execute(
            "INSERT INTO tabs (id, document_id, tab_type, label, position, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                tab_ids[source_id],
                document_id,
                tab_type,
                label,
                position,
                now
            ],
        )?;
    }
    for (source_tab_id, new_tab_id) in &tab_ids {
        tx.execute(
            "INSERT INTO college_tab_setups (tab_id, setup_json, updated_at)
             SELECT ?1, setup_json, ?2
             FROM college_tab_setups
             WHERE tab_id = ?3",
            params![new_tab_id, now, source_tab_id],
        )?;
    }
    for (source_id, tab_id, label, is_active, parent_id, branched_from, locked) in &drafts {
        let mapped_tab_id = tab_id
            .as_ref()
            .and_then(|id| tab_ids.get(id))
            .ok_or_else(|| {
                rusqlite::Error::InvalidParameterName(format!(
                    "draft {source_id} references a missing live tab",
                ))
            })?;
        let _mapped_parent = parent_id
            .as_ref()
            .map(|id| {
                draft_ids.get(id).ok_or_else(|| {
                    rusqlite::Error::InvalidParameterName(format!(
                        "draft {source_id} references a missing live parent",
                    ))
                })
            })
            .transpose()?;
        let _mapped_branch = branched_from
            .as_ref()
            .map(|id| {
                draft_ids.get(id).ok_or_else(|| {
                    rusqlite::Error::InvalidParameterName(format!(
                        "draft {source_id} references a missing live branch source",
                    ))
                })
            })
            .transpose()?;
        let new_draft_id = &draft_ids[source_id];
        tx.execute(
            "INSERT INTO drafts
             (id, document_id, tab_id, label, created_at, is_active, parent_draft_id,
              branched_from, locked)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, ?7)",
            params![
                new_draft_id,
                document_id,
                mapped_tab_id,
                label,
                now,
                is_active,
                locked,
            ],
        )?;
        tx.execute(
            "INSERT INTO snapshots (draft_id, up_to_event_id, state_json, created_at, label)
             VALUES (?1, -1, ?2, ?3, NULL)",
            params![new_draft_id, states[source_id.as_str()].state_json, now],
        )?;
    }
    // Link the graph only after every draft row exists, so copies are valid
    // regardless of legacy timestamps or row ordering in the source.
    for (source_id, _, _, _, parent_id, branched_from, _) in &drafts {
        let mapped_parent = parent_id.as_ref().and_then(|id| draft_ids.get(id));
        let mapped_branch = branched_from.as_ref().and_then(|id| draft_ids.get(id));
        tx.execute(
            "UPDATE drafts SET parent_draft_id = ?1, branched_from = ?2 WHERE id = ?3",
            params![mapped_parent, mapped_branch, draft_ids[source_id]],
        )?;
    }

    let source_active_tab: Option<String> = tx
        .query_row(
            "SELECT value FROM _meta WHERE key = ?1",
            params![format!("active_tab:{source_document_id}")],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(active_tab) = source_active_tab.and_then(|id| tab_ids.get(&id)) {
        tx.execute(
            "INSERT INTO _meta (key, value) VALUES (?1, ?2)",
            params![format!("active_tab:{document_id}"), active_tab],
        )?;
    }
    for (source_tab_id, new_tab_id) in &tab_ids {
        let source_active_draft: Option<String> = tx
            .query_row(
                "SELECT value FROM _meta WHERE key = ?1",
                params![format!("active_draft:{source_tab_id}")],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(active_draft) = source_active_draft.and_then(|id| draft_ids.get(&id)) {
            tx.execute(
                "INSERT INTO _meta (key, value) VALUES (?1, ?2)",
                params![format!("active_draft:{new_tab_id}"), active_draft],
            )?;
        }
    }

    // The writer brief describes the document itself, so a document copy keeps it.
    // Draft conversations are deliberately omitted with the rest of the event history.
    tx.execute(
        "INSERT INTO document_ai_profiles (document_id, writer_brief, updated_at)
         SELECT ?1, writer_brief, ?2 FROM document_ai_profiles WHERE document_id = ?3",
        params![document_id, now, source_document_id],
    )?;
    tx.execute(
        "INSERT INTO document_editorial_decisions (document_id, decisions_json, updated_at)
         SELECT ?1, decisions_json, ?2
         FROM document_editorial_decisions WHERE document_id = ?3",
        params![document_id, now, source_document_id],
    )?;

    tx.commit()?;
    Ok(document_id)
}

/// `body_text` is the full plain text used by full-text search. Pass `None`
/// for metadata-only updates (rename, tags) to leave the indexed body intact.
pub fn update_document_meta(
    conn: &Connection,
    id: &str,
    title: &str,
    word_count: i64,
    preview_text: &str,
    tags: &str,
    body_text: Option<&str>,
) -> Result<()> {
    let now = now_ms();
    match body_text {
        Some(body) => conn.execute(
            "UPDATE documents SET title = ?1, updated_at = ?2, word_count = ?3,
             preview_text = ?4, tags = ?5, body_text = ?6 WHERE id = ?7",
            params![title, now, word_count, preview_text, tags, body, id],
        )?,
        None => conn.execute(
            "UPDATE documents SET title = ?1, updated_at = ?2, word_count = ?3,
             preview_text = ?4, tags = ?5 WHERE id = ?6",
            params![title, now, word_count, preview_text, tags, id],
        )?,
    };
    Ok(())
}

pub fn trash_document(conn: &Connection, id: &str) -> Result<()> {
    let now = now_ms();
    conn.execute(
        "UPDATE documents SET deleted_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    Ok(())
}

pub fn restore_document(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "UPDATE documents SET deleted_at = NULL WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

pub fn delete_document(conn: &Connection, id: &str) -> Result<()> {
    // vec_chunks is a virtual table — FK cascades don't reach it, so clear
    // the document's vectors before the chunks rows cascade away.
    conn.execute(
        "DELETE FROM vec_chunks WHERE rowid IN (SELECT id FROM chunks WHERE document_id = ?1)",
        params![id],
    )?;
    conn.execute("DELETE FROM documents WHERE id = ?1", params![id])?;
    Ok(())
}

/// Returns the configured trash retention in days, or None if "never".
pub fn get_trash_retention(conn: &Connection) -> Result<Option<i64>> {
    let result: rusqlite::Result<String> = conn.query_row(
        "SELECT value FROM _meta WHERE key = 'trash_retention_days'",
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

/// Persists the trash retention setting. Pass None to disable auto-empty.
pub fn set_trash_retention(conn: &Connection, days: Option<i64>) -> Result<()> {
    let value = match days {
        Some(d) => d.to_string(),
        None => "never".to_string(),
    };
    conn.execute(
        "INSERT INTO _meta (key, value) VALUES ('trash_retention_days', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![value],
    )?;
    Ok(())
}

/// Whether the user has opted in to semantic search (which downloads an
/// embedding model on first enable). Defaults to false — keyword search
/// (FTS5) works regardless.
pub fn get_semantic_search_enabled(conn: &Connection) -> Result<bool> {
    let result: rusqlite::Result<String> = conn.query_row(
        "SELECT value FROM _meta WHERE key = 'semantic_search_enabled'",
        [],
        |row| row.get(0),
    );
    match result {
        Ok(val) => Ok(val == "1"),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
        Err(e) => Err(e),
    }
}

pub fn set_semantic_search_enabled(conn: &Connection, enabled: bool) -> Result<()> {
    conn.execute(
        "INSERT INTO _meta (key, value) VALUES ('semantic_search_enabled', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![if enabled { "1" } else { "0" }],
    )?;
    Ok(())
}

/// Permanently deletes trashed documents older than `days` days.
pub fn purge_expired_trash(conn: &Connection, days: i64) -> Result<u64> {
    let cutoff = now_ms() - days * 24 * 60 * 60 * 1000;
    // See delete_document: vectors must be cleared manually (virtual table).
    conn.execute(
        "DELETE FROM vec_chunks WHERE rowid IN (
             SELECT c.id FROM chunks c
             JOIN documents d ON d.id = c.document_id
             WHERE d.deleted_at IS NOT NULL AND d.deleted_at < ?1
         )",
        params![cutoff],
    )?;
    let count = conn.execute(
        "DELETE FROM documents WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
        params![cutoff],
    )?;
    Ok(count as u64)
}

pub fn list_drafts(conn: &Connection, doc_id: &str) -> Result<Vec<DraftMeta>> {
    let mut stmt = conn.prepare(
        "SELECT id, document_id, label, created_at, is_active, tab_id, parent_draft_id,
                branched_from, locked
         FROM drafts WHERE document_id = ?1 AND deleted_at IS NULL ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map(params![doc_id], |row| {
        Ok(DraftMeta {
            id: row.get(0)?,
            document_id: row.get(1)?,
            label: row.get(2)?,
            created_at: row.get(3)?,
            is_active: row.get::<_, i64>(4)? != 0,
            tab_id: row.get(5)?,
            parent_draft_id: row.get(6)?,
            branched_from: row.get(7)?,
            locked: row.get::<_, i64>(8)? != 0,
        })
    })?;
    rows.collect()
}

/// Legacy entry point (debug panel, screenshot scenarios): creates a root
/// draft attached to the document's first tab, creating a "Main" tab first
/// if the document has none.
pub fn create_draft(conn: &Connection, doc_id: &str, label: &str) -> Result<String> {
    let tab_id: Option<String> = conn
        .query_row(
            "SELECT id FROM tabs WHERE document_id = ?1 AND deleted_at IS NULL
             ORDER BY position ASC LIMIT 1",
            params![doc_id],
            |row| row.get(0),
        )
        .ok();
    let tab_id = match tab_id {
        Some(id) => id,
        None => {
            let id = Uuid::new_v4().to_string();
            let now = now_ms();
            conn.execute(
                "INSERT INTO tabs (id, document_id, tab_type, label, position, created_at)
                 VALUES (?1, ?2, 'draft', 'Main', 0, ?3)",
                params![id, doc_id, now],
            )?;
            id
        }
    };
    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    conn.execute(
        "INSERT INTO drafts (id, document_id, tab_id, label, created_at, is_active, locked)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, 0)",
        params![id, doc_id, tab_id, label, now],
    )?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::college::{get_college_tab_setup, set_college_tab_setup};
    use crate::db::schema::open_db;
    use crate::db::tabs::{create_tab, set_active_draft, set_active_tab};

    #[test]
    fn new_document_history_policy_is_explicit() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_db(&dir.path().join("test.db")).unwrap();

        let session_only_id = create_document(&conn, "Session only", None).unwrap();
        let persistent_id = create_document_with_history(&conn, "Persistent", true, None).unwrap();
        conn.execute(
            "INSERT INTO documents
             (id, title, created_at, updated_at, word_count, preview_text, tags)
             VALUES ('database-default', 'Database default', 1, 1, 0, '', '[]')",
            [],
        )
        .unwrap();

        assert!(
            !get_document(&conn, &session_only_id)
                .unwrap()
                .unwrap()
                .persist_history
        );
        assert!(
            get_document(&conn, &persistent_id)
                .unwrap()
                .unwrap()
                .persist_history
        );
        assert!(
            !get_document(&conn, "database-default")
                .unwrap()
                .unwrap()
                .persist_history
        );
    }

    #[test]
    fn creator_versions_round_trip_across_disk_reopen_and_metadata_updates() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("creator-versions.db");
        let versions = [
            Some("0.24.4"),
            Some("0.24.4-rc.1"),
            Some("0.24.4-dev.7+sha.abc123"),
        ];
        let ids = {
            let conn = open_db(&path).unwrap();
            let ids: Vec<String> = versions
                .iter()
                .enumerate()
                .map(|(index, version)| {
                    create_document(&conn, &format!("Document {index}"), *version).unwrap()
                })
                .collect();
            update_document_meta(&conn, &ids[0], "Renamed", 1, "text", "[]", None).unwrap();
            trash_document(&conn, &ids[1]).unwrap();
            assert_eq!(
                list_trashed_documents(&conn).unwrap()[0].created_with_version,
                versions[1].map(str::to_string)
            );
            restore_document(&conn, &ids[1]).unwrap();
            ids
        };

        let conn = open_db(&path).unwrap();
        for (id, expected) in ids.iter().zip(versions) {
            assert_eq!(
                get_document(&conn, id)
                    .unwrap()
                    .unwrap()
                    .created_with_version,
                expected.map(str::to_string)
            );
        }
        let listed: std::collections::HashMap<_, _> = list_documents(&conn)
            .unwrap()
            .into_iter()
            .map(|document| (document.id, document.created_with_version))
            .collect();
        assert_eq!(listed.len(), 3);
        for (id, expected) in ids.iter().zip(versions) {
            assert_eq!(listed.get(id), Some(&expected.map(str::to_string)));
        }
        assert_eq!(list_trashed_documents(&conn).unwrap().len(), 0);
    }

    #[test]
    fn document_meta_creator_version_serializes_as_camel_case_and_missing_is_unknown() {
        let meta = DocumentMeta {
            id: "doc".into(),
            title: "Title".into(),
            created_at: 1,
            updated_at: 2,
            word_count: 3,
            preview_text: "Preview".into(),
            tags: "[]".into(),
            deleted_at: None,
            persist_history: false,
            created_with_version: Some("0.24.4-dev.7+sha.abc123".into()),
        };
        let value = serde_json::to_value(&meta).unwrap();
        assert_eq!(
            value.get("createdWithVersion").and_then(|v| v.as_str()),
            Some("0.24.4-dev.7+sha.abc123")
        );
        assert!(value.get("created_with_version").is_none());
        let decoded: DocumentMeta = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(decoded.created_with_version, meta.created_with_version);

        let mut null_value = value.clone();
        null_value["createdWithVersion"] = serde_json::Value::Null;
        let null_meta: DocumentMeta = serde_json::from_value(null_value).unwrap();
        assert_eq!(null_meta.created_with_version, None);

        let mut missing_value = value;
        missing_value
            .as_object_mut()
            .unwrap()
            .remove("createdWithVersion");
        let missing_meta: DocumentMeta = serde_json::from_value(missing_value).unwrap();
        assert_eq!(missing_meta.created_with_version, None);
    }

    #[test]
    fn imported_metadata_boundary_preserves_known_and_unknown_creator_versions() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_db(&dir.path().join("import-boundary.db")).unwrap();
        let metadata_json = [
            (
                r#"{"id":"known","title":"Known","createdAt":1,"updatedAt":2,"wordCount":0,"previewText":"","tags":"[]","deletedAt":null,"persistHistory":false,"createdWithVersion":"0.24.4-rc.1"}"#,
                Some("0.24.4-rc.1"),
            ),
            (
                r#"{"id":"null","title":"Null","createdAt":1,"updatedAt":2,"wordCount":0,"previewText":"","tags":"[]","deletedAt":null,"persistHistory":false,"createdWithVersion":null}"#,
                None,
            ),
            (
                r#"{"id":"missing","title":"Missing","createdAt":1,"updatedAt":2,"wordCount":0,"previewText":"","tags":"[]","deletedAt":null,"persistHistory":false}"#,
                None,
            ),
        ];

        for (json, expected) in metadata_json {
            let imported: DocumentMeta = serde_json::from_str(json).unwrap();
            let id = create_document_with_history(
                &conn,
                &imported.title,
                imported.persist_history,
                imported.created_with_version.as_deref(),
            )
            .unwrap();
            assert_eq!(
                get_document(&conn, &id)
                    .unwrap()
                    .unwrap()
                    .created_with_version,
                expected.map(str::to_string)
            );
        }
    }

    #[test]
    fn duplicate_document_copies_live_structure_without_history() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_db(&dir.path().join("test.db")).unwrap();
        let source_version = Some("0.24.4-dev.7+sha.abc123");
        let source_id = create_document_with_history(&conn, "Novel", true, source_version).unwrap();
        update_document_meta(
            &conn,
            &source_id,
            "Novel",
            42,
            "Opening words",
            "[\"fiction\"]",
            Some("Opening words and the rest"),
        )
        .unwrap();
        let tab_a = create_tab(&conn, &source_id, "Draft").unwrap();
        let tab_b = create_tab(&conn, &source_id, "Notes").unwrap();
        let setup_a = r#"{"version":1,"prompts":["Draft prompt"]}"#;
        let setup_b = r#"{"version":1,"prompts":["Notes prompt"]}"#;
        set_college_tab_setup(&conn, &source_id, &tab_a.id, Some(setup_a)).unwrap();
        set_college_tab_setup(&conn, &source_id, &tab_b.id, Some(setup_b)).unwrap();
        let root_a: String = conn
            .query_row(
                "SELECT id FROM drafts WHERE tab_id = ?1",
                params![tab_a.id],
                |row| row.get(0),
            )
            .unwrap();
        let root_b: String = conn
            .query_row(
                "SELECT id FROM drafts WHERE tab_id = ?1",
                params![tab_b.id],
                |row| row.get(0),
            )
            .unwrap();
        let child = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO drafts
             (id, document_id, tab_id, label, created_at, is_active, parent_draft_id, locked)
             VALUES (?1, ?2, ?3, 'second', 2, 1, ?4, 0)",
            params![child, source_id, tab_a.id, root_a],
        )
        .unwrap();
        set_active_tab(&conn, &source_id, &tab_a.id).unwrap();
        set_active_draft(&conn, &tab_a.id, &child).unwrap();
        conn.execute(
            "INSERT INTO events (draft_id, event_type, payload, created_at)
             VALUES (?1, 'doc_change', '{}', 3)",
            params![root_a],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO doc_events (document_id, event_type, payload, created_at)
             VALUES (?1, 'tab_created', '{}', 3)",
            params![source_id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO document_ai_profiles (document_id, writer_brief, updated_at)
             VALUES (?1, 'Keep the close third-person voice.', 3)",
            params![source_id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO document_editorial_decisions (document_id, decisions_json, updated_at)
             VALUES (?1, '[\"Keep the unresolved ending.\"]', 3)",
            params![source_id],
        )
        .unwrap();

        let states = vec![
            DuplicateDraftState {
                source_draft_id: root_a.clone(),
                source_event_id: 1,
                state_json: "{\"doc\":\"root\",\"annotationField\":{}}".to_string(),
            },
            DuplicateDraftState {
                source_draft_id: child.clone(),
                source_event_id: -1,
                state_json: "{\"doc\":\"child\",\"annotationField\":{\"900\":{\"id\":900}}}"
                    .to_string(),
            },
            DuplicateDraftState {
                source_draft_id: root_b,
                source_event_id: -1,
                state_json: "{\"doc\":\"notes\",\"annotationField\":{}}".to_string(),
            },
        ];
        let copy_id = duplicate_document(&conn, &source_id, &states).unwrap();

        let copy = get_document(&conn, &copy_id).unwrap().unwrap();
        assert_eq!(copy.title, "Novel — Copy");
        assert_eq!(copy.word_count, 42);
        assert_eq!(copy.preview_text, "Opening words");
        assert_eq!(copy.tags, "[\"fiction\"]");
        assert!(copy.persist_history);
        assert_eq!(
            copy.created_with_version,
            source_version.map(str::to_string)
        );
        assert_ne!(copy.id, source_id);

        let copied_tabs: Vec<String> = conn
            .prepare("SELECT id FROM tabs WHERE document_id = ?1 ORDER BY position")
            .unwrap()
            .query_map(params![copy_id], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>>>()
            .unwrap();
        let copied_drafts: Vec<(String, Option<String>)> = conn
            .prepare(
                "SELECT id, parent_draft_id FROM drafts
                 WHERE document_id = ?1 ORDER BY created_at, rowid",
            )
            .unwrap()
            .query_map(params![copy_id], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>>>()
            .unwrap();
        assert_eq!(copied_tabs.len(), 2);
        assert!(copied_tabs
            .iter()
            .all(|id| id != &tab_a.id && id != &tab_b.id));
        assert_eq!(copied_tabs.len(), 2);
        assert_eq!(
            get_college_tab_setup(&conn, &copy_id, &copied_tabs[0]).unwrap(),
            Some(setup_a.to_string())
        );
        assert_eq!(
            get_college_tab_setup(&conn, &copy_id, &copied_tabs[1]).unwrap(),
            Some(setup_b.to_string())
        );
        set_college_tab_setup(
            &conn,
            &copy_id,
            &copied_tabs[0],
            Some(r#"{"version":1,"prompts":["Copied only"]}"#),
        )
        .unwrap();
        assert_eq!(
            get_college_tab_setup(&conn, &source_id, &tab_a.id).unwrap(),
            Some(setup_a.to_string())
        );
        assert_eq!(copied_drafts.len(), 3);
        assert!(copied_drafts
            .iter()
            .all(|(id, _)| id != &root_a && id != &child));
        let copied_ids: std::collections::HashSet<_> =
            copied_drafts.iter().map(|(id, _)| id).collect();
        assert!(copied_drafts
            .iter()
            .filter_map(|(_, parent)| parent.as_ref())
            .all(|parent| copied_ids.contains(parent)));

        let event_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM events e JOIN drafts d ON d.id = e.draft_id
                 WHERE d.document_id = ?1",
                params![copy_id],
                |row| row.get(0),
            )
            .unwrap();
        let doc_event_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM doc_events WHERE document_id = ?1",
                params![copy_id],
                |row| row.get(0),
            )
            .unwrap();
        let snapshot_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM snapshots s JOIN drafts d ON d.id = s.draft_id
                 WHERE d.document_id = ?1",
                params![copy_id],
                |row| row.get(0),
            )
            .unwrap();
        let copied_writer_brief: String = conn
            .query_row(
                "SELECT writer_brief FROM document_ai_profiles WHERE document_id = ?1",
                params![copy_id],
                |row| row.get(0),
            )
            .unwrap();
        let conversation_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM ai_conversations c
                 JOIN drafts d ON d.id = c.draft_id WHERE d.document_id = ?1",
                params![copy_id],
                |row| row.get(0),
            )
            .unwrap();
        let copied_decisions: String = conn
            .query_row(
                "SELECT decisions_json FROM document_editorial_decisions WHERE document_id = ?1",
                params![copy_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(event_count, 0);
        assert_eq!(doc_event_count, 0);
        assert_eq!(snapshot_count, 3);
        assert_eq!(copied_writer_brief, "Keep the close third-person voice.");
        assert_eq!(copied_decisions, r#"["Keep the unresolved ending."]"#);
        assert_eq!(conversation_count, 0);
    }

    #[test]
    fn failed_duplicate_leaves_no_document() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_db(&dir.path().join("test.db")).unwrap();
        let source_id = create_document(&conn, "Source", None).unwrap();
        create_draft(&conn, &source_id, "main").unwrap();
        let before: i64 = conn
            .query_row("SELECT COUNT(*) FROM documents", [], |row| row.get(0))
            .unwrap();

        assert!(duplicate_document(&conn, &source_id, &[]).is_err());

        let after: i64 = conn
            .query_row("SELECT COUNT(*) FROM documents", [], |row| row.get(0))
            .unwrap();
        assert_eq!(after, before);
    }

    #[test]
    fn duplicate_document_preserves_unknown_creator_version() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_db(&dir.path().join("test.db")).unwrap();
        let source_id = create_document(&conn, "Unknown source", None).unwrap();
        let source_draft_id = create_draft(&conn, &source_id, "main").unwrap();
        let copy_id = duplicate_document(
            &conn,
            &source_id,
            &[DuplicateDraftState {
                source_draft_id,
                source_event_id: -1,
                state_json: r#"{"doc":""}"#.into(),
            }],
        )
        .unwrap();

        assert_eq!(
            get_document(&conn, &copy_id)
                .unwrap()
                .unwrap()
                .created_with_version,
            None
        );
    }
}
