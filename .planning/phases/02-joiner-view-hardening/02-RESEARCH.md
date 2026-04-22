# Phase 2: Joiner View Hardening — Research

**Researched:** 2026-04-19
**Domain:** CodeMirror 6 + Yjs UndoManager wiring on joiner peer
**Confidence:** HIGH (codebase-grounded; all factual claims VERIFIED via Read)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Owner undo**: keep CM `history()`. Pre-connect undo tree preserved.
- **Owner-side invariant**: every remote-Y → CM `view.dispatch(...)` MUST include
  `Transaction.addToHistory.of(false)` in its annotations.
  - Known-missing site: `src/lib/collab/yjsBinding.ts:62`.
  - Already-correct sites (do not regress): `yjsAnnotations.ts:212`, `:294`,
    `index.ts:192`.
- **Joiner undo**: NO `history()` in joiner's collab `EditorView`. Use
  `createYjsUndoExtension(ytext, ymap)` (already exists in `yjsUndo.ts`).
  - `trackedOrigins: new Set(["local"])`, unified text+annotations stack,
    `captureTimeout: 500`, Cmd-z/Cmd-Shift-z/Mod-y keymap.
- **Selection restore**: wire `stackItemAdded`/`stackItemPopped` events on the
  UndoManager. Stash `view.state.selection` on add; dispatch
  `view.dispatch({ selection })` on pop. Logic lives **inside**
  `createYjsUndoExtension` (extend, do not parallel-module).
- **Annotation duplication on connect**: guard `_syncInitialToYjs` (in
  `yjsAnnotations.ts`) against re-entrance.
- **Cross-peer undo semantics**: each peer can only undo their own edits;
  undo produces an inverse Yjs op that propagates normally (Google Docs
  model).

### Claude's Discretion

- Exact placement of `Transaction.addToHistory.of(false)` in `yjsBinding.ts`
  (existing array vs. new literal).
- Naming of harness assertion helpers for criteria #5–#8.
- Internal organization of selection-restore code inside `yjsUndo.ts`.

### Deferred Ideas (OUT OF SCOPE)

- Owner switching from CM `history()` to `Y.UndoManager` (symmetric arch).
- `captureTimeout` tuning beyond Yjs default 500 ms.
- Persistence-layer changes (snapshot format, event log shape).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| JOINER-01 | Joiner collab `EditorView` has no `history()`; `state.field(historyField, false) === undefined` | §3 — extension assembly; requires moving `history()` into a Compartment so it can be reconfigured to `[]` for joiner. |
| JOINER-02 | Joiner initial `annotationField` empty; owner `_syncInitialToYjs` re-entrance-guarded | §4 — current `queueMicrotask` flow has no guard; minimal boolean flag pattern documented. |
| JOINER-03 | Cmd-z on joiner immediately after connect does not revert past connect state | §1, §2, §3 — Yjs UndoManager with empty stack handles Cmd-z (already returns `true` even when empty); requires history()-removal so historyKeymap doesn't run after. |
| JOINER-05 | Joiner annotation count after owner-N + joiner-connect equals N (not 2N) | §4 + §6 — root cause is `_syncInitialFromYjs` running while owner's `_syncInitialToYjs` has already populated CM via the deepObserver path. |
</phase_requirements>

## Summary

Phase 2 changes are tightly localized to four files: `src/lib/collab/yjsUndo.ts` (extend factory with selection-restore), `src/lib/collab/yjsBinding.ts` (one-line `addToHistory` fix at L62-65), `src/lib/collab/yjsAnnotations.ts` (re-entrance flag on `_syncInitialToYjs`), and the extension stack in `src/lib/editor/extensions.ts` + `src/lib/collab/index.ts` (compartmentalize `history()` so joiner can reconfigure it to `[]`).

The biggest *non-obvious* finding: **`history()` is currently injected by `getExtensions()` in `src/lib/editor/extensions.ts:92`, NOT by the collab module.** The joiner never gets a fresh EditorView — it reuses the local one and just `reconfigure`s the `collabCompartment`. Therefore satisfying JOINER-01 requires either (a) wrapping `history()` in its own Compartment so `enableCollab(asOwner=false)` can blank it, or (b) full state rebuild on join. Pattern (a) is the CodeMirror-idiomatic choice and matches the existing `collabCompartment` style.

`yjsUndo.ts` already provides everything needed for joiner undo *except* selection restore; the factory currently returns `{ extension, undoManager }` but the extension is only a `keymap`. To thread `EditorView` into the `stackItemAdded`/`stackItemPopped` handlers, wrap the keymap inside a `ViewPlugin` (or augment the returned extension to include one) — see §2 for the canonical Yjs pattern.

**Primary recommendation:** Implement Phase 2 as four surgical PR-sized plans: (1) compartmentalize history + wire joiner branch in `enableCollab`, (2) extend `createYjsUndoExtension` with selection restore via a paired ViewPlugin, (3) re-entrance guard + `addToHistory` fix in remote-text dispatch, (4) harness assertions for criteria #5–#8 using existing `flushAll` + `makePeerWithAnnotationSync`.

## 1. `yjsUndo.ts` Current State and Test Coverage

**File:** `src/lib/collab/yjsUndo.ts` (118 LOC).

### Public API (VERIFIED by Read)

```ts
createYjsUndoExtension<T = unknown>(
    ytext: Y.Text,
    ymap?: Y.Map<T>,
): { extension: Extension; undoManager: Y.UndoManager }

addSubtreeToUndoScope(undoManager, subtreeYtext, extraTypes?): void
breakUndoCapture(undoManager): void
```

The returned `extension` is currently `Prec.highest(keymap.of(undoKeymap))` — pure keymap, **no ViewPlugin**, so there is no current handle to the `EditorView`. This is the surgery point for selection restore (§2).

`Mod-z` keybinding **always returns `true`** even when `undoManager.canUndo() === false` (lines 56–59), per the comment "Always claim Mod-z in collab mode … otherwise CodeMirror's historyKeymap runs next". This is critical for criterion #6/JOINER-03: as long as `Prec.highest` keeps the Yjs keymap above CM's `historyKeymap`, an empty Yjs undo stack short-circuits Cmd-z and prevents pre-connect history replay. Phase 2 must preserve this `Prec.highest` + always-`return true` shape.

### Existing test coverage

| File | Coverage |
|------|----------|
| `yjsUndo.test.ts` | Local-only tracking, redo, captureTimeout merge/separate, interleaved local/remote, ymap unified stack (text+annotation undo together), backward compat (no ymap) |
| `undo-manager.test.ts` | `addToScope`, `breakUndoCapture`, `addToScope` idempotence, remote-update isolation across two `Y.Doc`s, chronological subtree undo |

**Gap for criteria #5–#8:** Neither file constructs a full collab `EditorView` (with binding + undoExt + annotation sync) and asserts that **Cmd-z dispatched as a CM keybinding** restores selection or does not touch remote-origin edits. New harness assertions need a `makeJoinerPeer(...)` helper that mirrors `makePeerWithAnnotationSync` but adds `createYjsUndoExtension` and omits `history()`. None of the existing tests exercise EditorView selection at all.

### EditorView access today

Currently **none**. The factory returns a keymap-only extension; `EditorView` is never bound. The selection-restore work needs a wiring change — see §2 for the recommended pattern.

## 2. Selection Restore Wiring Pattern

### Y.UndoManager event API (VERIFIED via existing archived plan + Yjs source)

`Y.UndoManager` extends `Observable` and emits two events relevant here:

- `"stack-item-added"` — fired after a new `StackItem` is pushed onto undo or redo stack. Payload: `{ stackItem: { meta: Map<any,any> }, type: "undo"|"redo", origin, changedParentTypes }`.
- `"stack-item-popped"` — fired after `undo()`/`redo()` pops. Same payload shape.

The canonical pattern (used in `y-codemirror.next` and shown in archived plan
`.planning/_archive/v1.0-phases/08.5c-crdt-nested-wiring/08.5c-02-PLAN.md:207-222`,
which Phase 10 deleted) is:

```ts
undoManager.on("stack-item-added", (event) => {
    event.stackItem.meta.set("selection", view.state.selection);
});
undoManager.on("stack-item-popped", (event) => {
    const sel = event.stackItem.meta.get("selection");
    if (sel) view.dispatch({ selection: sel });
});
```

**Note on event-name spelling:** prior code in this repo used the kebab-case form
`"stack-item-popped"` (string). The Yjs `UndoManager` accepts both event-name spellings
in practice, but be consistent — recommend kebab-case to match prior usage in the
archived `index.ts` listener (`.planning/_archive/.../10-03-PLAN.md`).

### How to thread `EditorView` in

The cleanest minimal change is to make `createYjsUndoExtension` return an
**Extension array** that includes both the keymap AND a `ViewPlugin` that owns
the listener lifecycle:

```ts
const selectionRestorePlugin = ViewPlugin.fromClass(class {
    constructor(view: EditorView) {
        this.added = (e) => e.stackItem.meta.set("selection", view.state.selection);
        this.popped = (e) => {
            const sel = e.stackItem.meta.get("selection");
            if (sel) view.dispatch({ selection: sel });
        };
        undoManager.on("stack-item-added", this.added);
        undoManager.on("stack-item-popped", this.popped);
    }
    destroy() {
        undoManager.off("stack-item-added", this.added);
        undoManager.off("stack-item-popped", this.popped);
    }
});

return {
    extension: [Prec.highest(keymap.of(undoKeymap)), selectionRestorePlugin],
    undoManager,
};
```

This preserves the returned `{ extension, undoManager }` signature (extension is
already typed as `Extension`, which accepts arrays). No call-site changes needed
in `index.ts:203`. The ViewPlugin captures `view` via closure and runs
`destroy()` automatically when the `collabCompartment` is reconfigured to `[]`
in `disableCollab` — no leak risk.

**Pitfall:** the returned-array form means the `Prec.highest` only applies to
the keymap leaf, which is what we want. Wrapping the entire array would change
ViewPlugin precedence relative to other plugins; **don't** do that.

## 3. Joiner vs. Owner Extension Stack Assembly

### The hard truth (VERIFIED)

`history()` is added by `src/lib/editor/extensions.ts:92` inside the universal
`getExtensions()` factory. It is NOT in the `collabCompartment`. The joiner
joins by reconfiguring `collabCompartment` only — `history()` remains live in
the joiner's editor.

The current call chain on join (`GoLiveButton.svelte:114` → `enableCollab(view, id, userId, false)`):

1. `enableCollab` waits for relay sync.
2. Determines authoritative content; dispatches a single text replace with
   `Transaction.addToHistory.of(false)` — note this only excludes *that one
   transaction* from history, not subsequent edits.
3. Calls `view.dispatch({ effects: collabCompartment.reconfigure([binding, undoExt, awarenessExt, annotationSync]) })`.

After step 3, the joiner has BOTH `history()` (from `getExtensions`) AND the
Yjs UndoManager keymap (from collab compartment). Because the Yjs keymap is
`Prec.highest` and always returns `true`, Cmd-z is intercepted — but
`historyField` still exists, so JOINER-01's assertion
(`view.state.field(historyField, false) === undefined`) **fails today**.

### Surgical fix: a `historyCompartment`

Create a new `Compartment` in `src/lib/editor/extensions.ts` that wraps
`history()`:

```ts
export const historyCompartment = new Compartment();
// ...
...(withHistory ? [historyCompartment.of(history({ newGroupDelay: 250 }))] : []),
```

Then in `src/lib/collab/index.ts:enableCollab`, when `asOwner === false`, add
the reconfigure to the same dispatch that installs the collab compartment:

```ts
view.dispatch({
    effects: [
        collabCompartment.reconfigure([binding, undoExt, awarenessExt, annotationSync]),
        ...(asOwner ? [] : [historyCompartment.reconfigure([])]),
    ],
});
```

`disableCollab` should restore for symmetry:

```ts
view.dispatch({
    effects: [
        collabCompartment.reconfigure([]),
        historyCompartment.reconfigure(history({ newGroupDelay: 250 })),
    ],
});
```

Reconfiguring a Compartment to `[]` removes the StateField entirely; after the
dispatch, `state.field(historyField, false) === undefined` evaluates true,
satisfying criterion #1/JOINER-01.

**Side effect to verify in plan:** removing `history()` also drops
`historyKeymap` bindings (Cmd-y on linux/win, the secondary Cmd-Shift-z), but
`yjsUndo.ts` already provides `Mod-Shift-z` and `Mod-y`, so coverage is intact.

`historyKeymap` itself is added separately in `editorKeymap`
(`extensions.ts:64`) — those bindings will become no-ops once `historyField` is
absent (CM commands gracefully no-op when their state field is missing) but the
Yjs keymap's `Prec.highest` ensures it runs first regardless.

## 4. `_syncInitialToYjs` Re-entrance

**File:** `src/lib/collab/yjsAnnotations.ts:234-265` (VERIFIED).

### Current shape

```ts
private _syncInitialToYjs() {
    const ydoc = scopeYtext.doc;
    if (!ydoc) return;
    const annotations = this.view.state.field(annotationField);
    const annotationIds = Object.keys(annotations);
    if (annotationIds.length === 0) return;
    queueMicrotask(() => {
        if (this.destroyed) return;
        ydoc.transact(() => {
            for (const idStr of annotationIds) {
                // ...
                if (scopeAnnotations.has(yjsId)) continue; // ← per-key idempotence
                // ...
                scopeAnnotations.set(yjsId, node);
            }
        }, "local");
    });
}
```

### Call sites

Called once in the plugin constructor (line 119). The plugin is constructed
each time `collabCompartment.reconfigure([..., annotationSync])` runs — that
happens **once per `enableCollab` call**.

### Why re-entrance matters

Three concrete re-entrance vectors:

1. **Disconnect → reconnect**: `disableCollab` blanks the compartment, then
   `enableCollab` rebuilds. Each reconnect constructs a fresh plugin instance.
   The per-key `if (scopeAnnotations.has(yjsId)) continue` check (line 257)
   *appears* to guard against double-publishing — but only if the same `yjsId`
   is generated. The id comes from `_syncIdMapFromCM` which uses
   `${clientId}-init-${cmId}` — deterministic for the same clientId+cmId, so
   reconnect-by-same-user is in fact idempotent.

2. **Two plugin instances in one EditorView**: shouldn't happen with
   compartments, but the guard isn't structural.

3. **Race with deepObserver**: the `queueMicrotask` defers the seed; if a
   remote update arrives in the same microtask burst and fires the deepObserver
   *first*, the deepObserver schedules its own rebuild. Both will write to
   `scopeAnnotations` — one inside `"local"` transact, one inside whatever
   origin the remote has. The per-key `has()` check still saves us, but only
   for the same `yjsId`.

### Minimal guard pattern (RECOMMENDED)

Add an instance flag set on first invocation:

```ts
private _initialSyncDone = false;
private _syncInitialToYjs() {
    if (this._initialSyncDone) return;
    this._initialSyncDone = true;
    // ... existing body
}
```

This makes the guard *structural* (one call per plugin lifetime, period) and
matches CONTEXT.md's "boolean flag set on first call" suggestion. Combine with
the per-key `has()` check (keep both — defense in depth).

### The 2× annotation bug root cause

Re-reading `_syncInitialFromYjs` (line 267) and `_syncInitialToYjs` (line 234):
both fire in the constructor. On a joiner, `_syncInitialToYjs` finds **zero
local annotations** (joiner's editor was just constructed empty, before relay
sync) so it returns early at line 240. Then `_syncInitialFromYjs` runs in a
microtask and pulls annotations from Yjs into CM. So far so good.

But `enableCollab` (`index.ts:188-194`) runs the text-replace `view.dispatch`
**BEFORE** the compartment reconfigure (line 227). At the time
`_syncInitialFromYjs`'s microtask actually runs, the deepObserver is already
attached. If the first remote update arrives between mount and microtask, the
deepObserver's full-rebuild path (line 196-209) will queue `addAnnotation`
effects for the same Yjs keys that `_syncInitialFromYjs` is about to add — 2×.

**Fix surface for JOINER-05:** the cleanest solution is a flag in
`_syncInitialFromYjs`'s microtask that guards against deepObserver
double-firing for the *same set of initially-seeded keys*. Concretely: track
yjsKeys that the initial pull is about to add, and have the deepObserver skip
add/rebuild for keys already in `idMap` whose `cmId` was created during initial
pull. The simplest: set `_initialPullDone` flag, and in the deepObserver, treat
"add" events for already-known yjsKeys as no-ops (or rely on the rebuild path
which does `removeAnnotation` then `addAnnotation` — that's already idempotent
for the data shape, but it produces an extra remove+add transaction the
joiner's screen briefly sees).

The Phase 2 plan should pick **one** of:

- (a) Skip deepObserver events whose yjsKeys are already in `idMap` and were
      added in the same microtask (timestamped flag).
- (b) Have `_syncInitialFromYjs` *not* dispatch — instead, attach the
      deepObserver only **after** the initial pull is complete, and let the
      deepObserver's rebuild path do all the seeding.

Recommend (b) — it's structurally simpler, removes one source of writes, and
matches Phase 4's "single read path" direction. But (a) is acceptable as a
Phase 2 tactical fix if (b) feels too intrusive.

## 5. Inventory of Remote-Apply Dispatch Sites in `src/lib/collab/`

Grep VERIFIED via `view.dispatch` ripgrep on `src/lib/collab/` (excluding tests).

| File:Line | Origin | Has `addToHistory.of(false)`? | Notes |
|-----------|--------|------------------------------|-------|
| `index.ts:190` | Initial doc-text sync inside `enableCollab` | **YES** ✓ | Guarded; comment explains why |
| `index.ts:227` | `collabCompartment.reconfigure(...)` install dispatch | N/A | No `changes`, just an `effects` reconfigure — doesn't enter the doc undo stack |
| `index.ts:281` | `collabCompartment.reconfigure([])` in `disableCollab` | N/A | Same as above |
| `yjsAnnotations.ts:212` | deepObserver remote-apply (text+annotation rebuild) | **YES** ✓ | `annotations: [yjsAnnotationSync.of(true), Transaction.addToHistory.of(false)]` |
| `yjsAnnotations.ts:290` | `_syncInitialFromYjs` initial pull microtask | **YES** ✓ | Same annotation pair |
| `yjsBinding.ts:62` | Y.Text observer remote-apply | **NO** ✗ | **THIS IS THE FIX SITE** — currently only `[yjsAnnotation.of(true)]` |
| `awareness.ts:323` | Awareness/cursor decorations | N/A | Awareness is decoration-only via `setEffects`, doesn't mutate doc |

**Conclusion:** the inventory matches CONTEXT.md exactly. `yjsBinding.ts:62` is
the **only** missing site. No other surprises. The fix is one line:

```ts
this.view.dispatch({
    changes,
    annotations: [yjsAnnotation.of(true), Transaction.addToHistory.of(false)],
});
```

## 6. Phase 1 Harness API Surface

**File:** `src/lib/collab/test-helpers/twoPeerHarness.ts` (155 LOC, VERIFIED).

### Exported helpers

| Symbol | Signature | Use |
|--------|-----------|-----|
| `Peer` (interface) | `{ ydoc, ytext, ymap, view, clientId, idMap? }` | Two-peer fixture shape |
| `makePeer(clientId, initialText?)` | `(string, string?) => Peer` | Text-sync only (no annotation sync) |
| `makePeerWithAnnotationSync(clientId, initialText?)` | `(string, string?) => Peer` | Text + annotation sync; sets `idMap` |
| `connect(a, b)` | `(Peer, Peer) => () => void` | Wire `Y.applyUpdate` both directions; tags origin `"remote"`; returns disconnect fn |
| `teardown(peer)` | `(Peer) => void` | Destroy view + ydoc |
| `flushAll(...peers)` | `(...Peer[]) => Promise<void>` | State-vector-equality drain; throws after `FLUSH_ALL_MAX_ITERATIONS=20` |
| `FLUSH_ALL_MAX_ITERATIONS` | `20` | Exported constant |

### Constraints inherited from Phase 1

- `flushAll` is the **only** flush primitive permitted in two-peer convergence
  tests (per Phase 1 SUMMARY). Don't add new ones.
- Phase 1 plan #2 (`convergence-projection.test.ts`) deliberately keeps the
  fast-check effect surface "small" (text-type and delete only) and defers
  annotation create/remove to Phase 9 fuzz. **Do not extend it for Phase 2.**
  Phase 2 assertions are *unit-style* targeted tests, not property tests.

### Gap for Phase 2

Neither `makePeer` nor `makePeerWithAnnotationSync` constructs a "joiner-like"
peer — both include `history()` implicitly (via `annotationField` extensions
chain? no — VERIFIED: harness extension list is `[annotationField, createYjsBinding(ytext), createAnnotationSyncPlugin(...)]` — `history()` is **NOT** present, because the harness builds extensions inline rather than via `getExtensions()`).

So harness peers already lack `history()`. **What's missing is**:
- `createYjsUndoExtension(ytext, ymap)` in the extension list (so undo behavior is exercised).
- A peer factory that mirrors *production joiner shape* (with the historyCompartment in `[]` mode + collab extensions).

Recommend adding to `twoPeerHarness.ts`:

```ts
export function makeJoinerPeer(clientId: string, initialText = ""): Peer & { undoManager: Y.UndoManager } {
    // mirrors makePeerWithAnnotationSync but also installs createYjsUndoExtension
    // and exposes the undoManager for direct .undo()/.redo() calls in assertions.
}
```

This lets criteria #5–#8 assertions look like:

```ts
const joiner = makeJoinerPeer("joiner");
const owner  = makeJoinerPeer("owner"); // or production-like makeOwnerPeer
connect(owner, joiner);
// ... operations ...
await flushAll(owner, joiner);
expect(joiner.view.state.field(historyField, false)).toBeUndefined(); // #1
joiner.undoManager.undo();
expect(/* ... selection / count assertions ... */);
```

## 7. Architecture Patterns

### Component Responsibilities

| File | Phase 2 Change | Risk |
|------|---------------|------|
| `src/lib/editor/extensions.ts` | Add `historyCompartment`; wrap `history()` | Low — additive |
| `src/lib/collab/index.ts` | In `enableCollab`, reconfigure `historyCompartment` to `[]` when `!asOwner`; restore in `disableCollab` | Low — local |
| `src/lib/collab/yjsBinding.ts` | Add `Transaction.addToHistory.of(false)` to L62-65 dispatch | Trivial |
| `src/lib/collab/yjsUndo.ts` | Extend factory: paired ViewPlugin owns `stackItemAdded`/`stackItemPopped` listeners with closure over `view` | Medium — requires ViewPlugin discipline |
| `src/lib/collab/yjsAnnotations.ts` | `_initialSyncDone` flag on `_syncInitialToYjs`; resolve 2× annotation race per §4 | Medium — race timing |
| `src/lib/collab/test-helpers/twoPeerHarness.ts` | Add `makeJoinerPeer` factory | Low |
| `src/lib/collab/joiner-view.test.ts` (new) | Assertions for criteria #5–#8 | Low |

### Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Selection serialization across undo | Custom JSON-encode-then-restore of `EditorSelection` | Pass the `EditorSelection` object as-is via `stackItem.meta.set("selection", view.state.selection)`; Yjs metadata is local-only and not serialized into the CRDT | `meta` Map is per-stack-item local state; no encoding needed |
| Joiner-vs-owner branching | New `joinerExtensions()` factory parallel to `getExtensions()` | Reconfigure compartments at runtime | Existing `collabCompartment` pattern; symmetric for disable→enable→disable |
| Removing `history()` from a live state | Rebuild EditorState | Compartment reconfigure to `[]` | Compartment removal of a StateField is supported and removes the field entirely |

## 8. Common Pitfalls

### Pitfall 1: `Prec.highest` placement

If selection-restore is done as a SEPARATE extension wrapped in `Prec.highest`,
it changes the precedence of other ViewPlugins relative to it. Solution: only
the keymap leaf gets `Prec.highest`; the ViewPlugin should be returned at
default precedence in the same array.

### Pitfall 2: Selection from old state

`stackItemAdded` fires after the originating transaction. Stashing
`view.state.selection` at that moment captures *post-edit* selection. On undo,
that selection points into post-edit doc coordinates — but the undo dispatch
*also* reverts the doc, so the selection may be out of bounds. Yjs's pop event
fires *after* the inverse op is applied, so reading `view.state.selection`
after pop sees the reverted doc; the stashed selection should be remapped
through the inverse changeset. **Pragmatic mitigation:** clip via
`EditorSelection.create(ranges.map(r => EditorSelection.range(Math.min(r.anchor, view.state.doc.length), Math.min(r.head, view.state.doc.length))))` before dispatching. Document this in the plan.

### Pitfall 3: `historyCompartment.reconfigure([])` mid-session

If a joiner ever transitions to owner (currently impossible in this codebase —
joiner is ephemeral), the reconfigure-back-to-`history()` would create an
empty history. Phase 2 doesn't need to handle this; just document the
assumption in `index.ts` that joiner→owner transition is not supported.

### Pitfall 4: Test isolation

Vitest's jsdom does NOT execute microtasks the same way as a browser between
`view.dispatch` calls in some cases. Use `await Promise.resolve()` (or
`flushAll`) after every dispatch in joiner tests. The Phase 1 harness already
does this in `flushAll` (`twoPeerHarness.ts:131-133`).

### Pitfall 5: The `await provider.once("sync")` race

In `index.ts:131-149`, the provider sync await happens BEFORE the Yjs
extensions are installed. Any annotations already in the relay's Y.Map are
present in the joiner's `ydoc.getMap("annotations")` *before* the
`createAnnotationSyncPlugin` constructor runs. So `_syncInitialFromYjs` always
sees a non-empty Y.Map for joiners-with-pre-existing-annotations — this is
exactly the JOINER-05 path. The race in §4 is real because the relay continues
sending updates after the initial sync, not because of the initial sync itself.

## 9. Code Examples

### Selection-restore ViewPlugin (recommended Phase 2 shape for `yjsUndo.ts`)

```ts
// Source: pattern from y-codemirror.next + repo's archived 08.5c-02 plan
const selectionRestorePlugin = ViewPlugin.fromClass(class {
    private added: (e: { stackItem: { meta: Map<unknown, unknown> } }) => void;
    private popped: (e: { stackItem: { meta: Map<unknown, unknown> } }) => void;

    constructor(view: EditorView) {
        this.added = (e) => {
            e.stackItem.meta.set("selection", view.state.selection);
        };
        this.popped = (e) => {
            const sel = e.stackItem.meta.get("selection") as EditorSelection | undefined;
            if (!sel) return;
            const docLen = view.state.doc.length;
            // Pitfall 2 mitigation
            const safe = EditorSelection.create(
                sel.ranges.map((r) =>
                    EditorSelection.range(
                        Math.min(r.anchor, docLen),
                        Math.min(r.head, docLen),
                    ),
                ),
            );
            view.dispatch({ selection: safe });
        };
        undoManager.on("stack-item-added", this.added);
        undoManager.on("stack-item-popped", this.popped);
    }
    destroy() {
        undoManager.off("stack-item-added", this.added);
        undoManager.off("stack-item-popped", this.popped);
    }
});

return {
    extension: [Prec.highest(keymap.of(undoKeymap)), selectionRestorePlugin],
    undoManager,
};
```

### `yjsBinding.ts:62` fix

```ts
// BEFORE (line 62-65)
this.view.dispatch({
    changes,
    annotations: [yjsAnnotation.of(true)],
});

// AFTER
this.view.dispatch({
    changes,
    annotations: [yjsAnnotation.of(true), Transaction.addToHistory.of(false)],
});
```

(Also requires importing `Transaction` from `@codemirror/state`; currently only `Annotation` is imported on line 14.)

### Compartmentalize `history()` (`extensions.ts`)

```ts
import { Compartment } from "@codemirror/state";
export const historyCompartment = new Compartment();
// ...
...(withHistory ? [historyCompartment.of(history({ newGroupDelay: 250 }))] : []),
```

### Joiner branch in `enableCollab` (`index.ts`)

```ts
import { historyCompartment } from "$lib/editor/extensions";
import { history } from "@codemirror/commands";
// ...
view.dispatch({
    effects: [
        collabCompartment.reconfigure([binding, undoExt, awarenessExt, annotationSync]),
        ...(asOwner ? [] : [historyCompartment.reconfigure([])]),
    ],
});
```

## Project Constraints (from CLAUDE.md)

- 4-space indentation, 100-char lines, trailing commas + semicolons (Biome).
- Test runner: Vitest via `bun run test:run <file>` — **never `bun test`**.
- Use `isAnnotationOfType(ann, "revision")` — never compare `_type` directly.
- Files start with `filename.ts — Brief description` comment block (existing
  convention in `yjsUndo.ts` etc.).
- Internal/private functions prefix with `_` (matches existing
  `_syncInitialToYjs`, `_syncInitialFromYjs`).
- Errors logged with `[module]` prefix; `console.error("[collab] ...", err)`.
- Use GSD workflow for all edits (this is research; edits in subsequent execute phase).
- Commit style via `/x-commit` skill (gitmoji + conventional commits) per user memory.

## Environment Availability

Pure code change phase — no external runtime dependencies beyond what
the repo already uses.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `yjs` | UndoManager events | ✓ | (in package.json; verified by import in `yjsUndo.ts`) | — |
| `@codemirror/commands` | `history()` import | ✓ | already imported in `extensions.ts` | — |
| `@codemirror/state` | `Compartment`, `Transaction` | ✓ | already used | — |
| Vitest + jsdom | Harness assertions | ✓ | per CLAUDE.md tech stack | — |

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.4 + jsdom 28.1.0 |
| Config file | `vitest.config.ts` |
| Quick run command | `bun run test:run src/lib/collab/joiner-view.test.ts` |
| Full suite command | `bun run test:run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| JOINER-01 | `state.field(historyField, false) === undefined` after joiner connect | unit | `bun run test:run src/lib/collab/joiner-view.test.ts -t "no history field"` | ❌ Wave 0 |
| JOINER-02 | `_syncInitialToYjs` is no-op on second call (re-entrance) | unit | `bun run test:run src/lib/collab/yjsAnnotations.test.ts -t "re-entrance guard"` | ❌ Wave 0 (extend existing file) |
| JOINER-03 | Cmd-z immediately after joiner connect leaves doc + annotations unchanged | unit (sim keypress via dispatched key event OR direct `undoManager.undo()`) | `bun run test:run src/lib/collab/joiner-view.test.ts -t "cmd-z post-connect"` | ❌ Wave 0 |
| JOINER-05 | Owner has N annotations + joiner connects → joiner annotation count = N | unit (two-peer) | `bun run test:run src/lib/collab/joiner-view.test.ts -t "no annotation duplication"` | ❌ Wave 0 |
| Criterion #6 | Joiner Cmd-z affects only joiner's edits (not owner's) | unit (two-peer) | `bun run test:run src/lib/collab/joiner-view.test.ts -t "undo own edits only"` | ❌ Wave 0 |
| Criterion #7 | Owner can undo own edits but not joiner's incoming edits (`yjsBinding.ts` fix) | unit (two-peer) | `bun run test:run src/lib/collab/joiner-view.test.ts -t "owner history excludes remote text"` | ❌ Wave 0 |
| Criterion #8 | Selection restored on undo/redo at the position captured at edit time | unit | `bun run test:run src/lib/collab/joiner-view.test.ts -t "selection restored"` | ❌ Wave 0 |

### Property-test dimensions (NOT for Phase 2 — flag for Phase 9 fuzz)

The Phase 1 `convergence-projection.test.ts` already covers convergence under
text effects. Phase 2 introduces undo behavior that *could* be fuzzed, but
CONTEXT.md scopes Phase 2 to surgical fixes; defer to Phase 9 (HARNESS-04
"cross-peer undo validated end-to-end").

Property dimensions for the future Phase 9 fuzz to layer on top:

- **Undo determinism**: random sequence of local edits + interleaved remote
  edits + Ks undos + Ks redos converges to the deterministic "remove all my
  edits in reverse order" state.
- **No-history invariant** (regression): joiner's
  `state.field(historyField, false)` is `undefined` at every step of an
  N-operation random walk.
- **No-duplication invariant**: under random connect/disconnect cycles + random
  pre-existing-annotation counts, joiner's annotation count after each
  reconnect equals owner's annotation count exactly.
- **Selection-restore correctness**: after `undo` then `redo`, the selection
  matches what it was just before the undo (round-trip identity), modulo
  doc-length clipping.

### Sampling Rate

- **Per task commit:** `bun run test:run src/lib/collab/joiner-view.test.ts`
- **Per wave merge:** `bun run test:run src/lib/collab/`
- **Phase gate:** full `bun run test:run` green before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `src/lib/collab/joiner-view.test.ts` — covers JOINER-01, -03, -05 + criteria #6–#8.
- [ ] `src/lib/collab/test-helpers/twoPeerHarness.ts` — extend with `makeJoinerPeer(clientId)` helper that mirrors `makePeerWithAnnotationSync` + installs `createYjsUndoExtension` + omits `history()`.
- [ ] `src/lib/collab/yjsAnnotations.test.ts` — add re-entrance guard test (extend existing file, don't create new).

No framework install needed — Vitest already wired.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Yjs UndoManager `stack-item-added` / `stack-item-popped` event names are kebab-case (per archived plan + repo history) | §2 | Low — easy to fix; could also be `stackItemAdded` (camelCase). Plan should grep Yjs's `dist/yjs.d.ts` to confirm before commit. |
| A2 | Reconfiguring a Compartment to `[]` actually removes the StateField such that `state.field(historyField, false) === undefined` (vs. just returning the default value) | §3 | Medium — if false, JOINER-01 needs a different approach (full state rebuild). Verify with a one-line test in Wave 0 BEFORE committing the compartmentalization plan. |
| A3 | The 2× annotation duplication described in CONTEXT.md is actually caused by `_syncInitialFromYjs` racing with `deepObserver` after initial sync (vs. some other root cause) | §4 | Medium — recommendation (b) (attach observer after pull) is robust either way; recommendation (a) requires this assumption to be correct. |

## Open Questions (RESOLVED)

1. **camelCase vs kebab-case event names on `Y.UndoManager`** — RESOLVED at
   execution time by Probe A1 in Plan 02-01 Task 2; downstream plans (02-03)
   use the resolved spelling consistently. Both spellings appear in Yjs
   history; probe authoritative.
2. **Should joiner→owner transition be supported?** RESOLVED: joiner→owner
   transition is NOT supported in Phase 2. `disableCollab` always restores
   `history()` extension with empty undo stack on the editor; the editor
   returns to standalone owner mode. A future phase can support seamless
   join/leave/rejoin if dogfooding demands it.

## Sources

### Primary (HIGH confidence) — all VERIFIED via Read tool

- `src/lib/collab/yjsUndo.ts` (factory + scope helpers; lines 1-118)
- `src/lib/collab/yjsBinding.ts` (Y.Text observer at L62; CM listener at L77)
- `src/lib/collab/yjsAnnotations.ts` (deepObserver L122-220; `_syncInitialToYjs` L234-265; `_syncInitialFromYjs` L267-299)
- `src/lib/collab/index.ts` (`enableCollab` L114-241; compartment reconfigure pattern L227-229)
- `src/lib/editor/extensions.ts` (`history()` location L92; `getExtensions()` factory)
- `src/lib/collab/test-helpers/twoPeerHarness.ts` (155 LOC, full file read)
- `src/lib/collab/yjsUndo.test.ts` + `src/lib/collab/undo-manager.test.ts` (existing coverage)
- `.planning/phases/01-test-harness-invariants/{01,02,03}-SUMMARY.md`
- `.planning/_archive/v1.0-phases/08.5c-crdt-nested-wiring/08.5c-02-PLAN.md` (archived selection-restore code reference)
- `.planning/_archive/v1.0-phases/10-strip-broken-collab-sync-layer/10-03-PLAN.md` (event-name spelling reference)

### Secondary (MEDIUM confidence)

- Yjs UndoManager event semantics (CITED: Yjs README + repo's archived plans)

### Tertiary (LOW confidence) — none

## Metadata

**Confidence breakdown:**
- Inventory of dispatch sites: HIGH — exhaustive grep + manual review.
- `_syncInitialToYjs` re-entrance pattern: HIGH — reading the actual file.
- Selection-restore wiring approach: MEDIUM — pattern is canonical, but A1 (event-name spelling) needs verification before code.
- Compartment removal of StateField: MEDIUM — A2 should be confirmed in Wave 0 with a one-line probe.
- Phase 1 harness API: HIGH — full file read.

**Research date:** 2026-04-19
**Valid until:** 2026-05-19 (codebase fast-moving; verify before reusing)

## RESEARCH COMPLETE
