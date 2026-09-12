//! mcp.rs — Read-only local MCP server for writer-owned Quillium documents.
//!
//! The desktop executable enters this mode when launched with `--mcp`. It uses
//! newline-delimited JSON-RPC over stdio so local AI clients can start it as an
//! MCP process. The first version is deliberately read-only: external clients
//! can discover and read documents, but all edits remain inside Quillium's
//! CodeMirror transaction and persistence path.

use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};

const SERVER_NAME: &str = "quillium";
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

fn success(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn error(id: &Value, code: i64, message: impl Into<String>) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message.into() }
    })
}

fn text_result(value: Value) -> Value {
    json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string())
        }]
    })
}

fn list_documents(conn: &Connection) -> rusqlite::Result<Value> {
    let mut statement = conn.prepare(
        "SELECT id, title, updated_at, word_count, preview_text, tags
         FROM documents
         WHERE deleted_at IS NULL
         ORDER BY updated_at DESC",
    )?;
    let documents = statement
        .query_map([], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "title": row.get::<_, String>(1)?,
                "updatedAt": row.get::<_, i64>(2)?,
                "wordCount": row.get::<_, i64>(3)?,
                "preview": row.get::<_, String>(4)?,
                "tags": serde_json::from_str::<Value>(&row.get::<_, String>(5)?)
                    .unwrap_or_else(|_| json!([])),
            }))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(json!({ "documents": documents }))
}

fn read_document(conn: &Connection, document_id: &str) -> rusqlite::Result<Option<Value>> {
    conn.query_row(
        "SELECT id, title, updated_at, word_count, body_text, tags
         FROM documents
         WHERE id = ?1 AND deleted_at IS NULL",
        params![document_id],
        |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "title": row.get::<_, String>(1)?,
                "updatedAt": row.get::<_, i64>(2)?,
                "wordCount": row.get::<_, i64>(3)?,
                "text": row.get::<_, String>(4)?,
                "tags": serde_json::from_str::<Value>(&row.get::<_, String>(5)?)
                    .unwrap_or_else(|_| json!([])),
            }))
        },
    )
    .optional()
}

fn handle_request(conn: &Connection, request: &Value) -> Option<Value> {
    let id = request.get("id")?;
    let method = request.get("method").and_then(Value::as_str).unwrap_or("");
    let response = match method {
        "initialize" => success(
            id,
            json!({
                "protocolVersion": "2025-06-18",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": SERVER_NAME, "version": SERVER_VERSION },
                "instructions": "Quillium is the writer's source of truth. These tools provide read-only access to local documents."
            }),
        ),
        "ping" => success(id, json!({})),
        "tools/list" => success(
            id,
            json!({
                "tools": [
                    {
                        "name": "list_documents",
                        "description": "List the writer's non-trashed Quillium documents.",
                        "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
                    },
                    {
                        "name": "read_document",
                        "description": "Read the current plain text and metadata for one Quillium document.",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "documentId": { "type": "string", "description": "Stable document ID returned by list_documents." }
                            },
                            "required": ["documentId"],
                            "additionalProperties": false
                        }
                    }
                ]
            }),
        ),
        "tools/call" => {
            let params = request.get("params").unwrap_or(&Value::Null);
            match params.get("name").and_then(Value::as_str) {
                Some("list_documents") => match list_documents(conn) {
                    Ok(value) => success(id, text_result(value)),
                    Err(problem) => {
                        error(id, -32603, format!("Could not list documents: {problem}"))
                    }
                },
                Some("read_document") => {
                    let document_id = params
                        .get("arguments")
                        .and_then(|arguments| arguments.get("documentId"))
                        .and_then(Value::as_str);
                    match document_id {
                        None => error(id, -32602, "documentId is required"),
                        Some(document_id) => match read_document(conn, document_id) {
                            Ok(Some(value)) => success(id, text_result(value)),
                            Ok(None) => error(id, -32602, "Document not found"),
                            Err(problem) => {
                                error(id, -32603, format!("Could not read document: {problem}"))
                            }
                        },
                    }
                }
                Some(name) => error(id, -32602, format!("Unknown tool: {name}")),
                None => error(id, -32602, "Tool name is required"),
            }
        }
        _ => error(id, -32601, format!("Method not found: {method}")),
    };
    Some(response)
}

fn database_path(arguments: &[String]) -> Result<PathBuf, String> {
    let position = arguments
        .iter()
        .position(|argument| argument == "--data-dir")
        .ok_or_else(|| "Missing --data-dir argument".to_string())?;
    let directory = arguments
        .get(position + 1)
        .ok_or_else(|| "Missing value for --data-dir".to_string())?;
    Ok(Path::new(directory).join("quillium.db"))
}

pub fn run(arguments: &[String]) -> Result<(), String> {
    let path = database_path(arguments)?;
    let conn = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|problem| format!("Could not open {}: {problem}", path.display()))?;

    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line.map_err(|problem| problem.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        let request: Value = match serde_json::from_str(&line) {
            Ok(request) => request,
            Err(problem) => {
                let response = error(&Value::Null, -32700, format!("Parse error: {problem}"));
                writeln!(stdout, "{response}").map_err(|write_error| write_error.to_string())?;
                stdout.flush().map_err(|problem| problem.to_string())?;
                continue;
            }
        };
        if let Some(response) = handle_request(&conn, &request) {
            writeln!(stdout, "{response}").map_err(|problem| problem.to_string())?;
            stdout.flush().map_err(|problem| problem.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE documents (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                word_count INTEGER NOT NULL,
                preview_text TEXT NOT NULL,
                tags TEXT NOT NULL,
                body_text TEXT NOT NULL,
                deleted_at INTEGER
            );
            INSERT INTO documents VALUES
                ('live', 'A draft', 42, 3, 'Once upon', '[\"novel\"]', 'Once upon a time', NULL),
                ('trash', 'Gone', 41, 1, 'Gone', '[]', 'Gone', 40);",
        )
        .unwrap();
        conn
    }

    #[test]
    fn exposes_only_live_documents_and_current_text() {
        let conn = connection();
        let listed = list_documents(&conn).unwrap();
        assert_eq!(listed["documents"].as_array().unwrap().len(), 1);
        assert_eq!(listed["documents"][0]["id"], "live");

        let document = read_document(&conn, "live").unwrap().unwrap();
        assert_eq!(document["text"], "Once upon a time");
        assert!(read_document(&conn, "trash").unwrap().is_none());
    }

    #[test]
    fn advertises_read_only_tools() {
        let conn = connection();
        let response = handle_request(
            &conn,
            &json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }),
        )
        .unwrap();
        let tools = response["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0]["name"], "list_documents");
        assert_eq!(tools[1]["name"], "read_document");
    }
}
