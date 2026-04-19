# Requirements: Quillium Omni v1.1 — PRE-V2 FIX ANNOTATION SYNC

**Defined:** 2026-04-19
**Core Value:** Two Quillium instances can connect and see each other's edits in real-time, including annotations and revision versions, without divergence or data loss.

## v1.1 Requirements

Requirements for the v1.1 sync re-architecture. Each maps to roadmap phases.

### Sync Architecture (SYNC)

- [ ] **SYNC-01**: Yjs is the single source of truth for annotation state; `annotationField` is a derived projection (no code path writes annotation state outside the projector dispatch)
- [ ] **SYNC-02**: All CM → Yjs writes go through a single `commands.ts` module; sync plugin contains zero `.is(<specific effect>)` branches
- [ ] **SYNC-03**: Local Yjs writes use `ydoc.transact(fn, "local")`; observer skips `tr.origin === "local"`; remote CM dispatches carry `yjsAnnotationSync.of(true)` + `Transaction.addToHistory.of(false)`
- [ ] **SYNC-04**: Decoration ViewPlugin rebuilds DecorationSet from Y.Map state on every update (no cached StateField shape)
- [ ] **SYNC-05**: `observeDeep` lifecycle is matched — every observer has a stored reference and matching `unobserveDeep` in `destroy()`; every `queueMicrotask` callback checks `destroyed` first
- [ ] **SYNC-06**: A feedback-loop test asserts ≤ N Yjs updates for N keystrokes from one peer

### Revision Versions (REVISION)

- [ ] **REVISION-01**: Each revision version is an isolated Y type (`Y.Array<Y.Map>` element with own `Y.Text`) supporting character-level concurrent merge inside a version
- [ ] **REVISION-02**: `pushDocToVersionState` (Phase 3 of `annotationField.update`) is deleted; `_updateRevisionVersionDoc` and `revisionsWithExplicitEffect` removed
- [ ] **REVISION-03**: A remote-originated transaction never reads parent doc to write version state (invariant enforced post-Phase 5)
- [ ] **REVISION-04**: Active-version `Y.Text` observer drives the nested editor's CM doc; nested view binds via `createYjsBinding` to `versionYText`
- [ ] **REVISION-05**: Version switch is data-only — destroy binding + rebind; never tear down annotation on switch; rebuild = single batched `{remove, add}` dispatch
- [ ] **REVISION-06**: Nested editors recurse for infinite nesting (revision-inside-revision syncs same as top-level) using the same binding pattern
- [ ] **REVISION-07**: Atomic dual-write (Pattern 7c) — nested editor binding writes both parent `Y.Text` slice and version `Y.Text` inside the same `ydoc.transact`
- [ ] **REVISION-08**: `NestedEditorController` flush pathways deleted (`flushToParent`, `flushAnnotationStateToParent`, `_lastMountedBlob`, `_lastDispatchedDoc`, `syncFromParent`)

### Joiner View (JOINER)

- [ ] **JOINER-01**: Joiner collab `EditorView` has no `history()` extension; assertion `view.state.field(historyField, false) === undefined` passes
- [ ] **JOINER-02**: Joiner initial annotationField is empty; owner `_syncInitialToYjs` is guarded against re-entrance
- [ ] **JOINER-03**: Cmd-z on joiner immediately after connect does not revert past the connect state
- [ ] **JOINER-04**: Decorations render on joiner immediately on connect (no "switch once" workaround); `provider.on('sync')` triggers explicit annotationField rebuild
- [ ] **JOINER-05**: Joiner annotation count after owner-has-N + joiner-connects equals N (not 2N); duplicate-on-seed asserted in harness
- [ ] **JOINER-06**: Two-gate initial sync — annotationField rebuild fires only after both `Y.Text` synced AND `Y.Map` synced

### Thread Append (THREAD)

- [ ] **THREAD-01**: Concurrent thread message appends from two peers converge without loss (no last-write-wins on the thread array)
- [ ] **THREAD-02**: `appendThreadMessageCommand` writes through Yjs first; projector derives thread state for `annotationField`

### Position Anchoring (ANCHOR)

- [ ] **ANCHOR-01**: Annotation `from`/`to` stored as `Y.RelativePosition` in the Y.Map; CM offsets resolved at render time only
- [ ] **ANCHOR-02**: Annotation positions survive remote rebuild without rot or collapsed ranges
- [ ] **ANCHOR-03**: Persistence uses binary `Y.encodeRelativePosition` (never JSON-round-tripped); end-of-text positions handled via null-`item` fallback

### Test Harness & Validation (HARNESS)

- [ ] **HARNESS-01**: Deterministic `flushAll(...peers)` helper exists and is used by every two-peer test
- [ ] **HARNESS-02**: Convergence property test asserts `yjsAnnotationToCodeMirror(yMap) === annotationField` after every microtask flush
- [ ] **HARNESS-03**: 10k-op convergence fuzz over random local-effect sequences on both peers passes green
- [ ] **HARNESS-04**: Cross-peer undo (`Y.UndoManager`) validated end-to-end; `captureTimeout` tuned (start at 0)
- [ ] **HARNESS-05**: Dogfood checklist passed across two real devices for the v1.0-regression scenarios (concurrent typing inside a version, version switch propagation, joiner pre-existing annotations, Cmd-z post-connect, concurrent thread appends)

### Schema Migration (SCHEMA)

- [ ] **SCHEMA-01**: `versions: Y.Map<string-index, Y.Map>` migrated to `versions: Y.Array<Y.Map>` for proper concurrent-insert CRDT semantics (clean break per D-94, no legacy wire format)
- [ ] **SCHEMA-02**: Detached-type audit — every `new Y.Map()` / `new Y.Text()` site is inside a `ydoc.transact` that immediately attaches via `parentMap.set(key, child)` before any read

## v2 Requirements

Deferred to v2.0 / future milestones.

### Pattern 7b Migration

- **PAT7B-01**: Replace Pattern 7c (atomic dual-write) with Pattern 7b (parent doc projected from non-revision text + revision-hole projections) — strictly cleaner, no dual storage, but every parent-doc position calculation must span holes

### Persistence Modernization

- **PERSIST-01**: Replace SQLite seed/drain with SQLite-as-Yjs-persistence-provider
- **PERSIST-02**: Per-annotation `expand` config (Peritext-style mark semantics)

### CRDT Library Evaluation

- **CRDT-01**: Evaluate `loro-crdt` `LoroTree` as Y.Map-of-Y.Map replacement if hierarchy hits a wall

### Subdocument Architecture

- **SUBDOC-01**: True Y.Doc subdocument per revision version with relay multiplexing

## Out of Scope

Explicitly excluded from v1.1.

| Feature | Reason |
|---------|--------|
| ProseMirror migration | Requires editor swap; orthogonal to sync layer fix |
| Loro / Automerge migration | Wholesale CRDT swap; out of scope; logged as v2 candidate |
| `y-codemirror.next` adoption | Stable 0.3.5 only binds Y.Text, not annotations; explicitly warns absolute index sync not guaranteed for comment-style features |
| Y.Doc subdocuments per version | Relay protocol changes + cross-doc position encoding break — defer |
| Y.XmlFragment for annotation tree | No payoff over Y.Map for our shape |
| Separate annotation broadcast channel | Reintroduces dual source of truth (anti-feature) |
| Serialized annotation blob into Y.Map value | Current v1.0 approach — root cause of thread-append collisions |
| LWW-per-block text | Loses character-level merge |
| Presence/cursors UX | Already shipped via Phase 6.5; not part of sync re-architecture |
| Sharing UI + permissions | Deferred to v2 |
| Version history sync | Deferred to v2 |
| Production hardening | Prototype quality acceptable for v1.1 |
| Product/UX redesign | v1.1 is sync-layer only |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SYNC-01 | TBD | Pending |
| SYNC-02 | TBD | Pending |
| SYNC-03 | TBD | Pending |
| SYNC-04 | TBD | Pending |
| SYNC-05 | TBD | Pending |
| SYNC-06 | TBD | Pending |
| REVISION-01 | TBD | Pending |
| REVISION-02 | TBD | Pending |
| REVISION-03 | TBD | Pending |
| REVISION-04 | TBD | Pending |
| REVISION-05 | TBD | Pending |
| REVISION-06 | TBD | Pending |
| REVISION-07 | TBD | Pending |
| REVISION-08 | TBD | Pending |
| JOINER-01 | TBD | Pending |
| JOINER-02 | TBD | Pending |
| JOINER-03 | TBD | Pending |
| JOINER-04 | TBD | Pending |
| JOINER-05 | TBD | Pending |
| JOINER-06 | TBD | Pending |
| THREAD-01 | TBD | Pending |
| THREAD-02 | TBD | Pending |
| ANCHOR-01 | TBD | Pending |
| ANCHOR-02 | TBD | Pending |
| ANCHOR-03 | TBD | Pending |
| HARNESS-01 | TBD | Pending |
| HARNESS-02 | TBD | Pending |
| HARNESS-03 | TBD | Pending |
| HARNESS-04 | TBD | Pending |
| HARNESS-05 | TBD | Pending |
| SCHEMA-01 | TBD | Pending |
| SCHEMA-02 | TBD | Pending |

**Coverage:**
- v1.1 requirements: 32 total
- Mapped to phases: 0 (filled by roadmapper)
- Unmapped: 32 ⚠️

---
*Requirements defined: 2026-04-19*
*Last updated: 2026-04-19 after initial definition*
