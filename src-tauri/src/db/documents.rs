use rusqlite::{params, Connection, Result};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use super::{DocumentMeta, DraftMeta};

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

pub fn list_documents(conn: &Connection) -> Result<Vec<DocumentMeta>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, created_at, updated_at, word_count, preview_text, tags, deleted_at
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
        })
    })?;
    rows.collect()
}

pub fn list_trashed_documents(conn: &Connection) -> Result<Vec<DocumentMeta>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, created_at, updated_at, word_count, preview_text, tags, deleted_at
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
        })
    })?;
    rows.collect()
}

pub fn get_document(conn: &Connection, id: &str) -> Result<Option<DocumentMeta>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, created_at, updated_at, word_count, preview_text, tags, deleted_at
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
        })
    })?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub fn create_document(conn: &Connection, title: &str) -> Result<String> {
    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    conn.execute(
        "INSERT INTO documents (id, title, created_at, updated_at, word_count, preview_text, tags)
         VALUES (?1, ?2, ?3, ?4, 0, '', '[]')",
        params![id, title, now, now],
    )?;
    Ok(id)
}

pub fn update_document_meta(
    conn: &Connection,
    id: &str,
    title: &str,
    word_count: i64,
    preview_text: &str,
    tags: &str,
) -> Result<()> {
    let now = now_ms();
    conn.execute(
        "UPDATE documents SET title = ?1, updated_at = ?2, word_count = ?3,
         preview_text = ?4, tags = ?5 WHERE id = ?6",
        params![title, now, word_count, preview_text, tags, id],
    )?;
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

/// Permanently deletes trashed documents older than `days` days.
pub fn purge_expired_trash(conn: &Connection, days: i64) -> Result<u64> {
    let cutoff = now_ms() - days * 24 * 60 * 60 * 1000;
    let count = conn.execute(
        "DELETE FROM documents WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
        params![cutoff],
    )?;
    Ok(count as u64)
}

pub fn list_drafts(conn: &Connection, doc_id: &str) -> Result<Vec<DraftMeta>> {
    let mut stmt = conn.prepare(
        "SELECT id, document_id, label, created_at, is_active, tab_id, parent_draft_id, locked
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
            locked: row.get::<_, i64>(7)? != 0,
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
