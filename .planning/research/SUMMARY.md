# Project Research Summary

**Project:** Quillium v1.1 — PRE-V2 Annotation Sync Re-architecture
**Domain:** CRDT ↔ editor binding (Yjs ↔ CodeMirror 6 annotationField)
**Researched:** 2026-04-19
**Confidence:** HIGH

> Companion docs: [STACK.md](./STACK.md) · [FEATURES.md](./FEATURES.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [PITFALLS.md](./PITFALLS.md)

---

## Executive Summary

Quillium v1.0 Phases 9–13 chased a recurring bug class — comment positions rotting on remote rebuild, decorations missing until a "switch once" interaction, Cmd-z reverting past connect, version-switch destroying annotations on the joiner — through escalating patches (origin tagging, `revisionsWithExplicitEffect` escape hatch, diff-and-reconcile, full rebuild on remote change). All four researchers converge on a single root cause: **dual source of truth.** The CodeMirror `annotationField` and the Yjs `Y.Map` are both authoritative writers, with `annotationField.update()` Phase 3 (`pushDocToVersionState`) acting as a third implicit source by pulling parent doc slices into version state on every flush. As long as both sides can author, every fix is a guard against an interleaving the next change will re-open.

The industry-validated fix — shipped in production by **BlockSuite** and reflected in **y-prosemirror**'s `ySyncPlugin` — is to make the CRDT the single root and demote the editor state to a pure projection. Concretely: every user mutation writes Yjs first inside `ydoc.transact(fn, "local")`; a single `observeDeep` callback derives `annotationField` from the Y tree and dispatches `addAnnotation`/`removeAnnotation`/`updateThread` effects with `yjsAnnotationSync` + `addToHistory.of(false)`. Phase 3 is **deleted, not gated.** Annotations are anchored via `Y.RelativePosition` so they never lose their referent through remote remaps. Each revision version becomes its own isolated Y type (Y.Array<Y.Map> with own Y.Text per version), giving character-level merge inside versions and recursing cleanly to nested-in-nested editors. Undo moves entirely to `Y.UndoManager` for the joiner view; CM `history()` is removed from the collab extension stack.

Risk profile: **low conceptually, medium operationally.** The pattern has production references; the work is a bounded refactor of ~8 files (`yjsAnnotations.ts` rewritten as observer-only, `annotationField.ts` Phase 3 deleted, `NestedEditorController.ts` flush pathways deleted, all annotation effect call sites converted to commands that write Yjs). The two real hazards are (a) atomic dual-write between parent Y.Text slice and active version Y.Text inside one `ydoc.transact` (Pattern 7c — needs a prototype before commit) and (b) test infrastructure: a deterministic `flushAll(...peers)` helper must exist before any sync-layer code is written, or the regression suite will be flaky and useless.

---

## Key Findings

### Recommended Stack

**No new dependencies.** Every library needed is already installed; the milestone is a discipline change inside existing code.

- **Keep:** `yjs ^13.6.30`, `y-protocols ^1.0.7`, `y-websocket ^3.0.0`, `@codemirror/{view,state,commands}`, `zod ^4.3.6`, custom `yjsBinding.ts` (preserve verbatim — its Y.Text↔CM pattern is the template for the new annotation binding).
- **Reject:** `y-codemirror.next` (stable 0.3.5 only binds Y.Text, not annotations; explicitly warns absolute index sync is not guaranteed for comment-style features), `@automerge/automerge`, `loro-crdt` (both = wholesale CRDT swap, out of scope; log Loro's `LoroTree` as a v2 candidate), Y.Doc subdocuments per version (relay protocol changes + cross-doc position encoding break — defer), Y.XmlFragment (no payoff over Y.Map for our shape).
- **Schema change (only):** Replace `versions: Y.Map<string-of-index, Y.Map>` with `versions: Y.Array<Y.Map>` for proper concurrent-insert CRDT semantics. Per D-94 (no legacy wire format) this is a clean break.

**Confidence:** HIGH (verified against npm metadata + GitHub + Context7 on 2026-04-19).

### Expected Features (table-stakes patterns for v1.1)

**Must adopt (the 6):**
- **T1 — `Y.RelativePosition` for anchors.** Each annotation's `from`/`to` lives as rel-pos in the Y.Map; resolve to CM offsets only at render time. Eliminates remote-rebuild position rot.
- **T2 — Derive decorations from Yjs on every update.** ViewPlugin rebuilds DecorationSet from Y.Map state each `update()`, not from a cached StateField shape. Eliminates "switch once to render."
- **T3 — Per-revision-version isolated Y type** (Y.Array<Y.Map> element with own Y.Text). Character-level merge inside versions; scope isolation across versions; recurses for infinite nesting.
- **T4 — Yjs is single source of truth; `annotationField` is derived projection.** PROJECT.md principle is industry standard (BlockSuite, y-prosemirror).
- **T5 — Provider `onSynced` triggers explicit annotationField rebuild** so joiners don't see "no decorations until I type."
- **T6 — `Y.UndoManager` scope covers the annotations Y.Map, not just Y.Text.** Fixes Cmd-z reverts past connect.

**Differentiator (uniquely Quillium):** Multi-version revisions modeled as `Y.Array<Y.Map>` with each version independently editable, character-level mergeable, and supporting nested annotations recursively. No shipping editor has this — closest analogs (Google Docs Suggestions, VCS branches) are single-alternative or heavyweight.

**Defer (v2+):** Per-annotation `expand` config (Peritext-style mark semantics), Loro migration, true subdoc-per-version with relay multiplexing, SQLite-as-Yjs-persistence-provider.

**Anti-features (do not build):** Separate annotation broadcast channel parallel to Y.Doc (reintroduces dual SOT), serialized annotation blob into Y.Map value (current v1.0 — root cause of thread-append collisions), LWW-per-block text, ProseMirror migration.

### Architecture Approach

**Adopt Pattern 1 (Derived State / CRDT-as-root) + Pattern 7c (atomic dual-write inside one `ydoc.transact("local")`) + Pattern 9b (SQLite seed/drain unchanged for v1.1).** Pattern 4 (y-prosemirror's `ySyncPlugin`) is the reference blueprint for shape, not a library to adopt.

**Major components after refactor:**
1. **`yjsAnnotations.ts` (rewritten)** — pure observer/projector. Owns `observeDeep`. Derives annotationField from Y tree. **All write code (`diffAndReconcile`, `syncAnnotationFields`, `syncRevisionVersions`, `syncVersionText`, `_syncInitialFromYjs`) deleted.** Has `unobserveDeep` matched to every `observeDeep` and `destroyed` checks at every microtask entry.
2. **`annotationField.ts` (slimmed)** — Phase 3 (`pushDocToVersionState`) deleted; `_updateRevisionVersionDoc`, `revisionsWithExplicitEffect` deleted. Reducer applies only `addAnnotation`/`removeAnnotation`/`updateThread` effects dispatched by the projector.
3. **New `commands.ts`** — every former CM-effect mutator becomes a Yjs-write command (`createRevisionCommand`, `appendThreadMessageCommand`, `switchActiveVersionCommand`, `addVersionCommand`, …). User actions never dispatch annotation effects directly.
4. **`NestedEditorController.ts` (slimmed)** — `flushToParent`, `flushAnnotationStateToParent`, `_lastMountedBlob`, `_lastDispatchedDoc`, `syncFromParent` all deleted. Nested view binds via `createYjsBinding` to the version's Y.Text. Version switch = destroy binding + rebind.
5. **`yjsBinding.ts` (extended)** — for nested case only, also writes the parent Y.Text slice inside the same `ydoc.transact` as the version Y.Text write. This is Pattern 7c.
6. **`annotationSchema.ts` (small change)** — `versions` field becomes `Y.Array<Y.Map>` instead of index-keyed Y.Map.

### Critical Pitfalls (top 6)

1. **Dual source of truth (P2 / F-6, S1·L1)** — the meta-bug. **Prevention:** Top-of-file invariant comment in `yjsAnnotations.ts` declaring Yjs canonical; property test asserting `yjsAnnotationToCodeMirror(yMap) === annotationField` after every microtask flush.
2. **Phase 3 corruption on remote rebuild (F-1, S1·L1)** — `pushDocToVersionState` reads `doc.sliceString` and clobbers Y.Text-derived version text on remote-originated rebuilds. **Prevention:** Delete Phase 3 entirely. Invariant: a remote-originated transaction must never read parent doc to write version state.
3. **Feedback loops via missing/wrong origin tag (P1, S1·L1)** — without all four guards (transact `"local"` origin, observer `tr.origin === "local"` skip, CM dispatch carries `yjsAnnotationSync.of(true)` + `addToHistory.of(false)`, `update()` first-line annotation skip), every keystroke produces 2/4/∞ updates. **Prevention:** All four guards are non-negotiable; first test asserts ≤ N Yjs updates for N keystrokes.
4. **CM `history()` coexisting with Y.UndoManager (P5 / F-5, S2·L1)** — joiner Cmd-z walks into pre-connect state. **Prevention:** Joiner collab view extension stack has NO `history()`. Test: `view.state.field(historyField, false) === undefined`.
5. **Version switch racing rebuild (P4 / F-3, S1·L1)** — destroy + rebuild + observer microtask race deletes annotation on joiner. **Prevention:** Version switch is data-only; never tear down annotation on switch; rebuild = single batched `{remove, add}` dispatch; `NestedEditorController.destroy()` must not fire `removeAnnotation`.
6. **Initial seeding double-write (P11, S1·L2)** — owner + joiner both run `_syncInitialToYjs` → annotations duplicate. **Prevention:** D-100 separate joiner view with empty initial annotationField; assertion in harness.

Plus: **Test flakiness from microtask scheduling (P14)** — write `flushAll(...peers)` helper *before* any other test. Three flushes is current safe default for our two-`queueMicrotask` architecture.

---

## Implications for Roadmap

The four researchers proposed 6 / 6 / — / 10 phases respectively. Reconciled into a single 9-phase ordering below. Roadmapper has final say; this is starting guidance.

### Critical Architectural Decisions Requirements Phase Must Settle

Deduplicated across all 4 researchers — these block design and must land in v1.1 REQUIREMENTS:

1. **Pattern 7c mechanics for atomic parent-slice ↔ version Y.Text sync.** When the nested editor binding writes `versionYText`, how is the corresponding parent Y.Text slice computed and written in the same `ydoc.transact`? Needs a prototype test before committing.
2. **Y.Array vs Y.Map(index) for versions, and stability of element identity across reorder.** Confirm `_updateRevisionVersionLabel` semantics survive Y.Array reordering.
3. **Undo/redo in collab mode: Y.UndoManager only, or hybrid with `invertedAnnotationFieldEffects`?** Hypothesis: UndoManager owns it; `invertedAnnotationFieldEffects` is bypassed in collab. Explicit `_restoreAnnotation` on implicit text deletion must still propagate to remote peers.
4. **Initial-sync gating: two-gate (Y.Text synced AND Y.Map synced) before annotationField rebuild fires.** Today decorations missing until switch-once is partly an initial-sync race.
5. **Local-only mode: always instantiate Y.Doc, or branch on collab flag?** Recommendation: always — one code path. Cost is small; benefit is no "local vs collab" branching in sync layer.
6. **Persistence seed/drain for v1.1.** Pattern 9b: load annotationField JSON → seed Y.Doc via `codeMirrorToYjsAnnotation` → Y is authoritative thereafter → drain back to JSON on session end. Confirm seed path; confirm RelativePositions are persisted via binary `Y.encodeRelativePosition`, not JSON (yjs#340).
7. **`activeVersionIndex` storage: numeric index vs stable version ID.** Numeric index is fragile under concurrent version add by two peers. For v1.1 if version add is owner-only, low risk; if not, switch to `activeVersionId: string`.
8. **Pattern 7b vs 7c.** 7b (parent doc projected from non-revision text + revision-hole projections) is strictly cleaner — no dual storage — but every parent-doc position calculation must span holes. Decision: **7c for v1.1**, 7b is v2 candidate.

### Proposed Phase Ordering

Order is dependency-driven: invariants and harness first; the architectural pivot (single SOT) before the surface refactors that depend on it; the highest-risk deletion (Phase 3) only after the read/write paths are unified; then targeted hardening and validation.

#### Phase 1 — Test Harness & Invariants
**Rationale:** Every later phase asserts behavior across two peers. Without a deterministic `flushAll`, the regression suite is flaky and useless (P14). Invariant comments and lint hooks make the canonical-source decision permanent (P2 declaration).
**Delivers:** `flushAll(...peers)` helper; feedback-loop test (P1 — peer A types N chars, asserts ≤ N Yjs updates); convergence property test stub (passes against current code as baseline); top-of-file invariant comments in `yjsAnnotations.ts`; optional lint rule banning `_<specific>`-effect imports in sync plugin.

#### Phase 2 — Joiner View Hardening (D-100 Solidify)
**Rationale:** Removes pre-connect history pollution and dedup-on-seed bug class before the architectural rewrite, so later phases test against a clean joiner. Independent of single-SOT work; can land first.
**Delivers:** Joiner collab `EditorView` has no `history()` extension and empty initial annotationField; owner `_syncInitialToYjs` guarded against re-entrance; tests for Cmd-z no-op on fresh joiner and annotation count = 3 (not 6) after owner=3 + joiner connects.
**Addresses pitfalls:** P5/F-5, P11.

#### Phase 3 — Unified Write Path (CM → Yjs as Commands)
**Rationale:** Replaces effect-by-effect sync with command-based Yjs-first writes. Must precede Phase 4 (read path can't be the only writer until the old write path is gone).
**Delivers:** New `commands.ts` with `createAnnotationCommand`, `appendThreadMessageCommand`, `switchActiveVersionCommand`, `addVersionCommand`, `deleteVersionCommand`, `updateVersionLabelCommand`, etc. All call sites that previously dispatched annotation effects converted. `diffAndReconcile` and the `_<specific>` effect branches deleted from sync plugin. Schema change: `versions` → `Y.Array<Y.Map>`.
**Addresses pitfalls:** P2/F-2.

#### Phase 4 — Unified Read Path (Yjs → CM as Projector)
**Rationale:** With writes flowing only into Yjs, the projector becomes the only path that updates `annotationField`. `_syncInitialFromYjs` merges with the normal observer path (no special case). T2 (decorations derived from Yjs) lands here.
**Delivers:** `yjsAnnotations.ts` rewritten as observer-only; observeDeep coalesces into a single dirty-set rebuild per microtask (handles yjs#591 ordering quirk); decoration ViewPlugin rebuilds from Y on every update; `requestMeasure`/explicit dispatch on `provider.on('sync')` for joiner hydration.
**Addresses pitfalls:** P7, P9, P10, F-4. **Implements features:** T2, T4, T5.

#### Phase 5 — Phase 3 Removal (highest-risk deletion)
**Rationale:** With single SOT in place, `pushDocToVersionState` is finally removable. The version body Y.Text becomes the sole writer for `versions[i].doc`. Expect to find surprise dependents — that's why it comes after read/write unification, not before.
**Delivers:** `pushDocToVersionState`, `_updateRevisionVersionDoc`, `revisionsWithExplicitEffect` deleted from `annotationField.ts`. Active-version Y.Text observer drives nested editor's CM doc. Pattern 7c atomic dual-write inside one `ydoc.transact` for parent-slice + version Y.Text.
**Addresses pitfalls:** F-1.

#### Phase 6 — Nested Editor Rewire & Version Switch Hardening
**Rationale:** `NestedEditorController` flush pathways are dead code once Phase 5 lands; remove them before they accidentally come back to life. Version switch race (F-3) is the most user-visible v1.0 bug; fix it on the new architecture.
**Delivers:** `flushToParent`, `flushAnnotationStateToParent`, `_lastMountedBlob`, `_lastDispatchedDoc`, `syncFromParent` deleted. Nested view binds via `createYjsBinding` to `versionYText`. Version switch = destroy-binding + rebind (data-only at the annotation level). Test: 2-peer harness with concurrent version-switch + edit converges.
**Addresses pitfalls:** F-3/P4, P15 (awareness scope).

#### Phase 7 — Position Anchoring (RelativePosition for annotation `from`/`to`)
**Rationale:** T1 implementation. Annotations gain stable anchors that survive remote remap. Fixes the long-tail of "collapsed range" bugs. Persistence must use binary encoding (P3 / yjs#340), so this also touches the SQLite serializer.
**Delivers:** Annotation Y.Map stores `relFrom`/`relTo`; projector resolves to CM offsets per render. Persistence uses `Y.encodeRelativePosition` (binary), with null-`item` fallback for end-of-text positions. Test: annotate last char, encode→decode, range still at end.
**Addresses pitfalls:** P3. **Implements features:** T1.

#### Phase 8 — Detached-Type Audit & Integrity
**Rationale:** Cleanup pass — every `new Y.Map()` / `new Y.Text()` site must be inside a `ydoc.transact` that immediately attaches to parent (P8 / yjs#666, yjs#210). Cheap to do, catches a category of latent bugs.
**Delivers:** Audit report; helper for safe construct+attach; test that exercises the trap.
**Addresses pitfalls:** P8, P16.

#### Phase 9 — Convergence Fuzz & Dogfood
**Rationale:** Final validation. Property-based fuzz over random local-effect sequences on both peers; assert convergence after `flushAll`. Cross-peer undo (P6) validated end-to-end. Svelte runes audit (P13) — no `$state(yType)`. Awareness scope (P15) — only top-level view registers awareness.
**Delivers:** 10k-op convergence fuzz green; UndoManager `captureTimeout` tuned (start at 0, raise only with evidence); dogfood checklist passed across two devices.
**Addresses pitfalls:** P2, P6, P13, P15.

#### Research Flags

Phases likely needing deeper research during planning:
- **Phase 5** — highest-risk deletion. Audit all `pushDocToVersionState` callers and implicit dependents before writing; expect surprises.
- **Phase 7** — must audit current persistence path for JSON-encoded RelativePositions (yjs#340 trap). If found, becomes a small data migration.
- **Phase 4** — yjs#591 event-ordering quirk. Write a targeted test before building the unified read path; confirm `observeDeep` event order matches our coalescing assumption.

Phases with established patterns (skip dedicated research):
- **Phase 1, 2, 3, 8, 9** — pattern is well-defined; proceed straight to design.

### Non-Negotiable Invariants (true at every phase boundary)

These appear at the top of `yjsAnnotations.ts` and gate every PR:

1. **Yjs is canonical.** `annotationField` is a projection. No code path writes annotation state to `annotationField` outside the projector dispatch.
2. **Single write path.** CM → Yjs goes through `commands.ts`. The sync plugin contains zero `.is(<specific effect>)` branches.
3. **Single origin discipline.** Local Yjs writes use `ydoc.transact(fn, "local")`. Observer first line: `if (tr.origin === "local") return`. Remote CM dispatches carry `yjsAnnotationSync.of(true)` AND `Transaction.addToHistory.of(false)`. ViewPlugin `update()` first line: skip if any tx carries `yjsAnnotationSync`.
4. **Joiner view is clean.** No CM `history()` extension. Empty initial annotationField. Empty initial Y.Map. Distinct EditorView instance from any pre-connect view.
5. **Observer lifecycle is matched.** Every `observeDeep` has a stored function reference and a matching `unobserveDeep` in `destroy()`. Every `queueMicrotask` callback checks `this.destroyed` first.
6. **Y types are integrated before read.** `parentMap.set(key, child)` in the same `ydoc.transact` that constructs `child`. No detached-type access.
7. **No Phase 3.** A remote-originated transaction never reads parent doc to write version state. (Enforced by Phase 5 onward.)
8. **RelativePositions persist as binary.** Never JSON-round-tripped (yjs#340).

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | npm + GitHub + Context7 all verified 2026-04-19; no new deps; one targeted schema change (Y.Map→Y.Array for versions) |
| Features | HIGH on Yjs-adjacent patterns (y-prosemirror, BlockSuite, Tiptap, Peritext); LOW on shipped multi-version-revision precedent (genuinely novel — D1 is our design) |
| Architecture | HIGH — production reference (BlockSuite) for Pattern 1; y-prosemirror for sub-tree mapping; codebase verified including 09/10/11 prior-phase decisions |
| Pitfalls | HIGH on Quillium-specific failures (direct code + 09-CONTEXT read); MEDIUM-HIGH on generic Yjs traps (linked to upstream issues with matching symptoms) |

**Overall confidence:** HIGH.

### Gaps to Address During Planning

- **Pattern 7c prototype.** Atomic parent-slice ↔ version Y.Text dual-write inside one `ydoc.transact` has not been prototyped. Build a minimal two-peer test in Phase 1 or 2 that exercises the round-trip; design depends on whether the slice translation works cleanly via RelativePosition encoding.
- **`activeVersionIndex` semantics under concurrent version add.** Decision pending — index vs stable ID. Cheap to make safe (string ID); deferred only if version add stays owner-only.
- **`observeDeep` event order during multi-mutation transactions.** yjs#591 says ordering can be counter-intuitive. Our current code reads-all-then-rebuilds-once (correct pattern); Phase 4 must preserve and test this.
- **Persistence migration for RelativePositions.** Audit current snapshot format; if RelativePositions are JSON-encoded today, plan a binary migration in Phase 7.
- **Loro as v2 candidate.** Out of scope for v1.1; log decision and revisit if Y.Map-of-Y.Map hierarchy hits a wall.

---

## Sources

### Primary (HIGH confidence)
- [BlockSuite — CRDT-Native Data Flow](https://block-suite.com/blog/crdt-native-data-flow.html) — production reference for Pattern 1
- [yjs/y-prosemirror](https://github.com/yjs/y-prosemirror) — reference binding shape; issues #49, #85, #113
- [Yjs docs — RelativePosition](https://docs.yjs.dev/api/relative-positions), [Subdocuments](https://docs.yjs.dev/api/subdocuments), [UndoManager](https://docs.yjs.dev/api/undo-manager)
- [yjs/yjs issues #210, #273, #327, #340, #591, #642, #657, #666](https://github.com/yjs/yjs/issues) — pitfall sources
- Context7: `/yjs/docs`, `/loro-dev/loro` (verified 2026-04-19)
- npm metadata 2026-04-19: yjs 13.6.30, y-codemirror.next 0.3.5 (frozen since 2024-06-18), @automerge/automerge 3.2.5, loro-crdt 1.11.0
- Quillium code: `yjsAnnotations.ts`, `yjsBinding.ts`, `annotationSchema.ts`, `annotationField.ts`, `NestedEditorController.ts`
- Quillium prior research: `09-CONTEXT.md` (D-100…D-110), `09-RESEARCH.md`, `10-REVIEW.md` (IN-01 dead code), `11-RESEARCH.md`

### Secondary (MEDIUM confidence)
- [Liveblocks 1.6 subdocs guide](https://liveblocks.io/blog/liveblocks-1-6-introducing-yjs-subdocuments-support), [Hocuspocus multi-subdocuments](https://tiptap.dev/docs/hocuspocus/guides/multi-subdocuments)
- [Peritext](https://www.inkandswitch.com/peritext/), [Automerge 2.2 rich text](https://automerge.org/blog/rich-text/), [Loro rich text](https://loro.dev/blog/loro-richtext)
- [discuss.yjs.dev — Initial Data Duplication](https://discuss.yjs.dev/t/issue-with-initial-data-duplication-in-collaborative-editor/2170), [deepObserve subdocuments](https://discuss.yjs.dev/t/how-to-deepobserve-subdocuments/1555)
- Project memory: `project_collab_revision_version_bugs`, `project_yjs_relay_architecture`, `feedback_convergence_debugging`

### Tertiary (LOW confidence — context only)
- [Notion data model](https://www.notion.com/blog/data-model-behind-notion), [Figma multiplayer](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/) — used to rule out anti-patterns, not as positive references
- Svelte 5 runes semantics (P13 inferred, no direct Yjs+Svelte5 post-mortem found)

---
*Research completed: 2026-04-19*
*Ready for roadmap: yes*
