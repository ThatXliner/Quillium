# ARCHITECTURE Research — Single Source of Truth Sync (Quillium v1.1)

**Researched:** 2026-04-19
**Scope:** Re-architecture of the `annotationField` ↔ Yjs layer ONLY. CodeMirror and Yjs are locked.
**Confidence:** HIGH (primary pattern has a battle-tested production reference — BlockSuite — and y-prosemirror for sub-tree mapping).

---

## Context: Why v1.0 Architecture Failed

### The dual-source-of-truth anti-pattern

v1.0 stores annotation state in **two** authoritative locations:

1. `annotationField: StateField<Annotations>` — a plain JS map `{ id: GenericAnnotation }` inside the CodeMirror state. This is the object every UI component, decoration ViewPlugin, nested editor, persistence layer, and undo stack reads from.
2. `scopeAnnotations: Y.Map<YjsAnnotationNode>` — a recursive Yjs tree with child Y.Text per version, Y.Array per thread, and a nested `annotations` Y.Map for sub-annotations.

There is no declared primary. `createAnnotationSyncPlugin` tries to be bidirectional with loop prevention via origin tagging (`"local"` on Yjs, `yjsAnnotationSync` annotation on CM). Every Phase 8–13 patch added more guards; each guard widened the surface for new edge cases.

**Three observed failure modes (phases 09-13):**

- **Phase 3 (`pushDocToVersionState`) corruption on remote rebuild.** `annotationField.update()` has a Phase 3 that pulls the parent doc slice for the active revision into `versions[activeVersionIndex].doc`. When a remote peer applies `observeDeep` and rebuilds the annotation via `addAnnotation.of(rebuilt)`, the new annotation's version text is authoritative (came from Y.Text). But if the parent doc changed in the same flush, Phase 3 immediately overwrites it with stale parent-slice text. The v1.0 fix added `revisionsWithExplicitEffect` to skip Phase 3 for freshly-added revisions (see `annotationField.ts:633-635`) — but this is an escape hatch, not a principled design.
- **First-version-switch destroys annotation on joiner** (bug #2, phase 09). The CM-side version-switch effect races the Yjs observer; an intermediate CM state is written back to Yjs, then observer fires and rebuilds with stale version text.
- **Subtree contamination during nested edit flush** (see `NestedEditorController.flushToParent:373-381`). The comment documents the hazard verbatim: "If the parent already switched to a different version, syncFromParent may have contaminated this editor with the NEW version's text, collapsing sub-annotation ranges. Flushing now would overwrite the old version's annotations with the corrupted state."

### What Phases 10–11 tried and why they weren't enough

Phase 10 stripped per-effect branching and subtree bindings; Phase 11 rebuilt with a "single diff-and-reconcile write path" (`yjsAnnotations.ts:286-338`) + "full rebuild on remote change" (`yjsAnnotations.ts:147-170`). This removed per-effect divergence but **did not change which side is authoritative**. `annotationField` is still written to by Phase 1/2/3, diffed on every update, and rebuilt wholesale from Y on remote changes. Phase 3 still runs after remote rebuilds (mitigated only by `revisionsWithExplicitEffect`). The two-world problem was narrowed, not eliminated.

**Key insight:** As long as `annotationField` can be mutated by user effects without going through Yjs first, and Yjs can be mutated by remote peers without going through the CM state first, there are two roots and reconciliation is perpetual.

---

## Pattern Catalog

### Pattern 1 — Derived State / CRDT-as-Single-Root (RECOMMENDED)

**Source:** [BlockSuite by Toeverything](https://block-suite.com/blog/crdt-native-data-flow.html) — a production block-based editor whose core architectural principle is: YDoc is the only model; the editor state is a pure projection. From their docs: *"application-layer code can completely ignore whether updates to the block model come from local editing, history stack, or collaboration with other users."*

**Description:**
1. All mutations — local keystrokes, effects, remote updates, undo — write to Yjs first.
2. A single `observeDeep` (or per-type observe) callback derives the CM `annotationField` from the Y tree.
3. CM effects become *commands*: they compute Yjs operations and apply them inside `ydoc.transact(..., "local")`. They do **not** mutate `annotationField` directly.
4. The observer-driven dispatch applies the resulting derived state back to `annotationField` via `addAnnotation` / `removeAnnotation` effects.

**Quillium fit:**
- Cleanly dissolves Phase 3 — `annotationField` no longer "pulls" text from the parent doc, because `versions[i].doc` is derived from Y.Text. No pull phase means no corruption.
- Version switching, thread append, and version text edits all flow through one write path.
- Nested editors preserved: the nested EditorView still binds to `versions[activeIdx].text` Y.Text via `createYjsBinding`, exactly as `yjsBinding.ts` already does for the top-level doc. `NestedEditorController` becomes a lifecycle/DOM manager — it owns subtree binding creation/destruction, not a parallel annotation flush pathway.
- Offline preserved: Yjs is the source of truth even without a network provider; SQLite event log or y-indexeddb are additive persistence providers. Yjs already works fully offline.

**Tradeoffs:**
- Every user command that previously dispatched a pure CM effect now needs a Yjs-write command wrapper. One-time refactor of roughly 15–25 command sites (effect handlers in `annotationField.ts:626-728`).
- The annotationField reducer becomes trivial: apply `addAnnotation`/`removeAnnotation`/`updateThread` effects and nothing else. All existing computation (Phase 1/2/3) moves into the Yjs→CM projector.
- Undo becomes Y.UndoManager-driven universally. CM's historyField still handles pure doc edits (when they happen through `yjsBinding`), and `yjsUndo.ts` already handles this path.

**Complexity:** MEDIUM. Big refactor, but conceptually straightforward once commands are inverted.

**Risk:** LOW — BlockSuite, y-prosemirror (`ySyncPlugin`), and SyncedStore all ship this pattern in production.

### Pattern 2 — Dual-write with Generation Counter

**Source:** Seen in React-Redux optimistic systems (Apollo Client's optimistic response cache); Automerge's actor-seq vector numbers internally.

**Description:** Each mutation carries a monotonic counter per client; staler writes are rejected at merge time.

**Quillium fit:** Poor. This adds bookkeeping on top of the existing dual-write problem; it does not remove the dual root. Yjs already has internal Lamport clocks per Item. Layering another generation counter is duplicative and wouldn't solve Phase 3 corruption.

**Complexity:** MEDIUM. **Risk:** HIGH — adds yet another invariant to maintain. **Verdict:** Reject.

### Pattern 3 — Effect Sourcing at the Y Layer

**Source:** Variant of event sourcing; see [Yjs community discussion](https://discuss.yjs.dev/t/easy-to-understand-explanation-of-how-yjs-works/2835) describing Y's events-as-source-of-truth model.

**Description:** Each CM transaction maps to one or more Yjs operations; the StateField is re-derived from Y after every op.

**Quillium fit:** This IS Pattern 1, framed differently. Practically equivalent; Pattern 1's framing is clearer because it forces command call-sites to declare intent. **Verdict:** Fold into Pattern 1.

### Pattern 4 — y-prosemirror Architecture (Reference Blueprint)

**Source:** [yjs/y-prosemirror](https://github.com/yjs/y-prosemirror) — the reference collaborative binding for ProseMirror.

**Key mechanic:**
- A single `Y.XmlFragment` represents the entire document tree (nodes, marks, attributes).
- `ySyncPlugin` installs an observer on the XmlFragment and applies Y events as ProseMirror transactions; it translates local PM transactions into XmlFragment mutations.
- A `mapping` object (WeakMap from PM nodes to Y types) maintains position translation. This lets PM and Y positions round-trip without drift.
- **The PM doc is a projection** — recomputed from the Y tree after every Y event. PM never mutates without a corresponding Y op.

**Quillium fit:**
- Confirms Pattern 1 is the correct shape. PM→Y mapping via WeakMap is the analogue of Quillium's `AnnotationIdMap` (already implemented).
- Validates storing Y.Text *directly inside annotation nodes* (rather than keeping a separate Y.Text-keyed-by-id map): y-prosemirror stores Y types inline in the XmlFragment tree.
- Validates: the observer drives the PM/CM dispatch, never the other way around.

**Verdict:** Architectural blueprint. We don't need `Y.XmlFragment` (CodeMirror 6 is flat text, not a tree), but the shape — Y tree → editor state projection — applies directly.

### Pattern 5 — Yjs Subdocuments for Isolation

**Source:** [Yjs Subdocuments docs](https://docs.yjs.dev/api/subdocuments), [Liveblocks guide](https://liveblocks.io/docs/guides/how-to-use-yjs-subdocuments).

**Description:** Each revision version could be its own Y.Doc, embedded in the parent doc as a subdoc.

**Quillium fit:** Poor.
- **Pro:** Isolated undo per subdoc; lazy load.
- **Con (fatal):** "Subdocuments are independent — you lose all atomicity across document boundaries." We need version switch + annotation mutation to be atomic.
- **Con:** Relay (`quillium-landing/relay`) would need multi-doc support. Scope creep.
- **Con:** y-websocket needs custom plumbing to sync subdocs.

**Verdict:** Reject for v1.1. Reconsider if per-version history becomes a v2 feature.

### Pattern 6 — "Living" Y Types in the StateField

**Description:** Store live `Y.Text` / `Y.Map` references inside `annotationField` entries. CM state becomes a view over Yjs references.

**Quillium fit:** Tempting but problematic.
- **Pro:** Eliminates diff — CM state literally contains Yjs pointers.
- **Con:** CodeMirror's `StateField` must be serializable (`toJSON`/`fromJSON`). Y types are not JSON-serializable or immutable. Persistence (`savedFields`) breaks.
- **Con:** Y type lifecycle is tricky to reason about across CM's immutable StateField.
- **Con:** Undo via CM historyField would store Y references, which Yjs can GC independently. Dangerous.

**Verdict:** Reject. Keep `annotationField` as plain JS (projected from Yjs); Y types live in the Y tree only.

### Pattern 7 — Phase 3 Elimination via Y.Text Ownership of Version Text

**Source:** Derivation from Pattern 1 + `yjsBinding.ts` existing mechanics.

**Description:** The active version's text IS a Y.Text. A nested EditorView (via existing `createYjsBinding`) binds directly to that Y.Text. The parent CM doc's range that corresponds to the revision's `selection` stays in sync via a Y-level write. Source of truth is the version's Y.Text + parent Y.Text, both inside Yjs.

**How Phase 3 dies:** There is no "pull parent doc into version.doc" because `version.doc` is a computed property:
```
version.doc = versionYText.toString()  // derived on projection, never stored canonically in annotationField
```
Remote rebuilds do not trip over stale parent text because the projection re-derives from Y every time.

**Sub-options considered:**
- **7a.** Parent Y.Text owns flat text; annotation's Y.Text is a parallel mirror of the slice. Two Y.Texts to sync — dual-source moved down one level. REJECT.
- **7b.** Parent Y.Text owns only non-revision text; revision regions are "holes" filled by projecting `versions[activeIdx].text`. Radically clean but every cursor position must be translated across hole boundaries. Too invasive for v1.1.
- **7c (RECOMMENDED).** Parent Y.Text owns full flat text as today. Each revision annotation has a `versions` Y.Map with per-version Y.Text. The active version's Y.Text is kept in sync with the parent Y.Text slice **inside a single `ydoc.transact("local")` — atomic on the Yjs side**. Remote peers receive both deltas atomically. No CM/Y boundary-crossing reconciliation.

**Complexity:** MEDIUM. **Risk:** MEDIUM. **Verdict:** 7c.

### Pattern 8 — Position Anchors

**Source:** [Yjs RelativePosition docs](https://docs.yjs.dev/api/relative-positions).

**Current state:** Already using `RelativePosition` (`src/lib/collab/relativePosition.ts`). The "stale anchor" complaint in the question is a red herring — RelativePosition by design survives concurrent edits because it references the Y.Item, not an offset. What went stale is the *decoded* `EditorSelection` cached in `annotationField` when CM mutated out-of-band with Yjs.

**Fix under Pattern 1:** Selection is decoded *from* RelativePosition *every* time the projector runs — cannot go stale by construction.

### Pattern 9 — Offline + Online Coexistence

**Source:** [Yjs offline support](https://docs.yjs.dev/getting-started/allowing-offline-editing), [Tiptap offline support](https://tiptap.dev/docs/guides/offline-support).

**Key insight:** Yjs runs fully offline — a Y.Doc is a pure data structure that does not require a network provider. y-indexeddb and y-websocket compose cleanly. Two options for Quillium:

- **9a (future).** SQLite as a Yjs persistence provider — persist `Y.encodeStateAsUpdate` deltas to SQLite events; snapshots are full-state encodings. Matches existing event-log + snapshot model 1:1.
- **9b (v1.1).** Keep existing SQLite annotationField-JSON persistence. On collab start, seed Y.Doc from loaded annotationField; thereafter Yjs is authoritative. On collab end, project the final Y state back to annotationField and persist as today.

**Recommendation:** 9b for v1.1 (sync layer only per PROJECT.md). Design APIs so 9a is a later drop-in.

---

## Comparative Analysis

| Pattern | Complexity | Risk | Preserves Nested-Editor UX? | Solves Phase 3 Corruption? | Solves First-Switch Destroy? | Preserves Offline? |
|---------|-----------|------|-----------------------------|-----------------------------|-------------------------------|---------------------|
| 1. Derived State (CRDT-as-root) | MED | LOW | Yes | **Yes** — no pull phase exists | **Yes** — no CM-side race | Yes |
| 2. Generation counter | MED | HIGH | Yes | No | Partial | Yes |
| 3. Effect sourcing | MED | LOW | Yes | Yes | Yes | Yes (= Pattern 1) |
| 4. y-prosemirror reference | — | — | — (reference) | Yes | Yes | Yes |
| 5. Subdocuments | HIGH | MED | Partial (atomicity loss) | Yes | Yes | Yes (complicated) |
| 6. Living Y refs in StateField | HIGH | HIGH | Yes | Yes | Yes | **No** (serialization breaks) |
| 7c. Y.Text owns version text | MED | MED | Yes | **Yes** | **Yes** | Yes |
| 9b. SQLite JSON seed/drain | LOW | LOW | Yes | N/A | N/A | Yes |

---

## Recommended Architecture

**Adopt Pattern 1 (Derived State) + Pattern 7c (Y.Text owns version text, atomic dual-write inside Yjs transaction) + Pattern 9b (SQLite seed/drain, unchanged persistence for v1.1). Pattern 4 is the reference blueprint.**

### Guiding principle

> Yjs is the single source of truth for all annotation data. `annotationField` is a pure projection of the Yjs tree. The only way to mutate annotation state — including from user actions — is to write to Yjs. The only way annotation state reaches the CM view is through the Yjs observer.

### What changes vs. today

| Subsystem | Today | After v1.1 |
|-----------|-------|-----------|
| `annotationField.update()` | 3 phases: remap / effects / pushDoc | 1 phase: apply `addAnnotation`/`removeAnnotation`/`updateThread` effects dispatched by the projector. **Phase 3 deleted; Phase 1 remap kept only for non-revision annotations' local fallback (may also be deletable).** |
| `addAnnotation.of(x)` by user | Mutates annotationField directly | Dispatched **only** by the projector. User commands call new `createAnnotationCommand(view, spec)` that writes to Yjs. |
| `updateThread.of` by user | Mutates annotationField | Command writes message to Y.Array; observer dispatches `updateThread` on CM. |
| `_updateActiveRevisionVersion` etc. | Mutates annotationField, sync plugin diffs to Yjs | Command writes `node.set("activeVersionIndex", n)`; observer rebuilds annotation on CM. |
| Active revision version text | Parent doc owns; Phase 3 pulls into `versions[i].doc` | Parent doc slice and version Y.Text kept in sync inside **one `ydoc.transact("local")`** when the user edits. Projector derives `versions[i].doc` from Y.Text. |
| NestedEditorController | Creates nested view over `VersionState` blob; flushes serialized state to parent on mutation | Creates nested view bound to `versionYText` via `createYjsBinding`. No `flushToParent`; edits propagate through Yjs automatically. `syncFromParent` / `_lastDispatchedDoc` / `_lastMountedBlob` removed. Version switch = destroy binding + re-bind to new `versionYText`. |
| Persistence (SQLite event log) | Writes annotationField JSON blobs | Unchanged for v1.1. Seed Y.Doc from loaded state; drain Y state back on session end. |

### Data flow — local edit in nested (revision) editor

```
User types in revision's nested editor
        │
        ▼
Nested EditorView dispatch (doc changed)
        │
        ▼
createYjsBinding.update() — EXTENDED to also write parent slice
        │
        ▼
ydoc.transact("local") {                             <-- atomic across both
  versionYText.delete/insert         // active version
  parentYText.delete/insert          // parent slice at revision.selection
}
        │
        ▼  (y-websocket broadcasts one update to peers)
Local observers fire but:
  - parentYText.observe on parent view  → skipped (yjsAnnotation on the CM tx)
  - versionYText.observe on nested view → skipped (same)
  - observeDeep on scopeAnnotations     → skipped (tr.origin === "local")
```

### Data flow — remote edit (peer types in same version)

```
y-websocket applies update
        │
        ▼
parentYText.observe fires          versionYText.observe fires
        │                                  │
        ▼                                  ▼
parent yjsBinding dispatches       nested yjsBinding dispatches
CM changes to parent view          CM changes to nested view
        │
        ▼
observeDeep on scopeAnnotations fires (position remaps via RelativePosition)
        │
        ▼  queueMicrotask
Projector: for each changed annotation yjsKey
  - re-derive GenericAnnotation from Y node (version.doc = versionYText.toString())
  - dispatch removeAnnotation + addAnnotation on CM (addToHistory: false, yjsAnnotationSync)
        │
        ▼
annotationField now consistent with Y tree
```

### Data flow — local command (create revision)

```
User selects text, hits "revise"
        │
        ▼
createRevisionCommand(view, {from, to, initialVersions})
        │
        ▼
ydoc.transact("local") {
  node = codeMirrorToYjsAnnotation(...)   // existing helper
  scopeAnnotations.set(yjsKey, node)
}
        │
        ▼  (local observer fires)
observeDeep sees add
        │
        ▼  queueMicrotask
Projector dispatches addAnnotation.of(projected) with yjsAnnotationSync + addToHistory(false)
        │
        ▼
annotationField updated; decoration appears
```

Undo for annotation creation is captured by Y.UndoManager (wired in `yjsUndo.ts`), not CM's historyField. Mirrors how parent doc text undo works today.

### Component responsibilities after v1.1

| Component | Responsibility |
|-----------|---------------|
| `yjsBinding.ts` | Mostly unchanged. Extended for nested-editor case to also write the parent Y.Text slice inside the same `ydoc.transact`. Per-view. |
| `yjsAnnotations.ts` | Rewritten. Becomes the **projector**: owns `observeDeep`, derives annotationField from Y tree. Write path (`diffAndReconcile`, `syncAnnotationFields`, `syncRevisionVersions`, `syncVersionText`) deleted. |
| `annotationField.ts` | Slimmed. Delete Phase 3. Delete `_updateRevisionVersionDoc`, `pushDocToVersionState`, `revisionsWithExplicitEffect`. Keep `remapAnnotationSelections` as a fallback but evaluate for deletion (projector uses RelativePosition). |
| `NestedEditorController.ts` | Slimmed. Delete `flushToParent`, `flushAnnotationStateToParent`, `_lastMountedBlob`, `_lastDispatchedDoc`, `syncFromParent`. Version switch = destroy binding + create new binding against new `versionYText`. |
| `annotationSchema.ts` | Unchanged. `codeMirrorToYjsAnnotation` used by commands. `yjsAnnotationToCodeMirror` used by projector. |
| `AnnotationIdMap` | Unchanged. |
| New: `commands.ts` (or added to `annotationField.ts`) | Every former CM effect that mutated annotation state becomes a command that writes to Yjs: `createRevisionCommand`, `appendThreadMessageCommand`, `switchActiveVersionCommand`, `addVersionCommand`, `deleteVersionCommand`, `updateVersionLabelCommand`, `createCommentCommand`, `createSuggestionCommand`. |

### Phase cutover strategy (rough — roadmap builder finalizes)

1. **Foundation: remove Phase 3.** Delete `pushDocToVersionState`, `_updateRevisionVersionDoc`, `revisionsWithExplicitEffect` from `annotationField.update()`. Remove the Phase 3 selection-boundary block. Confirm local-only (non-collab) tests still pass; expect some will fail — those failures identify call sites that depend on implicit doc→version sync.
2. **Projector rewrite.** Rewrite `yjsAnnotations.ts` as observer-only. Delete `diffAndReconcile`, `syncAnnotationFields`, `syncRevisionVersions`, `syncVersionText`, `_syncInitialFromYjs`. Keep `_syncInitialToYjs` as the (now-mandatory) owner bootstrap.
3. **Commands.** Introduce command helpers for every annotation mutation. Replace direct `view.dispatch(addAnnotation.of(x))` call sites with `createAnnotationCommand(view, spec)`. Audit every `dispatch({ effects: [...] })` that touches annotation effects.
4. **Nested editors.** Rewire `NestedEditorController` to bind directly to `versionYText` via `createYjsBinding`. Delete flush pathways. Version switch becomes binding swap.
5. **Atomic parent-version sync.** Extend nested editor's `yjsBinding` to also update the parent Y.Text slice for the active revision inside the same transact. This closes the loop.
6. **Regression harness.** Port Phase 09/11/13 tests to new architecture. Convergence invariant is trivially true: one source.

---

## Open Questions

1. **Atomic dual-write inside Yjs transaction (Pattern 7c mechanics).** When the nested editor binding updates `versionYText`, how does it compute the corresponding parent Y.Text range? RelativePosition round-trips, but does the encoded slice span translate cleanly to a delete/insert on parent? Needs a prototype test before committing.
2. **Could we skip redundancy entirely (Pattern 7b)?** If the CM parent doc is *projected* from `parentYText (non-revision chunks) + versionYText (revision holes)`, duplicate storage disappears. Pattern 7c keeps redundancy for minimal churn. 7b is strictly simpler if viable — but every parent-doc position calculation (cursors, selections, decorations) must span holes. Likely too invasive for v1.1; revisit in v2. **Confirm at planning time.**
3. **Undo scoping.** Y.UndoManager `trackedOrigins: {"local"}` covers all user-visible mutations (doc text, annotations, thread, versions). Do we still need CM historyField in collab mode? Likely not. Out of collab (local-only session), CM historyField still runs. **Confirm at planning time.**
4. **SQLite persistence migration.** v1.1 keeps event log shape unchanged (Pattern 9b). Risk: stored annotationField JSON could diverge from projector output on load. Mitigation: on load, feed persisted annotationField JSON into `codeMirrorToYjsAnnotation` to seed a fresh Y.Doc; thereafter Y is authoritative. On session end, drain projected state back to JSON for persistence. Confirm seed path at planning time.
5. **Initial sync direction on join.** Today: owner's annotations are CM-authoritative and pushed to Yjs (`_syncInitialToYjs` is best-effort). Under Pattern 1 the owner's annotations must be in Yjs BEFORE the projector activates, or CM will be briefly empty. `enableCollab` becomes: load annotationField from SQLite → seed Y.Doc → attach projector → attach y-websocket. Required bootstrap, not best-effort.
6. **Per-annotation Y.Text observers vs observeDeep.** Phase 11 flagged this open (A1). Empirically Y.Events propagate up, so observeDeep on top-level `scopeAnnotations` should catch nested Y.Text changes — but needs concrete test coverage (extend `annotation-tree.test.ts` pattern) before relying on it as the only observation mechanism.
7. **Local-only (pre-collab) mode.** The refactor makes Yjs the SOT even for single-user local editing. Does the app always instantiate a Y.Doc, or only in collab mode? Simplest: always. Cost: ~small (Yjs docs with no peers are cheap). Benefit: one code path — no branching between "local mode" and "collab mode" in the sync layer.

---

## Sources

Primary (HIGH confidence):
- [BlockSuite — CRDT-Native Data Flow](https://block-suite.com/blog/crdt-native-data-flow.html) — production reference for Pattern 1.
- [yjs/y-prosemirror](https://github.com/yjs/y-prosemirror) — reference binding; validates Pattern 4/1 shape.
- [Yjs Subdocuments](https://docs.yjs.dev/api/subdocuments), [Liveblocks subdoc guide](https://liveblocks.io/docs/guides/how-to-use-yjs-subdocuments) — confirms Pattern 5 atomicity limitation.
- [Yjs offline support](https://docs.yjs.dev/getting-started/allowing-offline-editing), [y-indexeddb](https://github.com/yjs/y-indexeddb) — confirms Pattern 9a feasibility.
- [VERIFIED: codebase] `src/lib/collab/yjsAnnotations.ts`, `yjsBinding.ts`, `annotationSchema.ts`, `editor/plugins/annotations/annotationField.ts`, `NestedEditorController.ts`.
- [VERIFIED: `.planning/milestones/v1.0-phases/09-fix-live-collab-revision-editing-bugs/09-RESEARCH.md` and `11-unified-subtree-sync-rebuild/11-RESEARCH.md`] — documented decisions and constraints from prior spirals.
- [VERIFIED: `10-REVIEW.md`] — confirms `_updateRevisionVersionDoc` is dead code (IN-01), ready for deletion.

Secondary (MEDIUM confidence):
- [Yjs community — easy explanation](https://discuss.yjs.dev/t/easy-to-understand-explanation-of-how-yjs-works/2835) — event-sourcing framing.
- [Tiptap offline support](https://tiptap.dev/docs/guides/offline-support) — real-world offline-online pattern.

Project memory (HIGH confidence):
- `project_collab_revision_version_bugs` — first-switch destroy bug, multi-layer nature.
- `feedback_convergence_debugging` — write failing test at suspect layer first.
- `project_yjs_relay_architecture` — which layer owns which bug class.
