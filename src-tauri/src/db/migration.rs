use rusqlite::{params, Connection, Result};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use super::MigrationResult;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

pub fn migrate_from_state_json(
    conn: &Connection,
    state_json_path: &Path,
) -> Result<MigrationResult> {
    // Check idempotency guard
    let already_migrated: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM _meta WHERE key = 'migrated_from_state_json'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)
        .unwrap_or(false);

    if already_migrated {
        return Ok(MigrationResult {
            migrated: false,
            document_id: None,
        });
    }

    // Attempt to read legacy state.json
    let raw = match std::fs::read_to_string(state_json_path) {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // No legacy file — just mark as migrated
            set_migrated(conn)?;
            return Ok(MigrationResult {
                migrated: false,
                document_id: None,
            });
        }
        Err(e) => {
            eprintln!("[migration] I/O error reading state.json: {e}");
            set_migrated(conn)?;
            return Ok(MigrationResult {
                migrated: false,
                document_id: None,
            });
        }
    };

    // Parse JSON
    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[migration] Malformed state.json, skipping content migration: {e}");
            set_migrated(conn)?;
            return Ok(MigrationResult {
                migrated: false,
                document_id: None,
            });
        }
    };

    // Extract metadata from the CM6 JSON blob
    let (title, word_count, preview_text) = extract_doc_meta(&parsed);

    let doc_id = Uuid::new_v4().to_string();
    let draft_id = Uuid::new_v4().to_string();
    let now = now_ms();

    // Perform migration in a single transaction
    let result = (|| -> Result<()> {
        conn.execute(
            "INSERT INTO documents (id, title, created_at, updated_at, word_count, preview_text, tags)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, '[]')",
            params![doc_id, title, now, now, word_count, preview_text],
        )?;

        conn.execute(
            "INSERT INTO drafts (id, document_id, label, created_at, is_active)
             VALUES (?1, ?2, 'Draft', ?3, 1)",
            params![draft_id, doc_id, now],
        )?;

        // Seed snapshot with up_to_event_seq = -1
        conn.execute(
            "INSERT INTO snapshots (draft_id, up_to_event_seq, state_json, created_at)
             VALUES (?1, -1, ?2, ?3)",
            params![draft_id, raw, now],
        )?;

        let active_draft_key = format!("active_draft:{}", doc_id);
        conn.execute(
            "INSERT OR REPLACE INTO _meta (key, value) VALUES (?1, ?2)",
            params![active_draft_key, draft_id],
        )?;

        conn.execute(
            "INSERT OR REPLACE INTO _meta (key, value) VALUES ('migrated_from_state_json', '1')",
            [],
        )?;

        Ok(())
    })();

    match result {
        Ok(()) => Ok(MigrationResult {
            migrated: true,
            document_id: Some(doc_id),
        }),
        Err(e) => {
            eprintln!("[migration] SQL error during migration: {e}");
            // Prevent retry loop even on SQL error
            let _ = set_migrated(conn);
            Ok(MigrationResult {
                migrated: false,
                document_id: None,
            })
        }
    }
}

fn set_migrated(conn: &Connection) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO _meta (key, value) VALUES ('migrated_from_state_json', '1')",
        [],
    )?;
    Ok(())
}

/// Extracts title, word count, and preview from a CM6 EditorState JSON blob.
fn extract_doc_meta(v: &serde_json::Value) -> (String, i64, String) {
    let doc_text = extract_doc_text(v);
    let title = doc_text
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .chars()
        .take(80)
        .collect::<String>();
    let title = if title.is_empty() {
        "Untitled".to_string()
    } else {
        title
    };
    let word_count = doc_text
        .split_whitespace()
        .filter(|s| !s.is_empty())
        .count() as i64;
    let preview_text = doc_text.chars().take(200).collect::<String>();
    (title, word_count, preview_text)
}

/// CM6 serialises Text as either a plain string or a map {"0":"line",...}.
fn extract_doc_text(v: &serde_json::Value) -> String {
    // CM6 EditorState.toJSON() stores the document at .doc
    if let Some(doc) = v.get("doc") {
        if let Some(s) = doc.as_str() {
            return s.to_string();
        }
        if let Some(obj) = doc.as_object() {
            let mut lines: Vec<(usize, &str)> = obj
                .iter()
                .filter_map(|(k, v)| {
                    let idx = k.parse::<usize>().ok()?;
                    let text = v.as_str()?;
                    Some((idx, text))
                })
                .collect();
            lines.sort_by_key(|(i, _)| *i);
            return lines
                .iter()
                .map(|(_, s)| *s)
                .collect::<Vec<_>>()
                .join("\n");
        }
    }
    String::new()
}
