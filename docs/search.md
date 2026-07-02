# Document Search

Full-text + semantic search across all documents (#248). One blended search
box in the library: keyword matches (FTS5/bm25) and "search by meaning"
matches (on-device embeddings) are fused into a single ranked list.

## Data flow

```
edit → listeners.ts writeMeta (500 ms debounce)
     → cmd_update_document_meta(..., bodyText)
         → documents.body_text                 ── SQL triggers ──→ documents_fts (FTS5)
         → SemanticIndex.request_index(docId)  ── worker thread ──→ chunks + vec_chunks (vec0)

library search box (≥2 chars, 200 ms debounce)
     → cmd_search_documents(query)
         → FTS5 MATCH (bm25, title-weighted)   ──┐
         → embed query → KNN over vec_chunks   ──┤→ RRF fusion (k=60) → SearchHit[]
```

## Schema & migrations

Schema changes go through `packages/desktop/src-tauri/src/db/migrations.rs` — a versioned
migration runner keyed on `PRAGMA user_version`. Each migration is plain SQL
or a Rust function (for backfills), runs once, in its own transaction. To
change the schema, **append a new numbered migration**; never edit shipped ones.

| # | Migration | What it does |
|---|-----------|--------------|
| 1 | baseline_schema | documents/drafts/events/snapshots/_meta (pre-framework schema) |
| 2 | snapshots_label | `snapshots.label` column (was an ad-hoc runtime ALTER) |
| 3 | fts5_documents | `documents.body_text` + external-content FTS5 table + sync triggers |
| 4 | backfill_body_text | one-time: latest snapshot `state_json` → `body_text` per document |
| 5 | semantic_chunks | `chunks` table + `vec_chunks` vec0 virtual table (384-dim, cosine) |
| 6 | tabs_and_draft_tree | tabs table + draft-tree columns; attaches pre-existing drafts to a per-doc "Main" tab (see [tabs-and-drafts.md](./tabs-and-drafts.md)) |
| 7 | draft_branch_relation | `drafts.branched_from`; reinterprets old fork-as-child links as branches |

Key files:

- `packages/desktop/src-tauri/src/db/migrations.rs` — framework + all migrations
- `packages/desktop/src-tauri/src/db/search.rs` — FTS query building, KNN, RRF fusion, `SearchHit`
- `packages/desktop/src-tauri/src/embeddings.rs` — chunking, hashing, model, worker thread
- `src/lib/db/index.ts` — `searchDocuments()`, `getSearchStatus()`
- `src/lib/library/snippet.ts` — highlight-sentinel parsing for snippets
- `src/routes/library/+page.svelte` — debounced backend search merged with the instant client filter

## Keyword side (Phase 1)

- `documents.body_text` is denormalized full plain text, written by the same
  debounced `updateDocumentMeta` path that already computes it (`bodyText` is
  optional — rename/tag updates omit it and preserve the indexed body).
- `documents_fts` is an **external-content** FTS5 table (`content='documents'`)
  kept in sync by AFTER INSERT/DELETE triggers and an
  `AFTER UPDATE OF title, body_text, tags` trigger — scoped so the
  per-keystroke `updated_at` bump never re-tokenizes the document.
- Trashed docs stay indexed but are filtered with `deleted_at IS NULL` in the
  query join (FTS5 external content can't index a WHERE).
- User input is sanitized into `"term1" "term2" "last"*` — every term quoted,
  last term prefix-matched — so FTS5 operators in queries can't break syntax.
- Snippets come from FTS5 `snippet()` with U+E000/U+E001 private-use sentinels
  around matches; the UI splits on those and renders `<mark>` (no HTML over IPC).

## Semantic side (Phase 2)

- **Opt-in**: gated behind "Search by meaning" in Settings (persisted in
  `_meta` as `semantic_search_enabled`, default **off** — read by Rust at
  startup, toggled via `cmd_set_semantic_search_enabled`). Nothing is
  downloaded until the user enables it. Disabling drops the model from
  memory but keeps chunks/vectors on disk, so re-enabling only embeds what
  changed in between (the enable-time reconcile catches up).
- **Model**: bge-small-en-v1.5 quantized (384-dim, MIT) via the `fastembed`
  crate (ONNX Runtime). Downloaded on first enable into `{app-data}/models/`;
  until then (and offline) search is keyword-only. Desktop-only — on mobile
  the index reports `unavailable`.
- **Storage**: `sqlite-vec` (`vec0` virtual table), statically linked into the
  binary and registered via `sqlite3_auto_extension` in `schema.rs`. Brute-force
  KNN — no ANN index needed at this scale. `vec_chunks.rowid = chunks.id`.
  FK cascades don't reach virtual tables: permanent delete/purge/reset paths
  clear `vec_chunks` explicitly.
- **Chunking**: paragraph/sentence-aware packing (~1200 chars/chunk, last-unit
  overlap), each chunk FNV-1a hashed. The worker re-chunks on save (3 s
  debounce, own WAL connection) and embeds **only chunks whose hash changed**.
  On startup it reconciles every live document — which is also the embedding
  backfill for pre-existing docs.
- **Fusion**: Reciprocal Rank Fusion (k=60) over the two ranked lists; chunk
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
