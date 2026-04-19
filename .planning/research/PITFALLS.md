# PITFALLS Research — Known Traps in CRDT-Editor Sync

**Researched:** 2026-04-19
**Scope:** Re-architecting Quillium's annotation sync layer (v1.1 milestone)
**Domain:** Yjs CRDT ↔ CodeMirror annotationField sync, nested editors, multi-peer lifecycle
**Overall confidence:** HIGH on Quillium-specific failures (direct code + v1.0 context read); MEDIUM/HIGH on generic Yjs traps (verified against yjs/yjs issues + docs.yjs.dev + y-prosemirror issues).

Note: this document supersedes the v1.0-era `PITFALLS.md` on "@codemirror/collab" — we migrated to Yjs in Phase 07.5 and the trap landscape is different.

## Quillium v1.0 Failure Mode Analysis

Root-causing each v1.0 bug before we write any new code. If we don't name the root cause, we will rebuild the same trap.

### F-1. Phase 3 (`pushDocToVersionState`) corrupting version text on remote rebuilds
- **Symptom:** Remote peer dispatches rebuild of a revision annotation → annotationField's Phase 3 runs → `versions[i].doc` is overwritten from the parent doc slice → version text on joiner diverges / clobbers a concurrent edit.
- **Root cause:** **Phase 3 is a local-only invariant masquerading as a global one.** Phase 3 was designed for local nested-editor typing ("keep parent slice, `versions[i].doc`, and subtree Y.Text in sync"). When a remote Yjs observer dispatches `removeAnnotation + addAnnotation` to rebuild, Phase 3 runs unconditionally and pulls whatever `doc.sliceString(from,to)` happens to be at that moment — not what the Yjs version Y.Text actually says. In collab mode the authoritative source of version text is the per-version Y.Text, not the parent doc slice.
- **Structural problem:** **Dual source of truth** for version text (`annotationField.versions[i].doc` AND `Y.Map → versions → i → text: Y.Text`) with **a write path that fires whenever anything rebuilds the annotation**.
- **v1.1 prevention:** Make Y.Text the sole source of truth for active-version text in collab mode. Phase 3 must either (a) be gated by an "authoritative CM source" flag, or (b) be removed entirely and replaced with: active version's Y.Text observer → dispatch CM changes that drive the editor; CM → Y.Text delta via `yjsBinding` pattern. No `sliceString` write-back during remote rebuilds. Invariant: **a remote-originated transaction must never read the parent doc to write version state.**

### F-2. Effect-specific handlers proliferating (one per operation type)
- **Symptom:** `addAnnotation`, `removeAnnotation`, `updateThread`, `_addVersionToRevision`, `_deleteVersionFromRevision`, `_updateActiveRevisionVersion`, `_updateRevisionVersionDoc`, `_updateRevisionVersionLabel`, `_updateRevisionVersionState`… The sync plugin's `update()` must enumerate each. New annotation feature = new effect = new branch = new bug class.
- **Root cause:** Writing the **CM → Yjs path effect-by-effect instead of state-by-state**. Effects are a CM implementation detail; Yjs doesn't care which effect caused a shape change. Coupling the sync layer to the *means* of local mutation (effects) instead of the *result* of it (annotation map state) guarantees that every new effect needs wiring on the sync side.
- **v1.1 prevention:** Sole write entrypoint = `diffAndReconcile(prevState, nextState)`. Sync plugin does not know the names of any specific effect; it only checks "did the annotation map shape change?" via a cheap identity check (`prev === next` on the StateField value) and runs a shape diff. **Lint rule / code review red flag:** any `.is(<specific effect>)` call inside `createAnnotationSyncPlugin` is suspect — the only allowed check is "did annotationField change?".

### F-3. Version switch deleting annotations on joiner
- **Symptom:** Joiner switches the first revision's version after connect; the revision annotation disappears on joiner. Sometimes the decoration vanishes but the data is still present; sometimes both go.
- **Root cause (per 09-CONTEXT suspect list):** Race between three timers:
  1. `NestedEditorController.destroy()` on the old version
  2. `annotationGeneration` / rebuild-signal detecting a "needs rebuild"
  3. Yjs `observeDeep` firing for the `activeVersionIndex` change and queuing a rebuild via `queueMicrotask`
  The destroy tears down the nested view and may clear a binding; the rebuild then sees a partial state and dispatches an effect that removes the annotation before the re-add effect arrives. With observers firing during plugin setup, the rebuild queue can flush out-of-order.
- **v1.1 prevention:** Version switch is **data only** (D-99: activeVersionIndex is cosmetic). Never tear down the annotation on switch; only re-mount the nested view's `EditorView` pointing at the new version's Y.Text. Treat rebuild effects as `{remove, add}` **always batched in a single dispatch** — never let a remove flush without the matching add in the same transaction. Write a test: two peers both open revision; peer A switches active version; assert annotation still exists on peer B **after** the Yjs update applies AND after one microtask tick.

### F-4. Decorations not rendering until switched once
- **Symptom:** Joiner connects; annotation data arrives; decoration not painted. User clicks into the annotation / switches version / clicks elsewhere → decoration appears.
- **Root cause:** `_syncInitialFromYjs` runs via `queueMicrotask` and dispatches `addAnnotation` effects. But decoration `ViewPlugin`s derive from annotationField and run `decorations` computation during the next view cycle. If the initial sync dispatch happens in the same microtask as a concurrent `editorView` mount and no subsequent state update fires, the decoration cache is stale. The "switch once" reinit forces a fresh decoration compute.
- **v1.1 prevention:** Initial hydration must fire **one explicit `requestMeasure()` or dummy empty dispatch** after the effects-bearing dispatch, forcing a decoration recompute. Better: ensure the initial-sync dispatch always goes through the same code path as a remote rebuild (no "initial" special case). Write a test: hydrate a joiner with pre-existing annotations in Yjs; assert `view.dom.querySelectorAll('.cm-annotation-decoration').length > 0` on the next microtask tick without any synthetic click.

### F-5. Cmd-z reverting past connect state
- **Symptom:** Joiner connects. Types a few chars. Hits Cmd-z twice. The joiner's pre-connect local document content appears (the joiner's editor reverts to some older snapshot that the peer shouldn't even know about).
- **Root cause:** **Two undo stacks pointing at the same EditorView.** CodeMirror's `historyField` has the joiner's pre-connect history. Then `yjsUndoManager` is attached. If the CM undo keymap isn't at `Prec.highest` OR if the CM `historyField` stays in the extension stack, Cmd-z goes to CM history first → walks into pre-connect entries.
- **v1.1 prevention:** The D-100 "joiner is a separate view" architecture dissolves this: the joiner's collab EditorView has **no pre-connect history** because the view is freshly constructed pointing at the Yjs doc. Invariant: the collab EditorView's extension stack **must not contain `history()` from CodeMirror**; Yjs UndoManager is the only undo source. Test: in the two-peer harness, assert that `view.state.field(historyField, false)` is `undefined` for the joiner view. If `history()` is needed (e.g., owner uses it pre-live), separate the owner's live-mode view from the pre-live view.

### F-6. Dual-source-of-truth between annotationField + Y.Map
- **Symptom:** All of the above bugs are manifestations of this meta-problem. Annotation shape is held in two places; they can drift; drift produces "works if you click in exactly this order" ghosts.
- **Root cause:** Neither "annotationField is source of truth" nor "Y.Map is source of truth" was chosen. The sync plugin writes both ways on every effect, and Phase 3 creates a third implicit source (the parent doc slice).
- **v1.1 prevention:** **Declare Yjs the source of truth for collab mode.** `annotationField` in collab mode is a *projection* — it's computed, cached, and patched from Yjs, not authored independently. Local CM mutations are intents: the effect mutates Yjs; the Yjs observer produces the canonical state; the canonical state is dispatched back into annotationField. This means the CM effect's *direct* application to annotationField is skipped in collab mode, OR applied optimistically and then overwritten by the Yjs echo (acceptable if the echo is idempotent and the origin checks prevent loops). Pick one model and write it in the phase's ARCHITECTURE.

---

## Pitfall Catalog

Ranked by **Severity × Likelihood for Quillium v1.1**. Severity = S1–S4 (S1 = loses data / unusable); Likelihood = L1–L3 (L1 = will almost certainly happen without explicit guard).

### P1 — Feedback Loops via Missing/Wrong Origin Tag (S1, L1)
- **Source:** y-prosemirror #85 infinite cursor awareness loop; y-codemirror.next origin annotation pattern; our own Phase 8/10 bugs.
- **Symptom:** Browser freeze / stack overflow / exponential console spam. Or quieter: every keystroke produces two Yjs updates and two CM dispatches; perf looks fine at low load, crashes under typing pressure.
- **Cause:** CM dispatch → Yjs write → Yjs observer fires → dispatches back to CM → CM `update()` sees a "real" change → writes to Yjs → …
- **Prevention (all four required together):**
  1. Every local Yjs write uses `ydoc.transact(fn, "local")`. No exceptions, no bare `ytext.insert()` outside a transaction.
  2. `observeDeep` handler's first line: `if (tr.origin === "local") return;`.
  3. Every remote-originated CM dispatch attaches `yjsAnnotationSync.of(true)` AND `Transaction.addToHistory.of(false)`.
  4. `update()` first line: `if (update.transactions.some(tr => tr.annotation(yjsAnnotationSync))) return;`.
- **Write this test first:** Two peers. Peer A types 100 characters. Assert total Yjs update count on A is ≤ 100 (one per keystroke), not 200 (echo) or ∞. Instrument `ydoc.on('update', () => count++)`.

### P2 — Dual Source of Truth Between annotationField and Y.Map (S1, L1)
- **Source:** Quillium F-6 direct experience.
- **Symptom:** "Works if you click in exactly the right order"; bugs that only appear after a version switch + rebuild + typing.
- **Cause:** No declared canonical source.
- **Prevention:** Phase 1 of roadmap explicitly names Yjs as canonical in collab mode, and writes the invariant at the top of `yjsAnnotations.ts` in a comment ending in "IF YOU ADD A SECOND WRITE PATH, THIS FILE BREAKS."
- **Write this test first:** Property test (fast-check) — generate a sequence of local effects; assert `yjsAnnotationToCodeMirror(yMap) === annotationField` after every microtask flush.

### P3 — Position Anchoring Drift via RelativePosition JSON Round-Trip (S2, L2)
- **Source:** yjs/yjs#340 "Issue with relative position at the end of text when encoding as json"; yjs/yjs#657 "Inconsistency when creating absolute position from a relative position".
- **Symptom:** Annotation anchored at the end of a doc loses its anchor after a snapshot → reload cycle. Position coerced to start of doc, or becomes null, or drifts by one.
- **Cause:** `relativePositionToJSON` checks `if (rpos.item)` — falsy for `null`, so the `item` property is omitted. On decode, the missing key becomes `undefined`, but `createAbsolutePositionFromRelativePosition` checks for explicit `null`. End-of-text positions have `item: null` legitimately.
- **Prevention:**
  - Do not serialize RelativePositions via JSON for persistence. Use `Y.encodeRelativePosition` / `Y.decodeRelativePosition` (binary).
  - If you must JSON: patch the missing `item` back to `null` on decode.
  - When a `createAbsolutePositionFromRelativePosition` returns `null`, fall back to "end of text" (or "start of text", whichever is semantically right for your annotation).
- **Write this test first:** Annotate the last character of a doc. `encodeStateAsUpdate`, `applyUpdate` on a fresh doc. Assert annotation range is still at the end, not collapsed to 0.

### P4 — Version Switch Racing With Rebuild (S1, L1 — already hit as F-3)
- **Source:** Quillium F-3.
- **Symptom:** Annotation disappears on joiner after first version switch.
- **Cause:** `destroy()` and `rebuild` run in wrong order relative to Yjs observer microtask.
- **Prevention:**
  - Version switch is **data only**. No tear-down of the CM annotation on switch.
  - All rebuild effects (`remove` + `add`) must ride a single `view.dispatch()` — never two dispatches.
  - `NestedEditorController.destroy()` must not fire `removeAnnotation`; it only tears down the nested `EditorView` DOM. The outer annotation is preserved in annotationField independent of nested view lifecycle.
- **Write this test first:** Two-peer harness. Peer A creates revision with 2 versions, switches active from 0→1. Peer B asserts: `annotationField[id] !== undefined` AND `annotationField[id].activeVersionIndex === 1` AND the decoration DOM node exists, all after ONE microtask tick.

### P5 — CM `history()` Extension Coexisting With Y.UndoManager (S2, L1 — F-5)
- **Source:** Quillium F-5; y-codemirror.next docs ("remove the default history"); docs.yjs.dev UndoManager.
- **Symptom:** Cmd-z walks into pre-connect state.
- **Prevention:**
  - Joiner's collab EditorView extension stack: `history()` REMOVED. Only Yjs UndoManager bound to the undo keymap at `Prec.highest`.
  - Test: `view.state.field(historyField, false) === undefined`.

### P6 — UndoManager Cross-Peer Undo Merging via captureTimeout (S3, L2)
- **Source:** yjs/yjs#273 "Issue with merging undo operations from different sources"; docs.yjs.dev UndoManager.
- **Symptom:** Peer A undoes; peer B's recent changes also disappear on A's screen; eventually syncs back but flicker/regression noticed.
- **Cause:** UndoManager merges stack items created within `captureTimeout` (default 500ms) regardless of origin, if origins aren't distinct AND tracked separately. With only `"local"` as tracked origin, the manager does filter correctly — BUT transitive effects originating in `"local"` that were caused by applying a remote update still risk entering the stack.
- **Prevention:**
  - `new Y.UndoManager(scope, { trackedOrigins: new Set(["local"]), captureTimeout: 0 })` for conservative operation; or keep 500ms only after an explicit test shows cross-peer merging does not occur.
  - Remote updates are applied with origin `"remote"` (our harness already does this) — verify production relay wiring matches.
- **Write this test first:** Two peers typing simultaneously for 1 second. Peer A undoes. Assert peer B's characters are unchanged on both views after sync.

### P7 — `dispatch()` During Plugin Construction / Update (S2, L1)
- **Source:** `codemirror/dev#1341`; already handled in our code via `queueMicrotask`.
- **Symptom:** "Calls to EditorView.update are not allowed while an update is in progress" console error; init crash.
- **Prevention:** All dispatch from inside an observer or constructor goes through `queueMicrotask(() => { if (this.destroyed) return; view.dispatch(...); })`. The `destroyed` check is mandatory — without it, a destroyed plugin resurrects itself.
- **Red flag in code review:** Any `this.view.dispatch(...)` call inside `createAnnotationSyncPlugin` that is NOT inside a `queueMicrotask` AND NOT inside `update()`.

### P8 — Detached Y.Map / Y.Text Written Before Integration (S2, L2)
- **Source:** yjs/yjs#666 "Properties on Y.Map can't be accessed with .get before map is attached to doc"; yjs/yjs#210 "Inserting Y.Map into Y.Array does not set its doc immediately".
- **Symptom:** `versionNode.get("text")` returns undefined right after creation; writes silently lost; "Unexpected case" Yjs internal warning.
- **Cause:** You construct `const v = new Y.Map(); v.set("text", new Y.Text())` then read `v.get("text")` before `parentMap.set(key, v)`. The child Y.Text has no doc until the parent is set, and some reads before integration behave inconsistently (esp. with Y.Array).
- **Prevention:** **Always** `parentMap.set(key, child)` inside the same `ydoc.transact()` that constructs the child; only access child contents AFTER that transaction returns. Never pre-populate a detached Y.Map and then attach.
- **Red flag:** Any pattern of `new Y.Map(); ...set(...); ...set(...); parentMap.set(key, thatMap);` where the intermediate sets happen outside `transact`.

### P9 — observeDeep Does Not Observe Subdocuments; Inconsistent Firing Across Nested Types (S2, L2)
- **Source:** discuss.yjs.dev "How to deepObserve subdocuments?" (answer: doesn't); yjs/yjs#591 "Misordered updates result in temporarily missing Y.Map keys".
- **Symptom:** Changes inside a nested Y.Map key that was added in the same transaction as the shape change don't fire observers in the expected order; or subdocument changes don't fire at all.
- **Prevention:**
  - Do NOT use Yjs subdocuments for nested revisions. Use nested Y.Maps inside the same root doc (matches current 08.5c D-90 shape). Subdocuments were considered — flag as rejected.
  - Trust `observeDeep` for everything under the root annotations Y.Map, but assume event ORDER within a single transaction batch can be counter-intuitive. Read all events first, build a "dirty CM IDs" set, then rebuild once — do NOT apply events one at a time in order. (Our current code does this; preserve the pattern.)
- **Write this test first:** Add a new revision WITH a non-empty version Y.Text in one transaction on peer A. Assert peer B's observer fires once (or fires multiple times but produces only ONE rebuild per affected annotation), and resulting shape is correct.

### P10 — Scope Drift: Sync Plugin Recreated, Old Plugin Still Observing (S2, L2)
- **Source:** yjs/yjs#327 "Return an unobserve function from observe and observeDeep"; our own plugin `destroy()` in `yjsAnnotations.ts`.
- **Symptom:** A nested editor is destroyed + recreated (version switch). Old plugin's `observeDeep` callback keeps firing on Yjs updates and dispatches into a dead view → "view is destroyed" error OR worse, dispatches into the new view with stale closures pointing at a GC'd Y.Map.
- **Cause:** Missing `unobserveDeep` on plugin `destroy()`; or `destroyed` flag set but the closure holds references that GC can't clean.
- **Prevention:**
  - Every `observeDeep` MUST have a matching `unobserveDeep` in `destroy()`. Currently present in `yjsAnnotations.ts` — preserve.
  - The `destroyed = true` guard is belt-and-suspenders and MUST be checked at the top of every queueMicrotask deferred callback AND inside the observer itself.
  - Store the observer function on `this.deepObserver` so you can pass the exact same reference to `unobserveDeep` (Yjs uses strict reference equality).
- **Red flag:** `scopeAnnotations.observeDeep((events, tr) => {...})` with inline arrow function that's never captured — you can't unobserve it.

### P11 — Initial State Seeding: Owner + Joiner Both Write (S1, L2)
- **Source:** discuss.yjs.dev "Issue with Initial Data Duplication in Collaborative Editor"; discuss.yjs.dev "Appropriate way to load initial data"; Quillium v1.0 dedup bug (#6).
- **Symptom:** Owner had 3 annotations locally. Joiner connects. Now there are 6 annotations (3 original + 3 duplicates with different Yjs keys).
- **Cause:** Both peers run `_syncInitialToYjs` — joiner sees empty Y.Map (hasn't synced yet), writes their own version of the pre-existing CM annotations.
- **Prevention:**
  - **D-100 architectural fix (already decided):** Joiner's collab view is a SEPARATE view with NO pre-existing CM annotations. `_syncInitialToYjs` becomes a no-op on joiner (CM is empty, nothing to push).
  - Invariant: the collab EditorView's initial `annotationField` MUST be empty on joiner. Assert this in the test harness.
  - Owner's `_syncInitialToYjs` must guard `if (scopeAnnotations.has(yjsId)) continue;` (already present) to survive reconnect cases.
- **Write this test first:** Owner has 3 annotations. Joiner connects. After one microtask flush, assert `scopeAnnotations.size === 3` on BOTH peers, not 6.

### P12 — Snapshot Round-Trip: Yjs → JSON → Yjs Loses CRDT History (S2, L3)
- **Source:** Yjs docs "CRDT history"; general CRDT knowledge.
- **Symptom:** Document works across a single session. User reloads (state restored from a serialized snapshot). Subsequent collab causes weird merges or position drift.
- **Cause:** Serializing a Y.Doc to JSON and reconstructing via `ydoc.getMap().set(...)` throws away operation history → concurrent edits from another peer who still has history merge weirdly.
- **Prevention:** Persist via `Y.encodeStateAsUpdate(ydoc)` (binary update blob), reload via `Y.applyUpdate(ydoc, blob)`. Never round-trip through JSON.
- **Applies to Quillium:** Our local event-sourced persistence currently holds annotation JSON. In collab mode, additionally persist the Yjs update blob alongside. Do not rebuild Yjs from the JSON annotation on reload.

### P13 — Svelte 5 Runes Reactivity Leaks on Yjs Types (S3, L2)
- **Source:** Svelte 5 rune semantics; no direct Yjs+Svelte5 post-mortem found.
- **Symptom:** `$state` wrapping a Y.Map causes Proxy interception of internal Yjs fields → `Invalid access` warning, or wrong reactivity granularity causing every keystroke to re-render the whole sidebar.
- **Prevention:**
  - Never wrap Y types in `$state`. Keep Y types as plain module-level refs.
  - For UI reactivity, maintain a `$state` projection updated from Y observers (manual push).
  - `$derived` off Yjs types directly is fine for read-only computed values but must NOT mutate the Yjs type.
- **Red flag in code review:** `let ydoc = $state(new Y.Doc())` or similar wrapping.

### P14 — Testing Trap: Peer A's Microtask Fires After Peer B's Assertion (S3, L1)
- **Source:** Our own two-peer harness; Vitest microtask scheduling.
- **Symptom:** Flaky tests that pass 80% of the time. Assertion runs before observer microtask flushes.
- **Prevention:**
  - After any operation that may trigger observers, `await Promise.resolve()` (or `await tick()` in Svelte context) **multiple times** — one per layer of microtask-chained dispatch. Three flushes is a safe default for our two-queueMicrotask architecture.
  - Better: write an explicit `flushAll(peerA, peerB)` helper in the harness that pumps until `ydoc.transact` queue is empty AND no observer has pending work. Use this in every test.
  - Fuzz tests: wrap operations with `await flushAll()` between each action, not just at the end.
- **Write this helper first:** `flushAll(...peers): Promise<void>` that awaits until both peers' observer queues are empty. Do this in Phase 1 before any other collab test.

### P15 — `y-protocols` / Awareness Feedback Against Two Editors on One Doc (S2, L3)
- **Source:** y-prosemirror#85.
- **Symptom:** When Quillium mounts two EditorViews on the same Y.Doc (e.g., nested editor + parent editor), both register awareness observers → circular position updates cause cursor flicker → infinite loop.
- **Prevention:** Only the top-level editor is bound to the awareness protocol. Nested editors do NOT register awareness; they inherit parent awareness or none.

### P16 — Y.Text Delta Applied Before CM Doc Ready (S3, L2)
- **Source:** y-codemirror.next internals.
- **Symptom:** Initial doc sync → Y.Text has 500 chars → CM view mounted with empty doc → binding tries to apply 500-char insert → fires while plugin is still constructing.
- **Prevention:** Plugin constructor signature: accept the Y.Text, but **construct the EditorView's initial `doc` field from `ytext.toString()`**, not empty. Binding then has nothing to do on mount.
- **Red flag:** `EditorState.create({ doc: "" })` when the Y.Text is already populated.

### P17 — Thread Y.Array Observed But Not Unobserved On Annotation Removal (S3, L2)
- **Source:** yjs/yjs#327 unobserve lifecycle; our observeDeep pattern.
- **Symptom:** Memory growth proportional to annotations created + deleted over a session. Observers never GC.
- **Prevention:** Using `observeDeep` at the root Y.Map (current pattern) covers this — child observers are automatic. Do NOT switch to individual `Y.Array.observe` per thread unless you also track and unobserve them on annotation removal.

### P18 — `activeVersionIndex` Storing an Index Into a Mutable Array (S3, L3)
- **Source:** CRDT general reasoning.
- **Symptom:** Peer A adds a version (insert at position 0, shifting others); peer B's `activeVersionIndex` now points at the wrong version.
- **Prevention:**
  - Versions keyed by stable string ID, not array index. If the Yjs shape uses numeric-string keys (as current 08.5c D-92 does), adding a version must append to the highest key, never insert-and-shift.
  - Alternative: store `activeVersionId: string` instead of `activeVersionIndex: number`.
- **Applies to Quillium:** Current code uses index. If version add/remove is owner-only, low likelihood. Flag for v2 when multi-peer version authoring opens up.

---

## Prevention Strategy

### Invariants to Establish Early (Phase 1 before any new code)

Write these as top-of-file comments in `src/lib/collab/yjsAnnotations.ts` and enforce via tests:

1. **Single-origin invariant.** Every Yjs write comes from a `transact(fn, "local")`. Every remote CM dispatch carries `yjsAnnotationSync.of(true)` and `Transaction.addToHistory.of(false)`. No exceptions.
2. **Single-write-path invariant.** The CM → Yjs path is ONE function: `diffAndReconcile(prev, next)`. No `.is(<specific effect>)` calls anywhere in the sync plugin.
3. **Canonical-source invariant.** In collab mode, Yjs is the source of truth. `annotationField` is a projection. Phase 3 (`pushDocToVersionState`) is disabled/bypassed in collab mode.
4. **Separate-view invariant.** Joiner's collab EditorView has no `history()` extension, empty initial annotationField, empty initial Y.Map, and a distinct `EditorView` instance from any pre-connect view. (D-100 already.)
5. **Observer-lifecycle invariant.** Every `observeDeep` has a matching `unobserveDeep` in `destroy()`, with the same captured function reference. Every queueMicrotask callback checks `this.destroyed` first.
6. **Integrated-type invariant.** A Y type is never `.get`-read or `.set`-written until it's attached to the doc tree inside the same `ydoc.transact()` as its construction.

### Tests to Write First (Phase 1, before implementation of sync layer)

Order matters. Each test codifies an invariant that later code must satisfy.

1. `feedback-loop.test.ts`: Peer A types N chars. Assert total `update` events on A's ydoc ≤ N. (Catches P1.)
2. `flush-helper.test.ts`: Verify `flushAll(peerA, peerB)` drains all pending microtasks deterministically. (Catches P14.)
3. `initial-seeding.test.ts`: Owner has 3 annotations, joiner connects (D-100 separate view). Assert total annotation count = 3 on both peers, not 6. (Catches P11.)
4. `joiner-no-cm-history.test.ts`: Joiner view has no `historyField`. Cmd-z on joiner is a no-op until they type. (Catches F-5 / P5.)
5. `decorations-on-connect.test.ts`: Owner has annotation, joiner connects. After 3 microtask flushes assert `view.dom.querySelectorAll('.cm-annotation-decoration').length === 1`. (Catches F-4.)
6. `version-switch-preserves-annotation.test.ts`: Peer A switches active version 0→1. Peer B's annotation id is still in annotationField after observer flush. (Catches F-3 / P4.)
7. `phase3-no-writeback-on-remote.test.ts`: Peer A types in active version. Peer B observes → dispatches rebuild → assert `versions[activeIdx].doc === yTextForVersion.toString()` (NOT `parentDoc.sliceString(from,to)`). (Catches F-1.)
8. `snapshot-end-position.test.ts`: Annotate last char. Encode as update blob. Reload into fresh doc. Assert annotation range = { from: len-1, to: len }. (Catches P3.)
9. `detached-ytype.test.ts`: Attempt to construct Y.Map, set Y.Text child, read before integration — assert defensive code either blocks or integrates first. (Catches P8.)
10. Property test (`sync-convergence.prop.test.ts`): Random sequence of local effects on both peers; after `flushAll`, assert `view A annotationField === view B annotationField === yMap projection`. (Catches F-6 / P2 / general drift.)

### Code Review Red Flags

Mark any PR that contains these for extra scrutiny:

- `createAnnotationSyncPlugin` imports any `_<specific>` effect type and branches on it. (Violates P2.)
- A `view.dispatch(...)` inside an observer that is NOT inside `queueMicrotask`. (Violates P7.)
- `ydoc.transact(() => ... )` without a second `"local"` origin argument. (Violates P1.)
- A CM dispatch originating from Yjs observer that is missing `Transaction.addToHistory.of(false)`. (Violates P1; pollutes undo stack.)
- `new Y.Map()` or `new Y.Text()` that isn't followed by a `parentMap.set(key, it)` in the SAME `transact`. (Violates P8.)
- `observeDeep(fn)` with inline arrow function. (Violates P10.)
- `let X = $state(<Yjs type>)`. (Violates P13.)
- `EditorState.create({ doc: "" })` when the plugin's Y.Text is non-empty. (Violates P16.)
- `history()` in the joiner's extension stack. (Violates P5.)
- Direct comparison `annotation._type === "revision"` (use `isAnnotationOfType`). (Pre-existing repo rule, still applies.)

---

## Phase Mapping

Proposed phase structure for v1.1. Each pitfall is tagged with the phase that must mitigate it; earlier phases establish invariants downstream phases depend on.

| Phase | Name | Pitfalls addressed | Deliverables |
|-------|------|--------------------|--------------|
| 1 | Invariants & Test Harness | P1, P14, P2 (declare), F-6 (declare) | `flushAll` helper; tests 1, 2, 10 (stubbed, asserting current state); top-of-file invariant comments; lint rule or codemod check against specific-effect imports in sync plugin |
| 2 | Room-as-View Architecture Solidify | P5, P11, F-5, F-6 | D-100 joiner view with no `history()`; initial annotationField empty guarantee; tests 3, 4 |
| 3 | Unified Write Path (CM → Yjs) | P2, F-2 | Single `diffAndReconcile`; delete all `_<specific>` effect branches in sync plugin; test 10 passes |
| 4 | Unified Read Path (Yjs → CM) | P7, P10, F-4, P9 | observeDeep → single rebuild set → batched dispatch; `_syncInitialFromYjs` merges with normal path; test 5 passes |
| 5 | Phase 3 Removal in Collab Mode | F-1, P12 | `pushDocToVersionState` gated off when collab active; active-version Y.Text observer drives CM; test 7 passes |
| 6 | Version Switch Hardening | F-3, P4, P18 (flag) | Version switch is data-only; NestedEditorController does not fire `removeAnnotation` on destroy; test 6 passes |
| 7 | Position Anchoring | P3 | Binary encoding of RelativePosition for persistence; fallback handling for null `item`; test 8 passes |
| 8 | Detached-type + Integrity Audit | P8, P16 | Audit all `new Y.*()` sites; integration helper; test 9 passes |
| 9 | Undo Cross-Peer Validation | P6, F-5 | Explicit test for concurrent undo; captureTimeout tuning; pre-existing tests green |
| 10 | Dogfood + Property Fuzzing | P2, P13, P15 | Property test with 10k ops; Svelte-layer audit; awareness scope audit |

### Research Flags for Phase Planning

- **Phase 1** needs a **codemod/lint rule** — "no specific effect imports in sync plugin" — worth 30 minutes to write and saves a category of regressions.
- **Phase 4** has a known Yjs ordering quirk (P9 / yjs#591) — verify with a targeted test before building the full unified read path.
- **Phase 5** is the highest-risk refactor (Phase 3 removal). Expect to discover surprise dependents of the parent-slice-write-back.
- **Phase 7** depends on whether current persistence encodes RelativePositions as JSON. Audit first; if yes, also becomes a data migration concern.

---

## Sources

Primary (HIGH):
- `src/lib/collab/yjsAnnotations.ts` (current implementation, direct read)
- `src/lib/collab/test-helpers/twoPeerHarness.ts` (direct read)
- `.planning/milestones/v1.0-phases/09-fix-live-collab-revision-editing-bugs/09-CONTEXT.md` (D-100 through D-110)
- `.planning/milestones/v1.0-phases/11-unified-subtree-sync-rebuild/11-RESEARCH.md` (existing pitfall list + patterns)

Secondary (MEDIUM/HIGH — Yjs upstream issues, verified):
- [y-prosemirror #85 — Infinite cursor awareness loop](https://github.com/yjs/y-prosemirror/issues/85) → P1, P15
- [yjs #340 — RelativePosition end-of-text JSON encoding](https://github.com/yjs/yjs/issues/340) → P3
- [yjs #657 — Inconsistency creating absolute from relative](https://github.com/yjs/yjs/issues/657) → P3
- [yjs #666 — Y.Map properties before attachment](https://github.com/yjs/yjs/issues/666) → P8
- [yjs #210 — Y.Map doc not set when inserted into Y.Array](https://github.com/yjs/yjs/issues/210) → P8
- [yjs #273 — Merging undo from different sources](https://github.com/yjs/yjs/issues/273) → P6
- [yjs #327 — unobserve function return](https://github.com/yjs/yjs/issues/327) → P10, P17
- [yjs #591 — Misordered updates / missing Y.Map keys](https://github.com/yjs/yjs/issues/591) → P9
- [yjs #642 — Undo of set+delete corrupts one client](https://github.com/yjs/yjs/issues/642) → P6
- [discuss.yjs.dev — Initial Data Duplication](https://discuss.yjs.dev/t/issue-with-initial-data-duplication-in-collaborative-editor/2170) → P11
- [discuss.yjs.dev — deepObserve subdocuments](https://discuss.yjs.dev/t/how-to-deepobserve-subdocuments/1555) → P9
- [docs.yjs.dev — UndoManager](https://docs.yjs.dev/api/undo-manager) → P6, F-5
- [docs.yjs.dev — RelativePosition](https://docs.yjs.dev/api/relative-positions) → P3
- [y-codemirror.next README](https://github.com/yjs/y-codemirror.next) → P1, P5, P16

Tertiary (LOW — general references):
- CodeMirror 6 annotations docs (remoteness annotation pattern)
- Svelte 5 runes docs (P13 inferred)

## Confidence Assessment

| Area | Confidence | Reason |
|------|-----------|--------|
| F-1 through F-6 root cause | HIGH | Derived from direct code + 09-CONTEXT read |
| P1, P2, P7, P10, P11 | HIGH | Verified against our code + at least one Yjs upstream issue |
| P3, P6, P8, P9 | HIGH | Direct Yjs issue links with matching symptoms |
| P5 | HIGH | CodeMirror history extension behavior is well-documented |
| P4, P12, P16 | MEDIUM-HIGH | Inferred from patterns + architectural reasoning |
| P13, P15, P18 | MEDIUM | Forward-looking; no direct post-mortem but plausible given patterns |
| Phase mapping | MEDIUM | Logical ordering but roadmap author may re-slice |
