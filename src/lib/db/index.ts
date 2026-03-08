/**
 * db/index.ts — SQLite database singleton and CRUD operations.
 *
 * Uses tauri-plugin-sql for SQLite access. Initialises the schema
 * on first load and migrates the legacy state.json if present.
 */
import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import type { DocumentRecord, DocumentMeta, RawDocumentRow } from "./types";

const DB_PATH = "sqlite:quillium.db";

let _db: Database | null = null;

async function getDb(): Promise<Database> {
    if (!_db) {
        _db = await Database.load(DB_PATH);
    }
    return _db;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL DEFAULT 'Untitled',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    word_count   INTEGER NOT NULL DEFAULT 0,
    preview_text TEXT NOT NULL DEFAULT '',
    tags         TEXT NOT NULL DEFAULT '[]',
    state_json   TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_documents_updated_at ON documents(updated_at DESC);
`;

function rowToRecord(row: RawDocumentRow): DocumentRecord {
    return {
        id: row.id,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        wordCount: row.word_count,
        previewText: row.preview_text,
        tags: JSON.parse(row.tags ?? "[]"),
        stateJson: row.state_json,
    };
}

/**
 * Initialises the database schema and runs a one-time migration
 * from the legacy state.json file if this is the first launch.
 */
export async function initDb(): Promise<void> {
    const db = await getDb();

    // Run schema statements one at a time (plugin doesn't support multi-statement)
    const statements = SCHEMA.split(";")
        .map((s) => s.trim())
        .filter(Boolean);
    for (const stmt of statements) {
        await db.execute(stmt);
    }

    // Check if migration has already run
    const metaRows = await db.select<{ value: string }[]>(
        "SELECT value FROM _meta WHERE key = 'migrated_from_state_json'",
    );
    if (metaRows.length > 0) return;

    // Attempt to migrate legacy state.json
    const stateJson = await invoke<string | null>("migrate_from_state_json");
    if (stateJson) {
        const now = Date.now();
        const id = crypto.randomUUID();
        await db.execute(
            `INSERT INTO documents (id, title, created_at, updated_at, word_count, preview_text, tags, state_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, "Untitled", now, now, 0, "", "[]", stateJson],
        );
    }

    await db.execute(
        "INSERT OR REPLACE INTO _meta (key, value) VALUES ('migrated_from_state_json', '1')",
    );
}

export async function listDocuments(): Promise<DocumentMeta[]> {
    const db = await getDb();
    const rows = await db.select<RawDocumentRow[]>(
        "SELECT id, title, created_at, updated_at, word_count, preview_text, tags FROM documents ORDER BY updated_at DESC",
    );
    return rows.map((row) => ({
        id: row.id,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        wordCount: row.word_count,
        previewText: row.preview_text,
        tags: JSON.parse(row.tags ?? "[]"),
    }));
}

export async function getDocument(id: string): Promise<DocumentRecord | null> {
    const db = await getDb();
    const rows = await db.select<RawDocumentRow[]>(
        "SELECT * FROM documents WHERE id = ?",
        [id],
    );
    if (rows.length === 0) return null;
    return rowToRecord(rows[0]);
}

export async function createDocument(title = "Untitled"): Promise<string> {
    const db = await getDb();
    const id = crypto.randomUUID();
    const now = Date.now();
    await db.execute(
        `INSERT INTO documents (id, title, created_at, updated_at, word_count, preview_text, tags, state_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, title, now, now, 0, "", "[]", "{}"],
    );
    return id;
}

export async function updateDocument(
    id: string,
    stateJson: string,
    title: string,
    wordCount: number,
    previewText: string,
    tags: string[],
): Promise<void> {
    const db = await getDb();
    await db.execute(
        `UPDATE documents
         SET state_json = ?, title = ?, updated_at = ?, word_count = ?, preview_text = ?, tags = ?
         WHERE id = ?`,
        [stateJson, title, Date.now(), wordCount, previewText, JSON.stringify(tags), id],
    );
}

export async function deleteDocument(id: string): Promise<void> {
    const db = await getDb();
    await db.execute("DELETE FROM documents WHERE id = ?", [id]);
}
