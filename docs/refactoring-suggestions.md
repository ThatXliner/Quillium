# Refactoring & Redesign Suggestions

A survey of the codebase (July 2026) looking for duplication, dead code, and
design pressure points. Small mechanical cleanups were applied directly in the
same pass — they are listed at the bottom for the record. Everything above that
is a *suggestion*: items that need a real decision, carry migration risk, or
deserve their own PR.

Ordered roughly by value-for-effort within each section.

---

## High value

### 1. ✅ Consolidate the two word-diff implementations *(done — one module in `src/lib/editor/diff.ts`)*

- `src/lib/editor/plugins/annotations/diff.ts` (`tokenize`/`diffTokens`, `DiffOp`)
- `src/lib/editor/history/diff.ts` (`wordDiff`, `DiffSegment`)

Both are word-level LCS diffs with adjacent-run coalescing; they differ only in
type vocabulary (`equal|delete|insert` vs `same|add|del`) and robustness. The
history version is strictly better: it trims the common prefix/suffix before
running the DP table and caps the table at 1M cells with a coarse del+add
fallback. The annotations version runs an **unguarded O(n·m)** table — it is
invoked from `SuggestionDiffWidget.toDOM()`, `Suggestion.svelte`, and
`DiffModal.svelte`, so a long suggestion target (e.g. an AI revision over a
large selection) can lock the renderer.

**Suggestion:** keep one implementation (the history algorithm), expose it from
a single module, and adapt the annotation call sites. The op-type rename is
mechanical; `DiffOp` is re-exported from the annotations barrel, so keep an
alias there for compatibility.

### 2. ✅ Extract a shared "reconstruct draft state" helper *(done — `reconstructState()` in `replay.ts`)*

The recipe *load snapshot JSON → `EditorState.fromJSON` with fallback to empty
state → `replayEvents(state, eventsSince)`* is hand-rolled in at least:

- `src/lib/export.ts` (`exportDocumentById`)
- `src/lib/library/DocumentPreview.svelte`
- `src/lib/provenance/report.ts` / `PlaybackViewer.svelte`
- `src/lib/editor/Editor.svelte` (the real load path)

Each copy independently chooses extensions, the `"{}"`-empty-snapshot check,
and the try/catch fallback. A bug fix in one (e.g. a new saved field, a schema
migration) must be repeated in all of them.

**Suggestion:** add `reconstructDraftState(docId, draftId, opts)` next to
`replayEvents` in `src/lib/editor/replay.ts` and route all read-only consumers
through it. `Editor.svelte` can keep its richer variant but share the
snapshot-parse/fallback core.

### 3. Split the giant Svelte components

Line counts are a proxy, but these components each hold several independent
responsibilities and are where most future merge conflicts and regressions
will concentrate:

| Component | Lines | Natural seams |
|---|---|---|
| `settings/SettingsModal.svelte` | 1,942 | One child component per settings section/tab; the modal keeps only navigation + scroll-to-setting logic |
| `annotations/RevisionModal.svelte` | 1,434 | FSM (mount/tick/rebuild/ready) → a `.svelte.ts` controller; breadcrumbs, keyguard, and toolbar → children |
| `annotations/Annotations.svelte` | 1,285 | Card list vs. filtering vs. scroll-sync are separable |
| `collab/GoLiveButton.svelte` | 1,093 | It's a *button* that contains the whole session lifecycle. Move connect/join/leave/error state into a `session.svelte.ts` store-module; keep presentational pieces (popover, status pill, participant list) as small components |
| `editor/Editor.svelte` | 1,019 | Load/bootstrap flow vs. updateListener wiring vs. nested-editor mounting |
| `ai/AISidebar.svelte` | 1,001 | Tab router is already componentized; the API-key checking and event plumbing can move to a module |

**Why:** beyond readability, Svelte 5 components this large defeat fine-grained
reactivity review — several of the existing `state_referenced_locally` warnings
(see `bun run check` output) live in exactly these files.

### 4. Single source of truth for annotation effect ↔ inverse pairs

`annotationField.ts` maintains two parallel structures that must agree:

- the Phase-2 `if/else` chain in `annotationField.update()` (how each
  `StateEffect` mutates the map), and
- the mirrored chain in `invertedAnnotationFieldEffects` (each effect's
  inverse for undo).

Adding an effect requires touching both chains plus `listeners.ts`'s
`extractAnnotationEvents` — three places with no compile-time tripwire. The
codebase already solves this class of problem elsewhere (the clipboard
serialization schema has a `satisfies`-tuple tripwire in `models.ts`).

**Suggestion:** define each effect as a record `{ effect, apply(annotations, value, ctx), invert(effect, oldAnnotations) }`
in a single table; derive the reducer, the inverted-effects function, and
(optionally) the persistence extraction from that table. This is the highest-risk
refactor in this list — the undo semantics are subtle and heavily commented — so
do it with the fuzz/state-machine test suites as the gate, and keep the
existing comments attached to their handlers.

Related duplication worth folding in: the "active version fell back to its
positional neighbor" logic exists both in the `deleteRevisionVersion` builder
and in the `_deleteVersionFromRevision` reducer; they must agree today.

---

## Medium value

### 5. Annotation wire schema — mostly done; validate at the read boundary

*Correction to the original writeup:* the share wire types
(`SerializedAnnotation` et al.) already live in `@quillium/share`, and both
desktop (`collab/sharePayload.ts`) and landing (`server/publicShare.ts`) import
them — the schema **is** shared. What actually remained:

- ✅ `sharePayload.ts` contained two near-identical serializers (raw shape vs.
  live shape). Consolidated: the live path now converts via `selection.toJSON()`
  and both share one doc→wire mapping (`serializeParsedAnnotationMap`).
- ⏳ `publicShare.ts` casts `published_annotations` straight from the database
  to `SerializedAnnotation[]` with no runtime validation. A zod schema for the
  wire shape (living in `@quillium/share`, next to the types) would let landing
  reject malformed rows instead of rendering them. Requires adding zod as a
  dependency of the share package — a small decision, hence left open.

### 6. Split the big Rust DB module

`src-tauri/src/db/tabs.rs` is 2,153 lines and `src-tauri/src/lib.rs` is 1,292.
`tabs.rs` mixes tab CRUD, draft-tree operations, and migration-adjacent
helpers; `lib.rs` accumulates every `#[tauri::command]`. Splitting `tabs.rs`
into `tabs/{mod,drafts,tree}.rs` and moving command definitions next to their
domain modules would keep compile-time review local.

### 7. Remove or sample the hot-path telemetry in `caretBroadcast`

`listeners.ts` captures a `perf_coords_at_pos` PostHog event on **every caret
move** (rAF-throttled, but still ~every keystroke). This looks like leftover
instrumentation from the recent crash investigation (`fix crash + add logs?`).
It inflates event volume and adds work to the caret hot path.

**Suggestion:** once the investigation closes, delete it or gate it behind a
sample (e.g. `Math.random() < 0.01`) / the debug panel.

### 8. ✅ Test-only exports in `annotations/utils.ts` and `models.ts` *(done — `equalAnnotationsSignature` deleted)*

`equalAnnotationsSignature` has no production callers (only
`tests/annotations/utils.test.ts`). `positionIntersects` is exported but only
used internally + tests. Either delete `equalAnnotationsSignature` (git keeps
it) or move such helpers into a test-utils module so the public barrel reflects
the real API.

### 9. `getActiveAnnotation`'s "pending" heuristics *(filed as [#302](https://github.com/ThatXliner/Quillium/issues/302))*

The function returns any pending comment/empty revision *regardless of cursor
position*, using `thread.length === 0` / `versions.length === 0` as a proxy for
"pending". This is already flagged in-code (issue #38) — an explicit annotation
status field (or FSM) would remove the proxy checks scattered across
`utils.ts`, `invertedAnnotationFieldEffects` (`thread.length === 0` ⇒ pending
comment), and the UI components that re-derive the same notion.

### 10. ✅ `modalStack` bookkeeping duplication (`stores.ts`) *(done — `trimModalAnnotationStores()`)*

`pop`, `popTo`, and `popToAndRebuild` each re-implement "trim
`_modalAnnotationStores` above index N". A private
`trimModalAnnotationStores(fromIndex)` would make the pairing between the two
stores explicit and keep future stack operations from forgetting the cleanup.

---

## Applied in this pass (small refactors, July 2026)

Recorded here so the "why" isn't lost in the commit message:

- **Deleted `src/lib/editor/plugins/dont-use-for-now-history/`** (~540 lines):
  an unreferenced fork of CodeMirror's history extension; nothing imported it.
  The *used* history code lives in `src/lib/editor/history/`.
- **`annotations/utils.ts`:** merged the twin overlap checks
  (`canCreateRevision`/`canCreateSuggestion`) into one private
  `selectionOverlapsType`; deleted the 40-line commented-out
  `getActiveAnnotations`; dropped the redundant `length === 0 ||` clause in
  `canCreateNewComment` (`.some` on an empty map is already `false`).
- **`annotations/index.ts`:** removed the dead `getActiveRevisionRange`
  (duplicate of `getActiveRevisionAnnotation`, zero callers); removed unused
  `tokenize`/`diffTokens` imports (the re-export remains); replaced the four
  hand-unrolled dev keymap alias blocks with `bindWithDevAliases()`.
- **`annotations/models.ts`:** `getNewId` now delegates to `getLastId`;
  `newVersionId`/`newGroupId` share one `newLocalId(prefix)` counter.
- **`stores.ts`:** removed the dead exported `DiffOp` type (the live one is in
  `annotations/diff.ts`).
- **`posthog.ts`:** added `captureException(error: unknown)` which coerces
  non-Errors; replaced 19 copies of
  `posthog.captureException(e instanceof Error ? e : new Error(String(e)))`
  across 7 files.
- **`editor/listeners.ts`:** the three suspicious-change guards (large
  deletion, mass annotation removal, deep annotation loss) now share one
  `snapshotAndWarn()` helper instead of three copies of the
  snapshot + error-banner block.
- **`export.ts`:** `exportDocument` and `exportDocumentById` now share one
  `exportState()` tail (log → dialog → analytics); the `filterName` ternary
  chain became a record lookup.

Verified with `bun run check` (0 errors) and `bun run test:run`
(1,183 passed / 3 skipped).
