//! search.rs — Hybrid document search: FTS5 keyword retrieval fused with
//! semantic (embedding) retrieval via Reciprocal Rank Fusion.
//!
//! Keyword side: `documents_fts` (external-content FTS5 over title/body/tags,
//! see migrations.rs) ranked by bm25 with the title weighted above the body.
//! Semantic side: KNN over `vec_chunks` (sqlite-vec), chunk hits aggregated
//! to their parent document ("parent-document retrieval" — the best chunk
//! becomes the snippet). The two ranked lists are fused with RRF (k=60) so
//! bm25 scores and cosine distances never need to share a scale.
//!
//! The caller supplies the query embedding (src/embeddings.rs owns the
//! model); pass `None` to get keyword-only results — that's the mobile and
//! model-still-downloading fallback.

use rusqlite::{params, Connection, Result};
use serde::Serialize;
use std::collections::HashMap;

use super::{documents::get_document, DocumentMeta};

/// Private-use sentinel characters wrapping keyword matches inside snippets.
/// The frontend splits on these and renders <mark> — they can't collide with
/// document text the way visible marker strings could.
pub const HIGHLIGHT_START: char = '\u{E000}';
pub const HIGHLIGHT_END: char = '\u{E001}';

const RRF_K: f64 = 60.0;
const FTS_LIMIT: i64 = 20;
/// Chunk-level KNN limit; after doc aggregation this yields ~top-20 docs.
const KNN_CHUNK_LIMIT: i64 = 40;
/// Cosine-distance cutoff for semantic hits. bge-small relevant matches land
/// around 0.2–0.35; unrelated text rarely dips below ~0.5. Without a cutoff,
/// KNN always returns *something*, flooding short queries with noise.
const MAX_SEMANTIC_DISTANCE: f64 = 0.45;
const RESULT_LIMIT: usize = 30;
const SNIPPET_MAX_CHARS: usize = 180;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    #[serde(flatten)]
    pub meta: DocumentMeta,
    /// Matched context. Keyword hits wrap matches in HIGHLIGHT_START/END;
    /// semantic-only hits return the best-matching chunk, unmarked.
    pub snippet: String,
    /// "keyword" | "semantic" | "both"
    pub match_type: String,
    /// RRF score — only meaningful relative to other hits in this response.
    pub score: f64,
}

/// Builds a valid FTS5 MATCH expression from raw user input: every term is
/// quoted (so `-`, `OR`, etc. can't break syntax or invert the query) and the
/// last term gets a `*` so the final word matches as a prefix while typing.
pub fn build_match_query(raw: &str) -> Option<String> {
    let terms: Vec<&str> = raw.split_whitespace().collect();
    let last = terms.len().checked_sub(1)?;
    let parts: Vec<String> = terms
        .iter()
        .enumerate()
        .map(|(i, term)| {
            let escaped = term.replace('"', "\"\"");
            if i == last {
                format!("\"{escaped}\"*")
            } else {
                format!("\"{escaped}\"")
            }
        })
        .collect();
    Some(parts.join(" "))
}

/// FTS5 keyword search. Returns (meta, snippet) in bm25 rank order.
/// Trashed documents are filtered in the join — external-content FTS5 can't
/// index a WHERE clause.
fn fts_search(conn: &Connection, match_query: &str) -> Result<Vec<(DocumentMeta, String)>> {
    let mut stmt = conn.prepare(
        "SELECT d.id, d.title, d.created_at, d.updated_at, d.word_count,
                d.preview_text, d.tags, d.deleted_at,
                snippet(documents_fts, 1, '\u{E000}', '\u{E001}', '…', 12)
         FROM documents_fts
         JOIN documents d ON d.rowid = documents_fts.rowid
         WHERE documents_fts MATCH ?1 AND d.deleted_at IS NULL
         ORDER BY bm25(documents_fts, 5.0, 1.0, 2.0)
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![match_query, FTS_LIMIT], |row| {
        Ok((
            DocumentMeta {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                word_count: row.get(4)?,
                preview_text: row.get(5)?,
                tags: row.get(6)?,
                deleted_at: row.get(7)?,
            },
            row.get(8)?,
        ))
    })?;
    rows.collect()
}

/// Serializes an f32 embedding into the little-endian blob sqlite-vec expects.
pub fn embedding_to_bytes(embedding: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(embedding.len() * 4);
    for value in embedding {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

/// KNN over chunk vectors, aggregated to documents: returns
/// (doc_id, best_chunk_text, best_distance) in best-first order, one entry
/// per document, hits beyond MAX_SEMANTIC_DISTANCE dropped.
fn semantic_doc_hits(
    conn: &Connection,
    query_embedding: &[f32],
) -> Result<Vec<(String, String, f64)>> {
    let mut stmt = conn.prepare(
        "SELECT c.document_id, c.text, v.distance
         FROM vec_chunks v
         JOIN chunks c ON c.id = v.rowid
         JOIN documents d ON d.id = c.document_id
         WHERE v.embedding MATCH ?1 AND k = ?2 AND d.deleted_at IS NULL
         ORDER BY v.distance",
    )?;
    let rows = stmt.query_map(
        params![embedding_to_bytes(query_embedding), KNN_CHUNK_LIMIT],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, f64>(2)?,
            ))
        },
    )?;

    let mut hits: Vec<(String, String, f64)> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for row in rows {
        let (doc_id, text, distance) = row?;
        if distance > MAX_SEMANTIC_DISTANCE {
            break; // rows are distance-ordered
        }
        if seen.insert(doc_id.clone()) {
            hits.push((doc_id, text, distance));
        }
    }
    Ok(hits)
}

fn truncate_chars(text: &str, max: usize) -> String {
    let trimmed = text.trim().replace('\n', " ");
    if trimmed.chars().count() <= max {
        return trimmed;
    }
    let mut out: String = trimmed.chars().take(max).collect();
    out.push('…');
    out
}

struct FusionEntry {
    score: f64,
    keyword: Option<(DocumentMeta, String)>,
    semantic: Option<(String, f64)>,
}

/// Hybrid search entry point. `query_embedding = None` → keyword-only.
pub fn search_documents(
    conn: &Connection,
    raw_query: &str,
    query_embedding: Option<&[f32]>,
) -> Result<Vec<SearchHit>> {
    let keyword_hits = match build_match_query(raw_query) {
        Some(match_query) => fts_search(conn, &match_query)?,
        None => Vec::new(),
    };
    let semantic_hits = match query_embedding {
        Some(embedding) => semantic_doc_hits(conn, embedding)?,
        None => Vec::new(),
    };

    // RRF: score(d) = Σ over retrievers of 1 / (k + rank). Fusing on rank
    // position sidesteps reconciling bm25 scores with cosine distances.
    let mut fused: HashMap<String, FusionEntry> = HashMap::new();
    for (rank, (meta, snippet)) in keyword_hits.into_iter().enumerate() {
        let entry = fused.entry(meta.id.clone()).or_insert(FusionEntry {
            score: 0.0,
            keyword: None,
            semantic: None,
        });
        entry.score += 1.0 / (RRF_K + rank as f64 + 1.0);
        entry.keyword = Some((meta, snippet));
    }
    for (rank, (doc_id, chunk_text, distance)) in semantic_hits.into_iter().enumerate() {
        let entry = fused.entry(doc_id).or_insert(FusionEntry {
            score: 0.0,
            keyword: None,
            semantic: None,
        });
        entry.score += 1.0 / (RRF_K + rank as f64 + 1.0);
        entry.semantic = Some((chunk_text, distance));
    }

    let mut hits: Vec<SearchHit> = Vec::new();
    for (doc_id, entry) in fused {
        let (match_type, meta, snippet) = match (entry.keyword, entry.semantic) {
            (Some((meta, snippet)), Some((chunk_text, _))) => {
                // Prefer the keyword snippet when it actually highlights
                // something; a markerless snippet means the match was in the
                // title/tags, and the semantic chunk is more informative.
                let snippet = if snippet.contains(HIGHLIGHT_START) {
                    snippet
                } else {
                    truncate_chars(&chunk_text, SNIPPET_MAX_CHARS)
                };
                ("both", meta, snippet)
            }
            (Some((meta, snippet)), None) => ("keyword", meta, snippet),
            (None, Some((chunk_text, _))) => {
                // Semantic-only hits weren't in the FTS result set, so fetch
                // their metadata now (a handful of point lookups at most).
                let Some(meta) = get_document(conn, &doc_id)? else {
                    continue;
                };
                (
                    "semantic",
                    meta,
                    truncate_chars(&chunk_text, SNIPPET_MAX_CHARS),
                )
            }
            (None, None) => continue,
        };
        hits.push(SearchHit {
            meta,
            snippet,
            match_type: match_type.to_string(),
            score: entry.score,
        });
    }

    hits.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.meta.title.cmp(&b.meta.title))
    });
    hits.truncate(RESULT_LIMIT);
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::documents::{create_document, trash_document, update_document_meta};
    use crate::db::schema::open_db;

    fn test_db() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_db(&dir.path().join("test.db")).unwrap();
        (dir, conn)
    }

    #[test]
    fn match_query_quotes_terms_and_prefixes_last() {
        assert_eq!(build_match_query("hello world"), Some("\"hello\" \"world\"*".into()));
        assert_eq!(build_match_query("  "), None);
        // FTS5 operators and quotes are neutralized.
        assert_eq!(build_match_query("NOT a\"b"), Some("\"NOT\" \"a\"\"b\"*".into()));
    }

    #[test]
    fn finds_phrase_buried_in_body_beyond_preview() {
        let (_dir, conn) = test_db();
        let id = create_document(&conn, "My Essay").unwrap();
        let body = format!(
            "{}{}",
            "padding ".repeat(50), // pushes the phrase past the 200-char preview
            "the silver heron waited by the estuary"
        );
        update_document_meta(&conn, &id, "My Essay", 100, &body[..200], "[]", Some(&body)).unwrap();

        let hits = search_documents(&conn, "silver heron", None).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].meta.id, id);
        assert_eq!(hits[0].match_type, "keyword");
        assert!(hits[0].snippet.contains(HIGHLIGHT_START));
        assert!(hits[0].snippet.contains("heron"));
    }

    #[test]
    fn last_term_matches_as_prefix() {
        let (_dir, conn) = test_db();
        let id = create_document(&conn, "Doc").unwrap();
        update_document_meta(&conn, &id, "Doc", 3, "", "[]", Some("an extraordinary revelation"))
            .unwrap();
        let hits = search_documents(&conn, "extraord", None).unwrap();
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn trashed_documents_are_excluded() {
        let (_dir, conn) = test_db();
        let id = create_document(&conn, "Doomed").unwrap();
        update_document_meta(&conn, &id, "Doomed", 2, "", "[]", Some("unique zanzibar text"))
            .unwrap();
        assert_eq!(search_documents(&conn, "zanzibar", None).unwrap().len(), 1);
        trash_document(&conn, &id).unwrap();
        assert_eq!(search_documents(&conn, "zanzibar", None).unwrap().len(), 0);
    }

    #[test]
    fn meta_update_without_body_preserves_index() {
        let (_dir, conn) = test_db();
        let id = create_document(&conn, "Doc").unwrap();
        update_document_meta(&conn, &id, "Doc", 2, "", "[]", Some("persistent kraken sighting"))
            .unwrap();
        // Rename-style update (no body) must not wipe body_text from FTS.
        update_document_meta(&conn, &id, "Renamed", 2, "", "[]", None).unwrap();
        let hits = search_documents(&conn, "kraken", None).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].meta.title, "Renamed");
    }

    #[test]
    fn vec_knn_roundtrip_and_fusion() {
        let (_dir, conn) = test_db();
        let id_a = create_document(&conn, "Doc A").unwrap();
        let id_b = create_document(&conn, "Doc B").unwrap();
        update_document_meta(&conn, &id_a, "Doc A", 2, "", "[]", Some("about grief")).unwrap();
        update_document_meta(&conn, &id_b, "Doc B", 2, "", "[]", Some("about carpentry")).unwrap();

        // Hand-rolled near-orthogonal unit vectors (dim 384).
        let mut vec_a = vec![0.0f32; 384];
        vec_a[0] = 1.0;
        let mut vec_b = vec![0.0f32; 384];
        vec_b[1] = 1.0;
        for (doc_id, chunk_text, emb) in
            [(&id_a, "about grief", &vec_a), (&id_b, "about carpentry", &vec_b)]
        {
            conn.execute(
                "INSERT INTO chunks (document_id, chunk_index, content_hash, text)
                 VALUES (?1, 0, 'h', ?2)",
                params![doc_id, chunk_text],
            )
            .unwrap();
            let chunk_id = conn.last_insert_rowid();
            conn.execute(
                "INSERT INTO vec_chunks (rowid, embedding) VALUES (?1, ?2)",
                params![chunk_id, embedding_to_bytes(emb)],
            )
            .unwrap();
        }

        // Query vector close to A: semantic-only hit (no keyword overlap).
        let mut query = vec![0.0f32; 384];
        query[0] = 0.95;
        query[1] = 0.05;
        let hits = search_documents(&conn, "losing a parent", Some(&query)).unwrap();
        assert_eq!(hits.len(), 1, "only A is within the distance cutoff");
        assert_eq!(hits[0].meta.id, id_a);
        assert_eq!(hits[0].match_type, "semantic");
        assert_eq!(hits[0].snippet, "about grief");

        // Keyword + semantic agreement → "both".
        let hits = search_documents(&conn, "grief", Some(&query)).unwrap();
        assert_eq!(hits[0].meta.id, id_a);
        assert_eq!(hits[0].match_type, "both");

        // Trashing A removes it from semantic results too.
        trash_document(&conn, &id_a).unwrap();
        let hits = search_documents(&conn, "losing a parent", Some(&query)).unwrap();
        assert!(hits.is_empty());
    }
}
