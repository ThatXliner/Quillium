//! embeddings.rs — On-device semantic index for document search (#248 Phase 2).
//!
//! Owns the embedding model (fastembed → ONNX Runtime, bge-small-en-v1.5
//! quantized, 384-dim) and a background worker thread that keeps `chunks` +
//! `vec_chunks` in sync with document bodies. Everything runs locally; the
//! only network access is the one-time model download into the app data dir.
//!
//! **Opt-in.** The model is ~30 MB, so nothing is downloaded until the user
//! enables "Search by meaning" in Settings (persisted in `_meta`, read at
//! startup). The worker thread is spawned once and driven by control
//! messages: Enable loads the model (downloading if needed) and reconciles
//! every document; Disable drops the model from memory and idles. Index
//! data (chunks + vectors) is kept across disable so re-enabling is cheap.
//!
//! Indexing is incremental: documents are split into paragraph/sentence-aware
//! chunks, each chunk is content-hashed (FNV-1a), and only chunks whose hash
//! changed get re-embedded. The worker debounces index requests (~3 s after
//! the last edit); the reconcile pass on enable doubles as the backfill for
//! documents that predate this feature (or were edited while disabled).
//!
//! Desktop-only: ort has no prebuilt iOS/Android binaries, so on mobile the
//! index reports "unavailable" and search stays keyword-only (FTS5).

use std::sync::{Arc, Mutex};

#[cfg(desktop)]
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
    sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender},
    time::{Duration, Instant},
};

/// Must match the `float[384]` declaration of vec_chunks in migrations.rs.
pub const EMBEDDING_DIM: usize = 384;

#[cfg(desktop)]
const DEBOUNCE: Duration = Duration::from_secs(3);
#[cfg(desktop)]
const EMBED_BATCH: usize = 16;
/// bge models want this prefix on the *query* side only (not on passages).
#[cfg(desktop)]
const BGE_QUERY_PREFIX: &str = "Represent this sentence for searching relevant passages: ";

#[cfg(desktop)]
enum Job {
    Index(String),
    Enable,
    Disable,
}

pub struct SemanticIndex {
    /// "disabled" | "starting" | "loading-model" | "indexing" | "ready"
    /// | "unavailable" | "error: …"
    status: Mutex<String>,
    #[cfg(desktop)]
    enabled: AtomicBool,
    #[cfg(desktop)]
    queue: Mutex<Option<Sender<Job>>>,
    #[cfg(desktop)]
    model: Mutex<Option<fastembed::TextEmbedding>>,
}

impl SemanticIndex {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            status: Mutex::new("disabled".to_string()),
            #[cfg(desktop)]
            enabled: AtomicBool::new(false),
            #[cfg(desktop)]
            queue: Mutex::new(None),
            #[cfg(desktop)]
            model: Mutex::new(None),
        })
    }

    pub fn status(&self) -> String {
        self.status.lock().map(|s| s.clone()).unwrap_or_default()
    }

    fn set_status(&self, status: &str) {
        if let Ok(mut guard) = self.status.lock() {
            *guard = status.to_string();
        }
    }

    /// Queues a document for (re-)indexing. Cheap; safe to call on every
    /// save. No-op while semantic search is disabled — the enable-time
    /// reconcile catches up on anything edited in the meantime.
    #[allow(unused_variables)]
    pub fn request_index(&self, doc_id: &str) {
        #[cfg(desktop)]
        {
            if !self.enabled.load(Ordering::Relaxed) {
                return;
            }
            self.send(Job::Index(doc_id.to_string()));
        }
    }

    /// Turns the semantic index on/off at runtime (Settings toggle). The
    /// caller persists the flag; this only drives the worker.
    #[allow(unused_variables)]
    pub fn set_enabled(&self, enabled: bool) {
        #[cfg(desktop)]
        {
            self.enabled.store(enabled, Ordering::Relaxed);
            if enabled {
                self.set_status("starting");
                self.send(Job::Enable);
            } else {
                // Worker also sets this when it drops the model; do it here
                // too so the UI flips immediately.
                self.set_status("disabled");
                self.send(Job::Disable);
            }
        }
    }

    #[cfg(desktop)]
    fn send(&self, job: Job) {
        if let Ok(queue) = self.queue.lock() {
            if let Some(tx) = queue.as_ref() {
                let _ = tx.send(job);
            }
        }
    }

    /// Embeds a search query. Returns None unless the model is loaded
    /// (disabled / still downloading / mobile) — callers fall back to
    /// keyword-only search.
    #[allow(unused_variables)]
    pub fn embed_query(&self, query: &str) -> Option<Vec<f32>> {
        #[cfg(desktop)]
        {
            let mut guard = self.model.lock().ok()?;
            let model = guard.as_mut()?;
            let text = format!("{BGE_QUERY_PREFIX}{query}");
            return model.embed(vec![text], None).ok()?.into_iter().next();
        }
        #[cfg(not(desktop))]
        None
    }

    /// Spawns the (single, long-lived) worker thread. `db_path` is the SQLite
    /// file (the worker opens its own WAL connection); `model_cache_dir` is
    /// where fastembed downloads/caches the ONNX model. `initially_enabled`
    /// is the persisted user preference — when false, the worker idles and
    /// nothing is downloaded.
    #[cfg(not(desktop))]
    pub fn start(
        self: &Arc<Self>,
        _db_path: std::path::PathBuf,
        _model_cache_dir: std::path::PathBuf,
        _initially_enabled: bool,
    ) {
        self.set_status("unavailable");
    }

    #[cfg(desktop)]
    pub fn start(
        self: &Arc<Self>,
        db_path: PathBuf,
        model_cache_dir: PathBuf,
        initially_enabled: bool,
    ) {
        let (tx, rx) = channel::<Job>();
        if let Ok(mut queue) = self.queue.lock() {
            *queue = Some(tx);
        }
        self.enabled.store(initially_enabled, Ordering::Relaxed);
        if initially_enabled {
            self.set_status("starting");
            self.send(Job::Enable);
        }
        let this = Arc::clone(self);
        std::thread::Builder::new()
            .name("semantic-index".to_string())
            .spawn(move || this.run_worker(db_path, model_cache_dir, rx))
            .expect("failed to spawn semantic-index worker");
    }

    #[cfg(desktop)]
    fn run_worker(&self, db_path: PathBuf, model_cache_dir: PathBuf, rx: Receiver<Job>) {
        let conn = match crate::db::schema::open_db(&db_path) {
            Ok(conn) => conn,
            Err(e) => {
                eprintln!("[embeddings] worker db open failed: {e}");
                self.set_status(&format!("error: {e}"));
                return;
            }
        };

        // Debounced indexing loop, also handling enable/disable transitions.
        let mut pending: HashMap<String, Instant> = HashMap::new();
        loop {
            let now = Instant::now();
            let timeout = pending
                .values()
                .min()
                .map(|deadline| deadline.saturating_duration_since(now))
                .unwrap_or(Duration::from_secs(3600))
                .max(Duration::from_millis(25));
            match rx.recv_timeout(timeout) {
                Ok(Job::Enable) => self.bring_up(&conn, &model_cache_dir),
                Ok(Job::Disable) => {
                    // Free the model's memory; keep chunks/vectors on disk so
                    // re-enabling only embeds what changed since.
                    if let Ok(mut guard) = self.model.lock() {
                        *guard = None;
                    }
                    pending.clear();
                    self.set_status("disabled");
                }
                Ok(Job::Index(doc_id)) => {
                    pending.insert(doc_id, Instant::now() + DEBOUNCE);
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            let now = Instant::now();
            let due: Vec<String> = pending
                .iter()
                .filter(|(_, deadline)| **deadline <= now)
                .map(|(id, _)| id.clone())
                .collect();
            for doc_id in due {
                pending.remove(&doc_id);
                if let Err(e) = self.index_document(&conn, &doc_id) {
                    eprintln!("[embeddings] indexing failed for {doc_id}: {e}");
                }
            }
        }
    }

    /// Enable transition: load the model (first time downloads it), then
    /// reconcile every live document. Hash-diffing makes the reconcile a fast
    /// no-op when nothing changed; on first enable it backfills everything.
    #[cfg(desktop)]
    fn bring_up(&self, conn: &rusqlite::Connection, model_cache_dir: &PathBuf) {
        use fastembed::{EmbeddingModel, TextEmbedding, TextInitOptions};

        let model_missing = self.model.lock().map(|g| g.is_none()).unwrap_or(true);
        if model_missing {
            self.set_status("loading-model");
            match TextEmbedding::try_new(
                TextInitOptions::new(EmbeddingModel::BGESmallENV15Q)
                    .with_cache_dir(model_cache_dir.clone()),
            ) {
                Ok(model) => {
                    if let Ok(mut guard) = self.model.lock() {
                        *guard = Some(model);
                    }
                }
                Err(e) => {
                    // Most likely offline. The user can toggle the setting
                    // again (or relaunch) to retry; search stays keyword-only.
                    eprintln!("[embeddings] model load failed: {e}");
                    self.set_status(&format!("error: {e}"));
                    return;
                }
            }
        }

        self.set_status("indexing");
        let live_ids: Vec<String> = conn
            .prepare("SELECT id FROM documents WHERE deleted_at IS NULL")
            .and_then(|mut stmt| {
                stmt.query_map([], |row| row.get(0))
                    .map(|rows| rows.filter_map(|r| r.ok()).collect())
            })
            .unwrap_or_default();
        for doc_id in live_ids {
            if let Err(e) = self.index_document(&conn, &doc_id) {
                eprintln!("[embeddings] reconcile failed for {doc_id}: {e}");
            }
        }
        self.set_status("ready");
    }

    /// Re-chunks a document, hash-diffs against stored chunks, and embeds
    /// only what changed. A typo fix re-embeds one chunk, not the essay.
    #[cfg(desktop)]
    fn index_document(&self, conn: &rusqlite::Connection, doc_id: &str) -> Result<(), String> {
        use crate::db::search::embedding_to_bytes;
        use rusqlite::{params, OptionalExtension};

        let row: Option<(String, Option<i64>)> = conn
            .query_row(
                "SELECT body_text, deleted_at FROM documents WHERE id = ?1",
                params![doc_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let Some((body, deleted_at)) = row else {
            return Ok(()); // permanently deleted — vectors were cleaned up there
        };
        if deleted_at.is_some() {
            return Ok(()); // trashed — keep vectors, query-time filter hides them
        }

        let chunks = chunk_text(&body);
        let existing: Vec<(i64, String)> = conn
            .prepare(
                "SELECT id, content_hash FROM chunks
                 WHERE document_id = ?1 ORDER BY chunk_index",
            )
            .and_then(|mut stmt| {
                stmt.query_map(params![doc_id], |row| Ok((row.get(0)?, row.get(1)?)))
                    .map(|rows| rows.filter_map(|r| r.ok()).collect())
            })
            .map_err(|e| e.to_string())?;

        // Position-wise diff: chunk i is fresh iff its hash matches the
        // existing chunk at index i. Everything else is replaced.
        let mut to_embed: Vec<(usize, String, &str)> = Vec::new();
        let mut stale_ids: Vec<i64> = Vec::new();
        for (i, text) in chunks.iter().enumerate() {
            let hash = fnv1a(text);
            match existing.get(i) {
                Some((_, existing_hash)) if *existing_hash == hash => {}
                Some((id, _)) => {
                    stale_ids.push(*id);
                    to_embed.push((i, hash, text));
                }
                None => to_embed.push((i, hash, text)),
            }
        }
        for (id, _) in existing.iter().skip(chunks.len()) {
            stale_ids.push(*id);
        }
        if to_embed.is_empty() && stale_ids.is_empty() {
            return Ok(());
        }
        // Model gone (disabled mid-flight or load failed): skip quietly. The
        // next enable's reconcile re-runs this diff and catches up.
        if !to_embed.is_empty() && self.model.lock().map(|g| g.is_none()).unwrap_or(true) {
            return Ok(());
        }

        // Embed outside the write transaction; hold the model lock per batch
        // so a concurrent search query never waits behind a whole document.
        let mut embeddings: Vec<Vec<f32>> = Vec::with_capacity(to_embed.len());
        for batch in to_embed.chunks(EMBED_BATCH) {
            let texts: Vec<&str> = batch.iter().map(|(_, _, t)| *t).collect();
            let mut guard = self.model.lock().map_err(|e| e.to_string())?;
            let model = guard.as_mut().ok_or("model not loaded")?;
            embeddings.extend(model.embed(texts, None).map_err(|e| e.to_string())?);
        }
        // Pair-by-position below (zip) silently truncates on a mismatch,
        // which would store a chunk's text against the wrong vector. Reject
        // any count/dimension surprise from the model instead of committing
        // a corrupt index — the next reconcile retries from a clean state.
        if embeddings.len() != to_embed.len() {
            return Err(format!(
                "embedding count {} != chunk count {}",
                embeddings.len(),
                to_embed.len()
            ));
        }
        if let Some(bad) = embeddings.iter().find(|e| e.len() != EMBEDDING_DIM) {
            return Err(format!(
                "embedding dim {} != expected {EMBEDDING_DIM}",
                bad.len()
            ));
        }

        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        for id in &stale_ids {
            tx.execute("DELETE FROM vec_chunks WHERE rowid = ?1", params![id])
                .map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM chunks WHERE id = ?1", params![id])
                .map_err(|e| e.to_string())?;
        }
        for ((index, hash, text), embedding) in to_embed.iter().zip(&embeddings) {
            tx.execute(
                "INSERT INTO chunks (document_id, chunk_index, content_hash, text)
                 VALUES (?1, ?2, ?3, ?4)",
                params![doc_id, *index as i64, hash, text],
            )
            .map_err(|e| e.to_string())?;
            let chunk_id = tx.last_insert_rowid();
            tx.execute(
                "INSERT INTO vec_chunks (rowid, embedding) VALUES (?1, ?2)",
                params![chunk_id, embedding_to_bytes(embedding)],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    }
}

// ── Chunking ──────────────────────────────────────────────────────
// Paragraph/sentence-aware recursive splitting, ~300 tokens per chunk
// (approximated as chars; ~4 chars/token for English prose). Deliberately
// NOT embedding-based "semantic chunking" — recursive splitting matches it
// at a fraction of the cost at this scale.

const CHUNK_TARGET_CHARS: usize = 1200;
const CHUNK_MAX_CHARS: usize = 1600;
/// Units no longer than this get carried into the next chunk as overlap.
const OVERLAP_MAX_CHARS: usize = 300;

/// Splits text into chunks for embedding. Paragraphs are packed greedily up
/// to the target size; oversized paragraphs split at sentence boundaries
/// (never mid-sentence unless a single sentence exceeds the hard max). The
/// last unit of each chunk is repeated at the start of the next (~15-25%
/// overlap) so meaning that straddles a boundary isn't lost.
pub fn chunk_text(text: &str) -> Vec<String> {
    let mut units: Vec<String> = Vec::new();
    for paragraph in text.split("\n\n").map(str::trim).filter(|p| !p.is_empty()) {
        if paragraph.len() <= CHUNK_MAX_CHARS {
            units.push(paragraph.to_string());
        } else {
            units.extend(split_long_paragraph(paragraph));
        }
    }

    let mut chunks: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut last_unit: Option<&String> = None;
    for unit in &units {
        if !current.is_empty() && current.len() + unit.len() + 2 > CHUNK_TARGET_CHARS {
            chunks.push(std::mem::take(&mut current));
            if let Some(prev) = last_unit {
                if prev.len() <= OVERLAP_MAX_CHARS {
                    current.push_str(prev);
                }
            }
        }
        if !current.is_empty() {
            current.push_str("\n\n");
        }
        current.push_str(unit);
        last_unit = Some(unit);
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

/// Splits an oversized paragraph at sentence boundaries, packing sentences
/// up to the target size. A single sentence longer than the hard max is
/// split at char boundaries as a last resort.
fn split_long_paragraph(paragraph: &str) -> Vec<String> {
    let mut parts: Vec<String> = Vec::new();
    let mut current = String::new();
    for sentence in split_sentences(paragraph) {
        if !current.is_empty() && current.len() + sentence.len() > CHUNK_TARGET_CHARS {
            parts.push(current.trim().to_string());
            current = String::new();
        }
        if sentence.len() > CHUNK_MAX_CHARS {
            if !current.trim().is_empty() {
                parts.push(current.trim().to_string());
                current = String::new();
            }
            parts.extend(split_at_char_boundaries(&sentence, CHUNK_MAX_CHARS));
        } else {
            current.push_str(&sentence);
        }
    }
    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }
    parts
}

/// Splits on sentence terminators (./!/?) followed by whitespace, and on
/// newlines, keeping the terminator with its sentence.
fn split_sentences(text: &str) -> Vec<String> {
    let mut sentences: Vec<String> = Vec::new();
    let mut start = 0;
    let mut chars = text.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        let is_terminator = matches!(c, '.' | '!' | '?');
        let is_newline = c == '\n';
        let next_is_space = chars
            .peek()
            .map(|(_, next)| next.is_whitespace())
            .unwrap_or(true);
        if is_newline || (is_terminator && next_is_space) {
            let end = i + c.len_utf8();
            let sentence = &text[start..end];
            if !sentence.trim().is_empty() {
                sentences.push(sentence.to_string());
            }
            start = end;
        }
    }
    if start < text.len() && !text[start..].trim().is_empty() {
        sentences.push(text[start..].to_string());
    }
    sentences
}

fn split_at_char_boundaries(text: &str, max_chars: usize) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    chars
        .chunks(max_chars)
        .map(|c| c.iter().collect::<String>().trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Stable, dependency-free content hash (FNV-1a 64) for chunk dirty tracking.
fn fnv1a(text: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fnv1a_is_stable_and_distinct() {
        assert_eq!(fnv1a("hello"), fnv1a("hello"));
        assert_ne!(fnv1a("hello"), fnv1a("hello!"));
        assert_eq!(fnv1a("hello").len(), 16);
    }

    #[test]
    fn empty_and_whitespace_text_produces_no_chunks() {
        assert!(chunk_text("").is_empty());
        assert!(chunk_text("  \n\n   \n").is_empty());
    }

    #[test]
    fn short_text_is_one_chunk() {
        let chunks = chunk_text("Just a short note.\n\nWith two paragraphs.");
        assert_eq!(chunks.len(), 1);
        assert!(chunks[0].contains("short note"));
        assert!(chunks[0].contains("two paragraphs"));
    }

    #[test]
    fn long_text_splits_with_overlap() {
        let paragraph = "The heron stood in the shallows watching the tide. ";
        let text = paragraph.repeat(120); // ~6000 chars, one giant paragraph
        let chunks = chunk_text(&text);
        assert!(chunks.len() > 2);
        for chunk in &chunks {
            assert!(chunk.len() <= CHUNK_MAX_CHARS + 2);
            // never mid-sentence: every chunk ends at a terminator
            assert!(
                chunk.trim_end().ends_with('.'),
                "chunk ends mid-sentence: {chunk:?}"
            );
        }
    }

    #[test]
    fn paragraphs_pack_with_carryover_overlap() {
        let paragraphs: Vec<String> = (0..40)
            .map(|i| {
                format!(
                    "Paragraph number {i} talks about topic {i} in considerable detail, \
                     weaving through memory, weather, and the slow work of revision."
                )
            })
            .collect();
        let text = paragraphs.join("\n\n");
        let chunks = chunk_text(&text);
        assert!(chunks.len() >= 2);
        // Overlap: the last unit of chunk 0 reappears at the start of chunk 1.
        let last_sentence = chunks[0].split("\n\n").last().unwrap();
        assert!(chunks[1].starts_with(last_sentence));
    }

    #[test]
    fn unicode_text_never_panics() {
        let text = "héron 鷺 🪶 ".repeat(500);
        let chunks = chunk_text(&text);
        assert!(!chunks.is_empty());
    }

    #[test]
    fn appending_text_leaves_leading_chunks_stable() {
        let base: Vec<String> = (0..60)
            .map(|i| format!("Sentence {i} about the estuary, its tides, and its patient birds."))
            .collect();
        let text = base.join("\n\n");
        let original = chunk_text(&text);
        assert!(original.len() >= 3);
        let edited = chunk_text(&format!("{text}\n\nA brand new closing paragraph."));
        // Chunks before the edit hash identically → no re-embed for them.
        assert_eq!(fnv1a(&original[0]), fnv1a(&edited[0]));
        assert_ne!(
            fnv1a(original.last().unwrap()),
            fnv1a(edited.last().unwrap()),
        );
    }

    #[test]
    fn disabled_index_reports_disabled_and_skips_queue() {
        let index = SemanticIndex::new();
        assert_eq!(index.status(), "disabled");
        // No worker started: request_index and embed_query are safe no-ops.
        index.request_index("doc-1");
        assert!(index.embed_query("anything").is_none());
    }
}
