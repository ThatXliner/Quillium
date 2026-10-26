# Document search

The Library combines keyword matches from SQLite FTS5 with optional on-device
semantic matches. The searchable body is document metadata from the latest
content-metadata write, not an index of every draft or inactive revision version.

## Data flow

```
edit → listeners.ts writeMeta (500 ms debounce)
     → cmd_update_document_content_metadata(..., bodyText)
         → documents.body_text                 ── SQL triggers ──→ documents_fts (FTS5)
         → SemanticIndex.request_index(docId)  ── worker thread ──→ chunks + vec_chunks (vec0)

library search box (≥2 chars, 200 ms debounce)
     → cmd_search_documents(query)
         → FTS5 MATCH (bm25, title-weighted)   ──┐
         → embed query → KNN over vec_chunks   ──┤→ RRF fusion (k=60) → SearchHit[]
```

## Implementation

- [search.rs](../packages/desktop/src-tauri/src/db/search.rs) builds FTS queries,
  combines keyword and semantic results, and defines `SearchHit`.
- [embeddings.rs](../packages/desktop/src-tauri/src/embeddings.rs) owns chunking,
  model loading, and the embedding worker.
- [db/index.ts](../packages/desktop/src/lib/db/index.ts) exposes `searchDocuments()`
  and `getSearchStatus()` to the frontend.
- [snippet.ts](../packages/desktop/src/lib/library/snippet.ts) parses highlight
  sentinels without rendering database results as HTML.
- [the Library route](../packages/desktop/src/routes/library/+page.svelte) merges
  debounced backend results with its immediate client-side filter.

Schema definitions and their ordered upgrades live in
[migrations.rs](../packages/desktop/src-tauri/src/db/migrations.rs). Follow the
[append-only migration rule](persistence.md#schema-migrations) when changing them.

## Keyword search

- `documents.body_text` is denormalized full plain text, written by the same
  debounced `updateDocumentContentMetadata` path that already computes it.
  Separate title and tag operations preserve the indexed body.
- `documents_fts` is an **external-content** FTS5 table (`content='documents'`)
  kept in sync by AFTER INSERT/DELETE triggers and an
  `AFTER UPDATE OF title, body_text, tags` trigger, scoped so the
  per-keystroke `updated_at` bump never re-tokenizes the document.
- Trashed docs stay indexed but are filtered with `deleted_at IS NULL` in the
  query join (FTS5 external content can't index a WHERE).
- User input is sanitized into `"term1" "term2" "last"*` with every term quoted and
  the last term prefix-matched, so FTS5 operators in queries can't break syntax.
- Snippets come from FTS5 `snippet()` with U+E000/U+E001 private-use sentinels
  around matches; the UI splits on those and renders `<mark>` (no HTML over IPC).

## Semantic search

- Enabled through "Search by meaning" in Settings (persisted in
  `_meta` as `semantic_search_enabled`, default off, read by Rust at
  startup and toggled via `cmd_set_semantic_search_enabled`). Nothing is
  downloaded until the user enables it. Disabling drops the model from
  memory but keeps chunks/vectors on disk, so re-enabling only embeds what
  changed in between (the enable-time reconcile catches up).
- The model is bge-small-en-v1.5 quantized (384-dim, MIT) via the `fastembed`
  crate (ONNX Runtime). Downloaded on first enable into `{app-data}/models/`;
  until the model is available, search is keyword-only. The index runs only
  on desktop; mobile reports `unavailable`. A cached model does not require a
  network connection for inference.
- Storage uses `sqlite-vec` (`vec0` virtual table), statically linked into the
  binary and registered via `sqlite3_auto_extension` in `schema.rs`. Search uses
  brute-force KNN. `vec_chunks.rowid = chunks.id`.
  FK cascades don't reach virtual tables: permanent delete/purge/reset paths
  clear `vec_chunks` explicitly.
- Chunking uses paragraph/sentence-aware packing (~1200 chars/chunk, last-unit
  overlap), each chunk FNV-1a hashed. The worker re-chunks on save (3 s
  debounce, own WAL connection) and embeds **only chunks whose hash changed**.
  On startup it reconciles every live document, including older documents that
  have no embeddings yet.
- Results use Reciprocal Rank Fusion (k=60) over the two ranked lists; chunk
  hits aggregate to their parent document (best chunk = snippet). Semantic
  hits past cosine distance 0.45 are dropped so KNN can't flood unrelated
  results. `matchType` is `keyword` / `semantic` / `both`; semantic-only hits
  get a "similar" badge in the library card.

## Status

`cmd_search_status` reports the semantic index lifecycle
(`disabled`, or `starting → loading-model → indexing → ready`, or
`unavailable` / `error: …`). The Settings row shows download/index progress;
the library shows a hint while a content search runs before the index is
ready. Keyword search works the whole time.
