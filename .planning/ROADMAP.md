# Roadmap: Quillium Omni

## Milestones

- ✅ **v1.0 Omni MVP** — Phases 1-8.5c shipped; Phases 9-13 deferred (shipped 2026-04-19) — see [v1.0-ROADMAP.md](./milestones/v1.0-ROADMAP.md)
- 🚧 **v1.1 PRE-V2 FIX ANNOTATION SYNC** — in progress (started 2026-04-19)
- 📋 **v2.0 Realtime Sync Re-architecture** — planning

## Phases

<details>
<summary>✅ v1.0 Omni MVP (Phases 1-8.5c) — SHIPPED 2026-04-19</summary>

- [x] Phase 1: Data Model (3/3 plans) — completed 2025-04-17
- [x] Phase 2: Auth Foundation (2/2 plans)
- [x] Phase 3: Anonymous Auth (1/1 plan)
- [x] Phase 4: Relay Core (3/3 plans)
- [x] Phase 5: Relay Persistence (3/3 plans) — completed 2025-04-17
- [x] Phase 6: Client Collab (3/3 plans) — completed 2025-04-17
- [x] Phase 6.5: Collab Polish (4/4 plans, INSERTED) — completed 2025-04-17
- [x] Phase 7: Connection UX (1/1 plan) — completed 2026-04-19
- [x] Phase 7.5: Yjs Migration (7/7 plans, INSERTED)
- [x] Phase 8: Annotation Sync (6/6 plans)
- [x] Phase 8.5a: CRDT Data Shape (2/2 plans, INSERTED) — completed 2026-04-18
- [x] Phase 8.5b: CRDT Sync Plumbing (2/2 plans, INSERTED) — completed 2026-04-19
- [x] Phase 8.5c: CRDT Nested Editor Wiring (2/2 plans, INSERTED) — completed 2026-04-18

**Deferred to v1.1 / v2.0:**
- Phase 9: Fix Live Collab Revision Editing Bugs — tactical patches, architecture debt
- Phase 10: Strip Broken Collab Sync Layer — completed but part of a larger incomplete architectural effort
- Phase 11: Unified Subtree Sync Rebuild — completed but architecture still produces sync bugs
- Phase 12: Nested Editor Reunification — symptom patches; needs root-cause re-architecture
- Phase 13: Dogfooding Regression Suite — never planned

See [v1.0-ROADMAP.md](./milestones/v1.0-ROADMAP.md) for full details.

</details>

### 🚧 v1.1 PRE-V2 FIX ANNOTATION SYNC (Active)

**Scope:** Re-architect the `annotationField` ↔ `Y.Map` layer so document text, comment positions, and revision versions (infinitely nested) all sync reliably in real-time between peers. Single source of truth: Yjs canonical, `annotationField` derived projection.

**Phase numbering reset to 1** (v1.0 phases archived under `milestones/`).

- [x] **Phase 1: Test Harness & Invariants** — Deterministic two-peer test infrastructure + canonical-source invariants land before any sync rewrite.
- [x] **Phase 2: Joiner View Hardening** — Joiner collab view has no `history()`, empty initial annotationField, and re-entrance-guarded owner seed.
- [ ] **Phase 3: Unified Write Path (CM → Yjs Commands)** — All annotation mutations flow through a single `commands.ts` module that writes Yjs first; `versions` schema migrates to `Y.Array<Y.Map>`.
- [ ] **Phase 4: Unified Read Path (Yjs → CM Projector)** — `yjsAnnotations.ts` rewritten as observer-only; decoration ViewPlugin rebuilds from Y on every update; joiner sync gate hydrates decorations on connect.
- [ ] **Phase 5: Phase 3 Removal** — `pushDocToVersionState` and the `revisionsWithExplicitEffect` escape hatch deleted; per-version isolated `Y.Text` becomes the sole writer for version body; Pattern 7c atomic dual-write lands.
- [ ] **Phase 6: Nested Editor Rewire & Version Switch** — `NestedEditorController` flush pathways deleted; nested view binds via `createYjsBinding` to `versionYText`; version switch is data-only (rebind, never tear down annotation); recurses for infinite nesting.
- [ ] **Phase 7: Position Anchoring** — Annotation `from`/`to` stored as `Y.RelativePosition`; CM offsets resolved at render time; persistence uses binary `Y.encodeRelativePosition`.
- [ ] **Phase 8: Detached-Type Audit & Integrity** — Every `new Y.Map()` / `new Y.Text()` site is inside a `ydoc.transact` that immediately attaches via `parentMap.set`.
- [ ] **Phase 9: Convergence Fuzz & Dogfood** — 10k-op convergence fuzz, cross-peer `Y.UndoManager` validation, two-device dogfood checklist.

### 📋 v2.0 Realtime Sync Re-architecture (Planning)

**Scope:** Pattern 7b migration (no parent-doc dual storage), SQLite-as-Yjs-persistence-provider, per-annotation `expand` config, evaluation of Loro `LoroTree` and Y.Doc subdocuments per version.

Phases to be defined during `/gsd-new-milestone` after v1.1 ships.

## Phase Details

### Phase 1: Test Harness & Invariants
**Goal**: A deterministic two-peer test substrate exists so every later phase asserts behavior reliably; canonical-source invariants are documented and enforced.
**Depends on**: Nothing (first phase)
**Requirements**: HARNESS-01, HARNESS-02, SYNC-06
**Success Criteria** (what must be TRUE):
  1. A `flushAll(...peers)` helper exists in `tests/` and is the only flush primitive used by two-peer convergence tests.
  2. A convergence property test asserts `yjsAnnotationToCodeMirror(yMap) === annotationField` after every microtask flush, and is green against the current code as a baseline.
  3. A feedback-loop test asserts that N keystrokes from one peer produce ≤ N Yjs updates (no amplification).
  4. `yjsAnnotations.ts` carries top-of-file invariant comments declaring Yjs canonical and listing the four-guard origin discipline.
**Plans**: 3 plans complete

### Phase 2: Joiner View Hardening
**Goal**: A freshly-connected joiner has a clean editor: no pre-connect undo history, no duplicated annotations, no Cmd-z reverting past the connect state.
**Depends on**: Phase 1
**Requirements**: JOINER-01, JOINER-02, JOINER-03, JOINER-05
**Success Criteria** (what must be TRUE):
  1. The joiner collab `EditorView` has no `history()` extension; the harness assertion `view.state.field(historyField, false) === undefined` passes.
  2. Joiner initial annotationField is empty before observer hydration; owner `_syncInitialToYjs` is guarded against re-entrance.
  3. Pressing Cmd-z on a joiner immediately after connect leaves the document and annotations unchanged.
  4. Owner has N annotations + joiner connects → joiner annotation count = N (not 2N), asserted in the harness.
**Plans**: 5 plans
- [x] 02-01-PLAN.md — Wave 0 probes (A1 event-name spelling, A2 compartment removal) + makeJoinerPeer harness factory
- [x] 02-02-PLAN.md — historyCompartment in extensions.ts + joiner branch in enableCollab (JOINER-01)
- [x] 02-03-PLAN.md — Selection restore ViewPlugin in yjsUndo.ts (criterion #8)
- [x] 02-04-PLAN.md — yjsBinding addToHistory.of(false) + _syncInitialToYjs re-entrance guard + 2x annotation race fix (JOINER-02, JOINER-05, criterion #7)
- [x] 02-05-PLAN.md — joiner-view.test.ts end-to-end suite (JOINER-01/-03/-05 + criteria #6/#7/#8)

**Post-plan dogfood fixes (2026-04-22)**:
- Joiner blank-document regression fixed.
- Revision range position sync fixed for Yjs annotation nodes.
- First-render annotation decorations fixed by deriving decorations directly from `EditorState`.
- Inline nested annotation decorations fixed across parent revision version switches and version creation.
- Missing nested selection blobs now hydrate quietly with a cursor fallback.

### Phase 3: Unified Write Path (CM → Yjs Commands)
**Goal**: Every annotation mutation in the app flows through one `commands.ts` module that writes Yjs first; the sync plugin contains zero effect-specific branches; concurrent thread appends from two peers converge without loss.
**Depends on**: Phase 2
**Requirements**: SYNC-02, SYNC-03, SYNC-05, THREAD-01, THREAD-02, SCHEMA-01
**Success Criteria** (what must be TRUE):
  1. All former CM-effect call sites (`createAnnotation`, `appendThreadMessage`, `switchActiveVersion`, `addVersion`, `deleteVersion`, `updateVersionLabel`, …) are replaced by command functions that mutate Yjs inside `ydoc.transact(fn, "local")`; sync plugin contains no `.is(<specific effect>)` branches.
  2. Two peers concurrently appending thread messages on the same annotation converge to the union of both messages with no last-write-wins loss.
  3. The `versions` field is `Y.Array<Y.Map>` (not `Y.Map<string-index, Y.Map>`); existing in-memory tests pass against the new shape.
  4. Every `observeDeep` has a stored function reference and matching `unobserveDeep` in `destroy()`; every `queueMicrotask` callback checks `destroyed` first; lifecycle test asserts no leaks across 100 connect/disconnect cycles.
**Plans**: TBD

### Phase 4: Unified Read Path (Yjs → CM Projector)
**Goal**: `yjsAnnotations.ts` is the only writer of `annotationField`; decorations render correctly from Yjs state alone, including immediately on joiner connect with no "switch once" workaround.
**Depends on**: Phase 3
**Requirements**: SYNC-01, SYNC-04, JOINER-04, JOINER-06
**Success Criteria** (what must be TRUE):
  1. No code path outside the projector dispatch writes annotation state; the property test from Phase 1 stays green after every observed Yjs change.
  2. Decoration ViewPlugin rebuilds its DecorationSet from the Y.Map on every `update()`; toggling a CM-only state field does not change decoration visibility.
  3. On joiner connect, decorations appear immediately (asserted via E2E or harness DOM snapshot) without the user typing or interacting.
  4. The annotationField rebuild fires only after both `Y.Text` synced AND `Y.Map` synced (two-gate); single-gate timing is asserted to fail in regression.
**Plans**: TBD

### Phase 5: Phase 3 Removal
**Goal**: The Phase 3 escape hatch (`pushDocToVersionState`) is gone; per-version `Y.Text` is the sole authority for version body text; concurrent character-level edits inside a version converge.
**Depends on**: Phase 4
**Requirements**: REVISION-01, REVISION-02, REVISION-03, REVISION-07
**Success Criteria** (what must be TRUE):
  1. `pushDocToVersionState`, `_updateRevisionVersionDoc`, and `revisionsWithExplicitEffect` are removed from `annotationField.ts` (greppable absence asserted in CI).
  2. Each revision version is an isolated Y type (`Y.Array<Y.Map>` element with own `Y.Text`); two peers typing concurrently inside the same active version converge character-by-character.
  3. A regression test asserts that no remote-originated transaction reads the parent doc to write version state (instrumentation in test build).
  4. Pattern 7c atomic dual-write: nested editor binding writes both the parent `Y.Text` slice and the version `Y.Text` inside the same `ydoc.transact`; round-trip test passes on two peers.
**Plans**: TBD

### Phase 6: Nested Editor Rewire & Version Switch Hardening
**Goal**: Nested editors live entirely off Yjs bindings; version switching is data-only and never destroys annotations; revision-inside-revision syncs identically to top-level.
**Depends on**: Phase 5
**Requirements**: REVISION-04, REVISION-05, REVISION-06, REVISION-08
**Success Criteria** (what must be TRUE):
  1. `flushToParent`, `flushAnnotationStateToParent`, `_lastMountedBlob`, `_lastDispatchedDoc`, and `syncFromParent` are deleted from `NestedEditorController`.
  2. The active-version `Y.Text` observer drives the nested editor's CM doc; mounting a nested editor binds via `createYjsBinding` to `versionYText`.
  3. Switching the active version on a joiner peer rebinds the nested editor without ever firing `removeAnnotation`; the annotation persists across the switch and the rebuild is one batched `{remove, add}` dispatch.
  4. A two-peer test with a revision inside a revision (one level of nesting beyond top-level) converges on concurrent typing, version switch, and version add.
**Plans**: TBD
**UI hint**: yes

### Phase 7: Position Anchoring
**Goal**: Annotation positions survive remote rebuild without rot or collapsed ranges, and persist losslessly across session boundaries.
**Depends on**: Phase 6
**Requirements**: ANCHOR-01, ANCHOR-02, ANCHOR-03
**Success Criteria** (what must be TRUE):
  1. Annotation `from`/`to` are stored on the Y.Map as `Y.RelativePosition`; the projector resolves them to CM offsets at render time only.
  2. After a remote-originated full rebuild, every annotation's CM range is intact (no zero-width / collapsed range), asserted in a two-peer harness test.
  3. Persistence (snapshot + replay) round-trips RelativePositions via binary `Y.encodeRelativePosition`; an end-of-text-positioned annotation still anchors at end after encode→decode (null-`item` fallback exercised).
**Plans**: TBD

### Phase 8: Detached-Type Audit & Integrity
**Goal**: Every Y type is integrated into its parent before any code reads from it; the entire codebase is free of detached-Y-type access traps.
**Depends on**: Phase 7
**Requirements**: SCHEMA-02
**Success Criteria** (what must be TRUE):
  1. An audit grep / lint check enumerates every `new Y.Map()` and `new Y.Text()` site and confirms each is inside a `ydoc.transact` that calls `parentMap.set(key, child)` before any read.
  2. A regression test exercises the detached-access trap (constructing a Y type, reading before attach) and confirms the codebase no longer triggers the "Invalid access" warning under integration test load.
**Plans**: TBD

### Phase 9: Convergence Fuzz & Dogfood
**Goal**: The new sync architecture is validated under random-load convergence and signed off by real two-device usage.
**Depends on**: Phase 8
**Requirements**: HARNESS-03, HARNESS-04, HARNESS-05
**Success Criteria** (what must be TRUE):
  1. A 10k-op convergence fuzz over random local-effect sequences on both peers converges to identical state after `flushAll`, run green in CI.
  2. Cross-peer undo via `Y.UndoManager` is validated end-to-end (annotations + text + version switch); `captureTimeout` is tuned (start at 0, raise only with evidence).
  3. The dogfood checklist passes across two real devices for all v1.0-regression scenarios: concurrent typing inside a version, version switch propagation, joiner pre-existing annotations, Cmd-z post-connect, concurrent thread appends.
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Data Model | v1.0 | 3/3 | Complete | 2025-04-17 |
| 2. Auth Foundation | v1.0 | 2/2 | Complete | - |
| 3. Anonymous Auth | v1.0 | 1/1 | Complete | - |
| 4. Relay Core | v1.0 | 3/3 | Complete | - |
| 5. Relay Persistence | v1.0 | 3/3 | Complete | 2025-04-17 |
| 6. Client Collab | v1.0 | 3/3 | Complete | 2025-04-17 |
| 6.5. Collab Polish | v1.0 | 4/4 | Complete | 2025-04-17 |
| 7. Connection UX | v1.0 | 1/1 | Complete | 2026-04-19 |
| 7.5. Yjs Migration | v1.0 | 7/7 | Complete | - |
| 8. Annotation Sync | v1.0 | 6/6 | Complete | - |
| 8.5a. CRDT Data Shape | v1.0 | 2/2 | Complete | 2026-04-18 |
| 8.5b. CRDT Sync Plumbing | v1.0 | 2/2 | Complete | 2026-04-19 |
| 8.5c. CRDT Nested Editor Wiring | v1.0 | 2/2 | Complete | 2026-04-18 |
| 1. Test Harness & Invariants | v1.1 | 3/3 | Complete | 2026-04-22 |
| 2. Joiner View Hardening | v1.1 | 5/5 | Complete | 2026-04-22 |
| 3. Unified Write Path | v1.1 | 0/? | Not started | - |
| 4. Unified Read Path | v1.1 | 0/? | Not started | - |
| 5. Phase 3 Removal | v1.1 | 0/? | Not started | - |
| 6. Nested Editor Rewire | v1.1 | 0/? | Not started | - |
| 7. Position Anchoring | v1.1 | 0/? | Not started | - |
| 8. Detached-Type Audit | v1.1 | 0/? | Not started | - |
| 9. Convergence Fuzz & Dogfood | v1.1 | 0/? | Not started | - |

---

## v2 Backlog

Ideas deferred from v1 that may become future phases.

| Item | Description | Deferred From |
|------|-------------|---------------|
| Pattern 7b Migration | Replace Pattern 7c atomic dual-write with parent-doc projected from non-revision text + revision-hole projections (no dual storage; every parent-doc position calc spans holes). | v1.1 |
| SQLite-as-Yjs-Persistence-Provider | Replace v1.1 SQLite seed/drain with a true Yjs persistence provider backed by SQLite. | v1.1 |
| Per-annotation `expand` config | Peritext-style mark semantics for per-annotation expansion behavior. | v1.1 |
| Loro `LoroTree` evaluation | Evaluate `loro-crdt` `LoroTree` as a Y.Map-of-Y.Map replacement if hierarchy hits a wall. | v1.1 |
| Y.Doc Subdocuments per Version | True subdoc-per-version with relay multiplexing. | v1.1 |
| Shared Document Mode | Server as source of truth, owner-independent sessions (Google Docs model). | Phase 6 (v1.0) |
| Presence/Cursors | Online status, follow mode (PRES-01 through PRES-04). Note: live cursor positions already implemented in Phase 6.5. | v1.0 scope |
| Sharing UI | Share links, permissions, revoke access (SHAR-01 through SHAR-04). | v1.0 scope |

---
*Roadmap created: 2025-04-16*
*v1.0 shipped: 2026-04-19*
*v1.1 phases added: 2026-04-19*
