# Phase 2: Joiner View Hardening - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning
**Source:** Inline discussion (manual discuss-phase substitute)

<domain>
## Phase Boundary

A freshly-connected joiner has a clean editor: no pre-connect undo history, no
duplicated annotations, no Cmd-z reverting past the connect state. The owner
keeps full local undo of their own edits but cannot accidentally rewind a
remote peer's edits. The joiner gets per-user undo via the existing
`Y.UndoManager` infrastructure (built in Phase 8.5, never wired into the
collab view stack).

This phase delivers symmetric "undo only your own edits" semantics across
both peers — implemented via two different mechanisms (CM `history()` on
owner, `Y.UndoManager` on joiner) chosen to minimize refactor risk.

Out of scope: switching the owner to `Y.UndoManager`, persistence changes,
nested-editor behavior beyond what already works.

</domain>

<decisions>
## Implementation Decisions

### Undo architecture — owner side

- Owner keeps the CodeMirror `history()` extension. Full pre-connect undo
  tree is preserved.
- **Invariant:** every code path that turns a remote Yjs op into a CM
  `view.dispatch(...)` call MUST include `Transaction.addToHistory.of(false)`
  in its annotations. Without this, owner's Cmd-z replays the joiner's
  edits.
- Known-missing site: `src/lib/collab/yjsBinding.ts:62` — the Y.Text
  observer's `view.dispatch({ changes, annotations: [yjsAnnotation.of(true)] })`
  call must add `Transaction.addToHistory.of(false)` to the annotations array.
- Already-correct sites (do not regress):
  - `src/lib/collab/yjsAnnotations.ts:212`, `:294` (Y.Map remote-apply)
  - `src/lib/collab/index.ts:192` (initial doc sync)
- Audit task: grep all `view.dispatch` calls inside `src/lib/collab/` and
  confirm every remote-driven dispatch includes the annotation.

### Undo architecture — joiner side

- Joiner's collab `EditorView` has NO `history()` extension. Harness
  assertion `view.state.field(historyField, false) === undefined` must pass.
- Joiner's extension stack includes `createYjsUndoExtension(ytext, ymap)`
  from `src/lib/collab/yjsUndo.ts`. This module already exists from Phase
  8.5 and provides:
  - `trackedOrigins: new Set(["local"])` — only joiner's own edits are
    undoable; owner-origin edits never enter the undo stack.
  - Unified text + annotations stack (Y.Text and Y.Map tracked together),
    so undoing a paragraph also restores the annotations attached to it.
  - `captureTimeout: 500` (Yjs default) — group rapid keystrokes into one
    undo step.
  - Cmd-z / Cmd-Shift-z keybindings via the module's `undoKeymap`.

### Selection restoration on undo/redo

- `Y.UndoManager` does NOT restore CM selection by default. Phase 2 wires
  this up via `stackItemAdded` / `stackItemPopped` events on the
  UndoManager:
  - On `stackItemAdded`: stash the current `view.state.selection` into the
    stack item's metadata.
  - On `stackItemPopped`: read the stashed selection from the popped stack
    item and dispatch `view.dispatch({ selection })`.
- This logic lives alongside `createYjsUndoExtension` (extend that
  function, do not create a parallel module).

### Annotation duplication on connect

- Joiner's initial `annotationField` value is the empty annotations object
  before the Y.Map observer hydrates. The current bug: joiner's CM state
  is constructed with annotations populated AND the observer also fires
  for every existing key, producing 2× annotations.
- Owner's `_syncInitialToYjs` (in `yjsAnnotations.ts`) is guarded against
  re-entrance so a second connect attempt cannot re-publish the same
  annotations into Y.Map.

### Joiner pre-connect history

- Joiners cannot edit before connecting (their editor is not constructed
  until the relay handshake completes). So there is no pre-connect history
  to preserve on the joiner side. `Y.UndoManager` from t=0 is sufficient.

### Cross-peer undo semantics (locked decision, matches Google Docs)

- A peer's undo is always visible to remote peers — it produces an inverse
  Yjs op that syncs through the normal channel.
- BUT a peer can only undo their own edits. The joiner's `Y.UndoManager`
  ignores owner-origin ops; the owner's CM `history()` ignores remote-tagged
  transactions. Net effect: Cmd-z on either side rewinds only that peer's
  contributions.
- This is intentional and matches the user's mental model from Google Docs.

### Claude's Discretion

- Exact placement of `Transaction.addToHistory.of(false)` in `yjsBinding.ts`
  (existing annotations array vs. new array literal).
- Naming of harness assertion helpers added for criteria #5–#8.
- Internal organization of selection-restore code inside `yjsUndo.ts`
  (separate function vs. inline in `createYjsUndoExtension`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap and requirements

- `.planning/ROADMAP.md` — Phase 2 section defines the four original
  success criteria; this CONTEXT extends them with #5–#8.
- `.planning/REQUIREMENTS.md` — JOINER-01, JOINER-02, JOINER-03, JOINER-05.

### Existing collab modules (READ FIRST)

- `src/lib/collab/yjsBinding.ts` — Y.Text ↔ CM binding. Contains the
  remote-text dispatch site that needs the `addToHistory.of(false)` fix
  (line 62). Also enforces origin discipline ("local" for joiner edits).
- `src/lib/collab/yjsAnnotations.ts` — Y.Map ↔ annotationField sync.
  Already correct on `addToHistory`. Owns `_syncInitialToYjs` which needs
  the re-entrance guard.
- `src/lib/collab/yjsUndo.ts` — `Y.UndoManager` factory. Already exists,
  built in Phase 8.5, never wired into the production extension stack.
  Phase 2 wires it into the joiner's stack and adds selection restore.
- `src/lib/collab/index.ts` — collab extension stack assembler. The
  joiner's extension list is built here; this is where `history()` must
  NOT appear and `createYjsUndoExtension` must.
- `src/lib/collab/yjsUndo.test.ts`, `src/lib/collab/undo-manager.test.ts`
  — existing UndoManager test coverage; extend rather than duplicate.

### Test harness (Phase 1 deliverables)

- `tests/` — `flushAll(...peers)` helper from Phase 1 is the only flush
  primitive for two-peer convergence assertions. New harness assertions
  for criteria #5–#8 use this primitive.

### Phase 1 dependency

- `.planning/phases/01-test-harness-invariants/` — Phase 1 SUMMARY for
  the canonical-source invariants and the harness API surface.

</canonical_refs>

<specifics>
## Specific Ideas

### Updated success criteria (extends roadmap)

1. (roadmap) Joiner collab `EditorView` has no `history()` extension;
   `view.state.field(historyField, false) === undefined` passes.
2. (roadmap) Joiner initial annotationField is empty before observer
   hydration; owner `_syncInitialToYjs` is guarded against re-entrance.
3. (roadmap) Cmd-z on a joiner immediately after connect leaves the
   document and annotations unchanged.
4. (roadmap) Owner has N annotations + joiner connects → joiner annotation
   count = N (not 2N).
5. Joiner's extension stack includes `createYjsUndoExtension(ytext, ymap)`
   and it is the only undo mechanism on the joiner.
6. Joiner Cmd-z undoes joiner's own edits only; owner's edits visible on
   the joiner's screen are not affected by joiner Cmd-z.
7. `src/lib/collab/yjsBinding.ts` remote-text dispatch includes
   `Transaction.addToHistory.of(false)`. Harness asserts owner can undo
   their own edits but cannot undo a joiner's incoming edits.
8. Joiner undo/redo restores `view.state.selection` to where the cursor
   was when the undo step was captured.

### Concrete code changes (non-exhaustive)

- `src/lib/collab/yjsBinding.ts`: add `Transaction.addToHistory.of(false)`
  to the annotations array at line ~64.
- `src/lib/collab/index.ts`: in joiner-side extension assembly, omit
  `history()` and include `createYjsUndoExtension(ytext, ymap).extension`.
- `src/lib/collab/yjsUndo.ts`: extend `createYjsUndoExtension` with
  `stackItemAdded`/`stackItemPopped` handlers that stash/restore CM
  selection via the returned `undoManager` instance and the bound
  `EditorView` (will need to thread the view in via the extension's
  ViewPlugin or similar — see existing pattern).
- `src/lib/collab/yjsAnnotations.ts`: add re-entrance guard to
  `_syncInitialToYjs` (e.g., a boolean flag set on first call, checked on
  subsequent calls).
- New harness assertions for criteria #5–#8 in `tests/` using the Phase 1
  `flushAll` primitive.

</specifics>

<deferred>
## Deferred Ideas

- Owner switching from CM `history()` to `Y.UndoManager`. Symmetric
  architecture would be cleaner but requires owner to use Yjs as the doc
  store from t=0 (currently the doc only enters Yjs at connect). Punt to
  a later phase.
- `captureTimeout` tuning beyond Yjs default 500ms. Default is fine for
  prose; revisit if dogfooding reveals undo-step granularity feels wrong.
- Any persistence-layer changes (snapshot format, event log shape).

</deferred>

---

*Phase: 02-joiner-view-hardening*
*Context gathered: 2026-04-19 via inline discussion*
