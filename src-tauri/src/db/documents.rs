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
        "SELECT id, title, created_at, updated_at, word_count, preview_text, tags
         FROM documents ORDER BY updated_at DESC",
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
        })
    })?;
    rows.collect()
}

pub fn get_document(conn: &Connection, id: &str) -> Result<Option<DocumentMeta>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, created_at, updated_at, word_count, preview_text, tags
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

pub fn delete_document(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM documents WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn list_drafts(conn: &Connection, doc_id: &str) -> Result<Vec<DraftMeta>> {
    let mut stmt = conn.prepare(
        "SELECT id, document_id, label, created_at, is_active FROM drafts
         WHERE document_id = ?1 ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map(params![doc_id], |row| {
        Ok(DraftMeta {
            id: row.get(0)?,
            document_id: row.get(1)?,
            label: row.get(2)?,
            created_at: row.get(3)?,
            is_active: row.get::<_, i64>(4)? != 0,
        })
    })?;
    rows.collect()
}

pub fn create_draft(conn: &Connection, doc_id: &str, label: &str) -> Result<String> {
    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    conn.execute(
        "INSERT INTO drafts (id, document_id, label, created_at, is_active)
         VALUES (?1, ?2, ?3, ?4, 1)",
        params![id, doc_id, label, now],
    )?;
    Ok(id)
}
