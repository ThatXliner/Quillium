# Architecture Overview

Quillium is built as a modern web application using SvelteKit, packaged as a cross-platform desktop app via Tauri. The architecture is dominated by the complexity of the annotation and revision system — understanding how CodeMirror state, Svelte stores, and nested editors interact is the main onboarding challenge for new contributors.

---

## Core Technologies

| Layer | Technology | Why |
|---|---|---|
| Frontend framework | SvelteKit + TypeScript | Reactivity, SSG mode for Tauri |
| Editor engine | CodeMirror 6 | Full state management, extensible plugins |
| Desktop runtime | Tauri (Rust) | Cross-platform packaging, native file I/O |
| Styling | Tailwind CSS v4 | Utility-first, co-located styles |
| State management | CodeMirror StateFields + Svelte stores | Hybrid: editor state lives in CM, UI state in Svelte |
| AI integration | Universal AI SDK | Provider-agnostic, streaming |
| Linting/formatting | Biome | 4-space indent, 80-char line width |

---

## Application Layout

The UI is a three-panel layout rendered by `src/routes/+page.svelte`:

```
┌──────────────┬──────────────────────┬──────────────────┐
│  AI Sidebar  │       Editor         │   Annotations    │
│              │                      │                  │
│  Chat        │  CodeMirror 6        │  Comment cards   │
│  Feedback    │  (816px fixed width) │  Revision cards  │
│  Revise      │  Status bar          │  Suggestion cards│
└──────────────┴──────────────────────┴──────────────────┘
```

Modal overlays (revision editors, diff views) are rendered on top via `modalStack` — a stack of `<RevisionModal>` and `<DiffModal>` instances managed by `src/lib/stores.ts`.

---

## File Structure

```
src/
├── lib/
│   ├── ai/
│   │   ├── AISidebar.svelte   # Tab picker (Chat / Feedback / Revise)
│   │   ├── AISettings.svelte  # Provider/model configuration
│   │   ├── Chat.svelte        # General AI chat
│   │   ├── DocumentContext.svelte # Context reference display
│   │   ├── Feedback.svelte    # AI feedback on document or selection
│   │   ├── Revise.svelte      # AI-powered revision generation
│   │   ├── chatFactory.ts     # Shared AI request/streaming helpers
│   │   ├── clientStreams.ts   # Streaming response handling
│   │   ├── provider.ts        # Provider-agnostic client setup
│   │   ├── settings.svelte.ts # AI settings (reactive, persisted)
│   │   └── utils.ts           # Shared AI utilities
│   ├── debug/
│   │   └── DebugPanel.svelte  # Development-only debug overlay
│   ├── editor/
│   │   ├── Editor.svelte      # CodeMirror mount point + state sync
│   │   ├── extensions.ts      # Full CodeMirror extension stack
│   │   ├── listeners.ts       # Persistence + change listeners
│   │   ├── replay.ts          # Event log replay for state reconstruction
│   │   ├── StatusBar.svelte   # Word count, WPM, character count
│   │   └── plugins/
│   │       └── annotations/
│   │           ├── models.ts          # Type defs, factory helpers, type guards
│   │           ├── annotationField.ts # StateField + all StateEffects + undo support
│   │           ├── utils.ts           # Range mapping, active annotation queries
│   │           ├── diff.ts            # Diff computation for suggestions
│   │           ├── nestedEditor.ts    # Nested editor lifecycle helpers
│   │           ├── index.ts           # Keybindings, ViewPlugins, public API
│   │           ├── Annotations.svelte # Right panel container + card positioning
│   │           ├── Comment.svelte     # Comment card
│   │           ├── DiffModal.svelte   # Full-screen diff view overlay
│   │           ├── PreComment.svelte  # Draft form for empty-thread comment
│   │           ├── Revision.svelte    # Revision card + inline nested editor
│   │           ├── RevisionModal.svelte # Full-screen nested editor overlay
│   │           ├── Suggestion.svelte  # Suggestion card with diff view
│   │           ├── Thread.svelte      # Message list inside a card
│   │           ├── ThreadMessage.svelte # Single message (with inline edit)
│   │           ├── TutorialGuide.svelte # In-editor tutorial callouts
│   │           └── default.css        # Highlight CSS classes for all annotation types
│   ├── library/
│   │   ├── ContinuePill.svelte  # "Continue writing" shortcut on library page
│   │   ├── DocumentCard.svelte  # Single document card in the grid
│   │   ├── DocumentGrid.svelte  # Grid layout for document list
│   │   ├── EmptyState.svelte    # Empty library placeholder
│   │   ├── LibraryTopBar.svelte # Library page header + actions
│   │   └── PreviewPanel.svelte  # Document preview sidebar
│   ├── save/
│   │   └── Save.svelte        # Save indicator (separated for future extension)
│   ├── settings/
│   │   └── SettingsModal.svelte # App-level settings overlay
│   ├── tutorial/
│   │   ├── Tutorial.svelte    # Onboarding tutorial overlay
│   │   └── steps.ts           # Tutorial step definitions
│   ├── stores.ts              # Global Svelte stores
│   └── settings.svelte.ts     # App settings (reactive, persisted)
└── routes/
    ├── +page.svelte           # Root layout: three panels + modal stack renderer
    └── library/               # Library page (document list, trash/restore)
```

---

## State Management Mental Model

This is the most important section to understand before touching any annotation or editor code.

### Two separate state worlds

Quillium runs two parallel state systems that must be kept in sync:

**1. CodeMirror state** — lives inside `EditorView`. Immutable, transaction-based. Every change produces a new state object. Extensions (`StateField`, `ViewPlugin`, etc.) live here. Supports undo/redo via `historyField`.

**2. Svelte stores** — reactive signals consumed by components. Do not update automatically when CodeMirror state changes. Must be manually pushed by `Editor.svelte`'s `updateListener`.

```
User types / dispatches transaction
           │
           ▼
    CodeMirror processes transaction
    ┌────────────────────────────┐
    │  historyField  (undo log)  │
    │  annotationField (our data)│
    │  document (text)           │
    └────────────┬───────────────┘
                 │ updateListener fires (Editor.svelte)
                 ▼
    Manually push to Svelte stores:
    ┌──────────────────────────────┐
    │  $annotations                │ ← read by Annotations.svelte
    │  $activeAnnotation           │ ← read by Comment/Revision cards
    │  $documentContent            │ ← read by AI sidebar
    │  $selectedText               │ ← read by AI sidebar
    │  $saveStatus                 │ ← read by StatusBar
    │  $currentDocumentTitle       │ ← read by StatusBar, library
    └──────────────────────────────┘
```

### Why `$editorView` doesn't trigger reactivity

`editorView` is a `writable<EditorView>`. It's set once at mount and never updated again — the `EditorView` object is mutated in place by CodeMirror on each transaction. Svelte's reactivity won't fire. This is intentional: the store is only for *imperative access* (e.g., dispatching a transaction from the AI sidebar). For *reactive data*, use the manually-synced mirror stores.

### Transaction annotation vs. StateEffect

CodeMirror has two mechanisms for attaching metadata to a transaction:

- **`StateEffect`** — persistent. Stored in history, can be inverted for undo. Used for all annotation mutations.
- **`Transaction.annotation()`** — ephemeral metadata on the transaction itself. Not stored in history, not invertible. Used for flags like `revisionInternalEdit` (signals to `ViewPlugin`s that a transaction is revision-system-driven and should not trigger auto-cleanup).

---

## The Annotation System

The annotation system is the core of Quillium's non-linear editing model. It is layered:

```
models.ts           — Plain types, factory helpers, type guards (no CM imports)
annotationField.ts  — StateField + StateEffects + undo/redo (CM state layer)
utils.ts            — Pure query helpers: range mapping, active annotation
index.ts            — ViewPlugins + keybindings + public factory functions
Svelte components   — UI rendering, nested editor lifecycle
```

### Data model

All annotation types share a `BaseAnnotation`:

```typescript
type BaseAnnotation = {
    selection: EditorSelection; // what text is annotated (document positions)
    id: number;                 // unique within the annotation map
    thread: Thread;             // array of { message, author, time }
};

type CommentAnnotation    = BaseAnnotation & { _type: "comment" };
type SuggestionAnnotation = BaseAnnotation & { _type: "suggestion"; replacements: SuggestionReplacement[] };
type RevisionAnnotation   = BaseAnnotation & {
    _type: "revision";
    currentlySelected: number; // index into versions[]
    versions: VersionState[];  // all version texts (or full EditorState blobs)
};

type Annotations = { [id: number]: GenericAnnotation };
```

`VersionState` is intentionally opaque: `{ doc: string; label?: string } & object`. It starts as text-only, but after a version is edited in a nested editor it becomes a full `EditorState.toJSON()` blob (includes history, nested annotations). `versionText(version)` always reads `.doc` regardless of the blob shape.

Use `isAnnotationOfType(annotation, "revision")` everywhere — never compare `_type` directly.

### `annotationField` — the StateField

`annotationField` is the single source of truth for all annotation data. Its `update()` function runs on **every** CodeMirror transaction and proceeds in three phases:

#### Phase 1: Remap positions

```
remapAnnotationSelections(annotations, tr)
```

Maps every annotation's `selection` through `tr.changes` so positions stay accurate as text is inserted or deleted.

- Comments and suggestions are **removed** if their range collapses to zero width (text was fully deleted).
- Revisions **temporarily survive** empty ranges via `allowEmpty: true` in `cleanRangesOf()`. This keeps the annotation alive (with its version list) long enough for `collapsedRevisionResolver` to dispatch a clean removal. The revision is then removed without creating a history entry, and undo fully restores both text and annotation via `_restoreAnnotation` effects stored by `invertedAnnotationFieldEffects`.

#### Phase 2: Apply effects

Processes each `StateEffect` in the transaction. Each effect type has a corresponding branch:

| Effect | Action |
|---|---|
| `addAnnotation` | Insert into the map at `e.value.id` |
| `removeAnnotation` | Delete from the map |
| `updateThread` | Replace `annotation.thread` |
| `_addVersionToRevision` | Splice new version into `annotation.versions` |
| `_deleteVersionFromRevision` | Splice version out |
| `_updateActiveRevisionVersion` | Update `currentlySelected`, rebuild selection to span new text |
| `_updateRevisionVersionState` | Replace a version's blob with the nested editor's serialized state |
| `addSuggestion` | Text search + add suggestion annotation |
| `_applySuggestion` | Delete suggestion from map |

Effects touching a specific revision ID are tracked in `revisionsWithExplicitEffect` (a `Set<number>`). This set is used in Phase 3.

#### Phase 3: Sync revision version text

```
if (tr.docChanged) {
    annotations = syncRevisionDocsWithDocument(annotations, tr, revisionsWithExplicitEffect);
}
```

For each revision **not** in `revisionsWithExplicitEffect`, reads the document slice under the revision's range and writes it back into `versions[currentlySelected].doc`. This keeps the version text current when the user types inside an active revision in the main document.

**Critical invariant:** Phase 3 only runs when `tr.docChanged`. It skips revisions that had an explicit effect this transaction (their text was already set correctly by the effect handler). The `revisionsWithExplicitEffect` set is per-revision, not a single boolean — this matters when multiple revisions exist.

**Undo interaction:** Phase 3 mutations are not directly invertible by the history system (they're inline state updates, not `StateEffect`s). However, because CodeMirror's undo also inverts the document change that caused the sync, the revision range collapses back to its pre-edit position, and the next Phase 3 sync on the inverted transaction re-reads the correct (pre-edit) text. The net result is correct as long as you don't switch versions mid-undo (which is handled by explicit effects + their inversions).

### Undo/redo: `invertedAnnotationFieldEffects`

Registered via `invertedEffects.of(...)` from `@codemirror/commands`. When CodeMirror undoes or redoes a transaction, it calls this function on the original transaction and expects back the effects that should be applied in the *inverse* transaction.

| Original effect | Inverted effect |
|---|---|
| `addAnnotation` | `removeAnnotation` (same object) |
| `removeAnnotation` | `addAnnotation` (same object) |
| `updateThread` | `updateThread` with old thread |
| `_addVersionToRevision` | `_deleteVersionFromRevision` at same index |
| `_deleteVersionFromRevision` | `_addVersionToRevision` at same index, with old version |
| `_updateActiveRevisionVersion` | `_updateActiveRevisionVersion` with old index |
| `_updateRevisionVersionState` | `_updateRevisionVersionState` with old blob |
| `_applySuggestion` | `addAnnotation` (restores the suggestion) |
| *(implicit)* collapsed revision in doc-change | `removeAnnotation(collapsed)` + `_restoreAnnotation(original)` |

The last row is generated **implicitly** (no explicit `StateEffect` needed): when a doc-changing transaction collapses a revision's range to zero width, `invertedAnnotationFieldEffects` stores both a `removeAnnotation` for the collapsed state and a `_restoreAnnotation` for the original pre-deletion annotation. On undo (which re-inserts the deleted text), `_restoreAnnotation` re-adds the annotation with its original selection. `_restoreAnnotation` is also used for comments/suggestions that were silently dropped by a deletion.

**`_revisionCleanup` guard:** The cleanup transaction dispatched by `collapsedRevisionResolver` (tagged `_revisionCleanup.of(true)` and `addToHistory.of(false)`) is skipped entirely by `invertedAnnotationFieldEffects`. Without this guard, the `removeAnnotation` effects in the cleanup would generate spurious `addAnnotation(collapsed)` effects that would be merged into the deletion's undo entry alongside the correct `_restoreAnnotation` effects, causing orphaned collapsed annotations to re-appear on undo.

`addAnnotation`/`removeAnnotation` carry the full annotation object (not just an ID) precisely to make inversion cheap — no `startState` lookup needed.

### State effects are private; transaction builders are public

Effects prefixed with `_` are not exported from `annotationField.ts`. All external code uses named builder functions:

```typescript
// Public API — these bundle effects + doc changes atomically
setActiveRevisionVersion(state, annotationId, to)
createNewRevision(state, annotationId)
deleteRevisionVersion(state, annotationId, versionId)
updateRevisionVersionState(state, annotationId, versionId, newVersionState)
branchSuggestion(state, annotationId)
applySuggestion(state, annotationId, replacementIndex)
```

Each builder returns a `TransactionSpec` (not dispatched yet). The caller is responsible for `view.dispatch(builder(...))`.

### `revisionInternalEdit` — the revision-system-driven flag

```typescript
export const revisionInternalEdit = Annotation.define<boolean>();
```

A `Transaction.annotation` (not a `StateEffect`) set to `true` on every transaction dispatched by the public revision API builders (`setActiveRevisionVersion`, `createNewRevision`, `deleteRevisionVersion`, `updateRevisionVersionState`, `branchSuggestion`). It marks the transaction as revision-system-driven — the doc change is part of the revision system's own operation, not user typing.

Three consumers check for this flag:

1. **`collapsedRevisionResolver`** (`ViewPlugin`) — skips auto-removal of collapsed revisions, because the collapse is intentional (the builder is replacing the text with the correct version content).
2. **`boundaryInsertNudge`** (`ViewPlugin`) — skips emitting nudge UI events for programmatic insertions.
3. **`invertedAnnotationFieldEffects`** — skips implicit annotation remapping detection, because these transactions manage their own annotation state via explicit `StateEffect`s.

Because it is a `Transaction.annotation` and not a `StateEffect`, it is **not** stored in history and **not** inverted. The inverted `StateEffect`s on each transaction already carry the full semantic meaning of "undo this op."

### `_revisionCleanup` — the cleanup-transaction flag

```typescript
export const _revisionCleanup = Annotation.define<boolean>();
```

Set to `true` on the transaction dispatched by `collapsedRevisionResolver` when it removes collapsed revisions. Always paired with `Transaction.addToHistory.of(false)`. Its sole consumer is `invertedAnnotationFieldEffects`, which returns an empty effects array immediately when it sees this annotation — preventing the cleanup's `removeAnnotation` effects from generating spurious `addAnnotation(collapsed)` effects in the undo entry for the deletion.

---

## ViewPlugins and Extensions

`index.ts` registers three `ViewPlugin`s and one facet extension that react to editor updates:

### `annotationDecorations`

Builds `DecorationSet`s for all annotation types on every `selectionSet`, `docChanged`, or annotation state change. Applies CSS classes:

- `cm-comment` / `cm-comment-active`
- `cm-revision` / `cm-revision-active`
- `cm-suggestion` / `cm-suggestion-active`

Active state is determined by `getActiveAnnotation()` — the annotation whose range contains the cursor. If multiple ranges overlap, the narrowest one wins.

### `revisionAtomicRanges`

Registered via `EditorView.atomicRanges.of(...)` (a facet provider, not a `ViewPlugin`). Marks all **inactive** revision ranges as atomic. The cursor jumps over the entire span instead of entering it. This does *not* block edits — `atomicRanges` only governs cursor placement.

### `collapsedRevisionResolver`

Monitors for revision ranges that collapsed to `from === to` in a `docChanged` transaction (that is not annotated `revisionInternalEdit`). Collects **all** such collapsed revisions and, in a single `queueMicrotask`-deferred dispatch:

- Removes all collapsed revisions via `removeAnnotation` effects.
- Tags the transaction `Transaction.addToHistory.of(false)` so no new undo history entry is created.
- Tags the transaction `_revisionCleanup.of(true)` so `invertedAnnotationFieldEffects` skips it entirely (no spurious `addAnnotation(collapsed)` effects are generated).

Undo is handled entirely by the `_restoreAnnotation` effects that `invertedAnnotationFieldEffects` stored on the *deletion* transaction — a single Cmd+Z re-inserts the deleted text and restores all revision annotations (with all versions intact) in one step.

The `queueMicrotask` defers the dispatch past the current update cycle (required to avoid "dispatch inside update"). The stale-state guard (`update.view.state !== update.state`) prevents a double-dispatch if the user presses Cmd+Z synchronously before the microtask fires.

### `boundaryInsertNudge`

Fires a `revision-boundary-nudge` UI event when text is inserted immediately at a revision's `from` or `to` boundary. This signals the revision card to show a brief hint pointing the user to the nested editor.

---

## Stores vs derived
- Stores in `src/lib/stores.ts` mirror pieces of CodeMirror state because the update listener is the only place aware of doc/annotation changes. Derived stores recalculate automatically from their dependencies, but there is no single upstream store for annotations, active selection, and document text. Attempting to make these derived would mean repeating the imperative update logic inside their calculations, so writable mirrors keep the flow explicit. Components only derive from these mirrors when the dependency chain is direct (e.g., modal breadcrumbs from `modalStack`).

## Nested Editors

Each `RevisionAnnotation` supports two editing surfaces:

**Inline editor** (`Revision.svelte`): a 220px CodeMirror `EditorView` mounted in a `<div>` inside the revision card. Visible when `isEditorOpen` is true. Has `history: false` — undo/redo are delegated to the parent via `makeParentUndoKeymap` (flushes current state via `syncVersionToParent`, then calls `undo(parentView)`/`redo(parentView)`). Every `docChanged` or annotation-changed transaction calls `syncVersionToParent` (outward-only sync). Version switches and external parent changes (undo/redo) destroy and recreate the nested `EditorView`. `Mod-Alt-K/M` open the full-screen modal with the pending command forwarded.

**Modal editor** (`RevisionModal.svelte`): a full-screen overlay with a full CodeMirror instance. Pushed onto `modalStack` from `Revision.svelte` or triggered by `redirectToNestedEditor`. Has its own history and annotation field. Supports arbitrary nesting (revisions inside revisions inside modals). Each modal carries a `parentView` — the `EditorView` it dispatches to when syncing version state back.

| Behavior | Inline textarea (`Revision.svelte`) | Modal editor (`RevisionModal.svelte`) |
|---|---|---|
| Undo/redo | `keydown` intercepts `Mod-z`/`Mod-y` and calls `undo(view)`/`redo(view)` on the parent directly. No second undo stack. | Own CodeMirror history; undo/redo run on the modal’s `EditorView` while it is open. Changes serialised back to parent on every transaction via `syncVersionToParent`. |
| Version switching | Parent dispatches `setActiveRevisionVersion` → `activeText` re-derives → `$effect` updates `textarea.value`. No lifecycle teardown needed. | Modal destroys and recreates the `EditorView` from the new `VersionState` blob when the breadcrumb dropdown selects a different version. |
| Sync direction | `oninput` → `updateRevisionVersionState` on parent. While unfocused, `textarea.value` tracks `activeText` reactively. | Every transaction calls `syncVersionToParent`, serialising the modal’s full CM state (including nested `annotationField`) back to the parent. |
| Nested annotations | Not rendered inline. Blobs with nested annotations (from modal sessions) are silently ignored by the textarea. `Mod-Alt-K` / `Mod-Alt-M` open the modal as a workaround. **Planned:** replace with an inline `EditorView` (see below). | Full `annotationField` + `Annotations.svelte` inside the modal. Nested annotations work out of the box. `Mod-Alt-K` / `Mod-Alt-M` open a child modal layer. |

### Why not a second inline CodeMirror instance?

The original design used a second inline `EditorView` and was replaced with a `<textarea>` to eliminate a fragile sync loop. The problems were:

- Every keystroke dispatched `updateRevisionVersionState` to the parent → `$annotations` store updated → `activeText` re-derived → `$effect` fired → had to reload nested `EditorView` state. Three state-system hops (CM → Svelte store → CM) per character.
- Undo delegation required `makeParentUndoKeymap`. After parent undo restored the old `VersionState` blob, reloading the nested editor depended on the Svelte reactive chain above firing correctly — which it silently didn't in some cases.
- Preventing the round-trip from becoming an infinite loop required `lastSyncedText`, `isSyncingFromAnnotation`, and `previousVersionId` — guards that existed solely to contain the feedback loop.

The textarea eliminates all of this. Undo just works (one CM instance, one undo stack). Version switches are a reactive `value` update. No guards, no round-trips.

### Known limitation and planned upgrade

The textarea cannot render nested annotations — if a version's blob contains nested annotations (written by a prior modal session), they are invisible inline. `Mod-Alt-K` / `Mod-Alt-M` from the textarea open the modal as a workaround.

**The planned fix** is to replace the textarea with a second inline `EditorView`. This section documents exactly how to do it without recreating the original feedback-loop problems.

#### Why the original inline EditorView failed (do not repeat)

The original sync went: nested CM keystroke → `updateRevisionVersionState` on parent → `$annotations` store update → `activeText` re-derives → `$effect` reloads nested CM state. That's three state-system hops per character, and any missed dependency caused silent stale content. Guards (`lastSyncedText`, `isSyncingFromAnnotation`, `previousVersionId`) existed solely to contain this loop.

#### How to do it correctly

**Key principle: sync is always outward only.** The nested editor never reads from the parent reactively while it has focus. It only writes to the parent. The parent's state feeds back into the nested editor only on an explicit reload trigger (version switch or undo landing).

**Step 1 — create the nested EditorView**

In `nestedEditor.ts`, add a `createInlineVersionState` function (separate from `createVersionState` which is for the modal):

```typescript
export function createInlineVersionState(
    version: VersionState,
    updateListener: (update: ViewUpdate) => void,
    parentView: EditorView,
): EditorState {
    // history: false — the nested editor never undoes itself.
    // annotationExtensions() — enables nested annotations inline.
    // makeParentUndoKeymap — Mod-z/y forwarded to parentView.
    // makeParentAddVersionKeymap, makeParentRevisionNavKeymap — same as modal.
    const extensions = [
        ...getExtensions({ persist: false, history: false, updateListener }),
        makeParentUndoKeymap(parentView),
        makeParentAddVersionKeymap(parentView),
        makeParentRevisionNavKeymap(parentView),
    ];
    return "annotationField" in version
        ? EditorState.fromJSON(version, { extensions }, nestedSavedFields)
        : EditorState.create({ doc: versionText(version), extensions });
}

// Re-add this (was removed when textarea was introduced):
export function makeParentUndoKeymap(parentView: EditorView) {
    return Prec.highest(keymap.of([
        {
            key: "Mod-z",
            run() {
                // syncVersionToParent here first so the history entry
                // captures the latest typed text before undoing.
                // But nestedView isn't available here — pass it via closure
                // at call site, or use a different approach (see Step 2).
                undo(parentView);
                return true;
            },
            preventDefault: true,
        },
        {
            key: "Mod-y",
            mac: "Mod-Shift-z",
            run() { redo(parentView); return true; },
            preventDefault: true,
        },
    ]));
}
```

Note on the undo flush: before calling `undo(parentView)`, the latest nested editor state should be synced to the parent so the undo entry captures it. The cleanest way is to call `syncVersionToParent(nestedView, parentView, revisionId, versionIndex)` from within the keymap. Since `makeParentUndoKeymap` doesn't have access to `nestedView` at definition time, pass it as a parameter:

```typescript
export function makeParentUndoKeymap(
    parentView: EditorView,
    getNestedView: () => EditorView | undefined,
    revisionId: number,
    versionIndex: number,
) { ... }
```

**Step 2 — the `$effect` in `Revision.svelte`**

Replace the textarea block with a `div` host element and manage the nested `EditorView` lifecycle:

```typescript
let nestedEditorHost = $state<HTMLDivElement | undefined>(undefined);
let nestedView: EditorView | undefined;

// Track what the nested editor is currently showing.
// When either changes, destroy and recreate.
let loadedRevisionId = -1;
let loadedVersionIndex = -1;

$effect(() => {
    if (!isEditorOpen || !nestedEditorHost) {
        nestedView?.destroy();
        nestedView = undefined;
        loadedRevisionId = -1;
        loadedVersionIndex = -1;
        return;
    }

    const targetVersion = revision.currentlySelected;
    const targetId = revision.id;

    if (loadedRevisionId === targetId && loadedVersionIndex === targetVersion) {
        // Same version still loaded — do NOT recreate.
        // The nested editor's updateListener is already syncing outward.
        return;
    }

    // Destroy previous instance before creating a new one.
    nestedView?.destroy();

    const version = revision.versions[targetVersion];
    if (!version) return;

    const editorState = createInlineVersionState(
        version,
        (update) => {
            if (update.docChanged) {
                syncVersionToParent(update.view, view, targetId, targetVersion);
            }
        },
        view,
    );

    nestedView = new EditorView({ state: editorState, parent: nestedEditorHost });
    loadedRevisionId = targetId;
    loadedVersionIndex = targetVersion;
});

onDestroy(() => {
    nestedView?.destroy();
});
```

**Critical: why `loadedRevisionId + loadedVersionIndex` instead of reacting to `activeText`**

If the `$effect` depended on `activeText` (which derives from `revision.versions[revision.currentlySelected]`), then every `syncVersionToParent` call would update the parent annotation → `activeText` changes → `$effect` re-runs → nested editor destroyed and recreated → cursor position lost. This is the original feedback loop.

By tracking `loadedRevisionId + loadedVersionIndex` as plain (non-reactive) variables, the `$effect` only re-runs when Svelte's dependency tracking sees a change in `isEditorOpen`, `nestedEditorHost`, `revision.currentlySelected`, or `revision.id` — not on version text changes. The `updateListener` handles text sync entirely outside of Svelte's reactive graph.

**Step 3 — remove textarea-specific code**

Remove from `Revision.svelte`:
- `textareaEl`, `textareaFocused` state
- `pushTextToParent` function
- The `$effect` that synced `textarea.value = activeText`
- The `<textarea>` element and its `oninput`/`onfocusout`/`onkeydown` handlers
- The `Mod-Alt-m/k` workaround in the textarea keydown handler (the inline CM keymap handles these natively via `annotationExtensions()`)

**Step 4 — update the comparison table**

| Behavior | Inline EditorView (`Revision.svelte`) | Modal editor (`RevisionModal.svelte`) |
|---|---|---|
| Undo/redo | `makeParentUndoKeymap` intercepts `Mod-z`/`Mod-y`, flushes via `syncVersionToParent`, then calls `undo(parentView)`/`redo(parentView)`. No second undo stack. | Own history; undo/redo on modal's `EditorView`. Synced back on every transaction. |
| Version switching | `$effect` detects `currentlySelected` change → destroys old nested view → creates new one from blob. | Modal destroys/recreates from blob via breadcrumb dropdown. |
| Sync direction | `updateListener` calls `syncVersionToParent` on every `docChanged` transaction. Outward only. | Same. |
| Nested annotations | Full `annotationField` + `Annotations.svelte` rendered inside the inline editor. `Mod-Alt-K/M` create nested annotations inline. | Same. |

**Step 5 — tests to write**

The existing `tests/annotations/nestedEditorUndo.test.ts` already covers `syncVersionToParent` correctness. Add tests for:
- Version switch destroys and recreates the nested view (check that old `nestedView.dom` is detached)
- `makeParentUndoKeymap` flushes before undo (check that undo restores the text that was in the nested editor at keypress time, not the text from the previous `syncVersionToParent` call)
- Nested annotations created inline are persisted in the version blob (create a revision inline, add a nested revision, check `annotationField` in the serialized blob)

**Old blobs:** No migration needed. `versionText()` always reads `.doc`. `EditorState.fromJSON` handles blobs with or without `annotationField`.

---

## The `modalStack`

`modalStack` in `stores.ts` is the mechanism for opening nested revision/diff overlays.

```typescript
type ModalEntry =
    | { type: "diff"; suggestionId: number; parentView: EditorView; label: string }
    | { type: "revision"; revisionId: number; parentView: EditorView; label: string; pendingNestedCommand?: PendingNestedCommand };
```

`+page.svelte` renders `{#each $modalStack as entry}` — every entry produces a live overlay simultaneously. Modals stack visually, not replace each other.

| Method | Effect |
|---|---|
| `push(entry)` | Open new modal on top |
| `pop()` | Close topmost modal |
| `popTo(i)` | Close all modals above index `i` |
| `popToAndRebuild(i)` | `popTo(i)` + stamp `rebuildToken` on entry `i` so it recreates its editor |
| `clear()` | Close all modals |

**`popToAndRebuild`**: when a child modal switches the active version on a parent-level revision, the parent modal's editor was built from the old version and must be recreated. Stamping `rebuildToken: Date.now()` on the entry signals the parent modal's `$effect` to destroy and recreate its editor with the new version's content.

**Breadcrumbs**: each `RevisionModal` receives its `stackIndex` and derives `crumbs = $modalStack.slice(0, stackIndex + 1)`. Every open modal renders the full breadcrumb trail, so the deepest nesting level always shows the complete path.

---

## The `annotationUiEvent` Channel

`annotationUiEvent` is a one-shot event store (a `writable<AnnotationUiEvent | null>`) for decoupling `ViewPlugin` / command logic from component-specific reactions.

Events carry a monotonically increasing `token` so components can gate on `event.token !== lastSeenToken`, preventing double-handling.

| Event type | Emitted by | Consumed by |
|---|---|---|
| `revision-boundary-nudge` | `nudgeBoundary` command, `boundaryInsertNudge` plugin | `Revision.svelte` (shows hint) |
| `revision-open-nested-editor` | `redirectToNestedEditor` command | `Revision.svelte` (opens modal with pending command) |
| `revision-focus-request` | `revisionClickHandler` dom event | `Revision.svelte` (places cursor in nested editor) |
| `pending-comment-alert` | `createCommentCommand` | `Annotations.svelte` (flashes existing pending comment) |
| `pending-nested-editor-selection` | `createRevisionCommand` | `Revision.svelte` (selects all text in newly mounted nested editor) |

**Pattern for consuming events in Svelte:**
```typescript
let lastToken = 0;
$effect(() => {
    const event = $annotationUiEvent;
    if (!event || event.token === lastToken || event.type !== "my-event") return;
    lastToken = event.token;
    // handle event
});
```

---

## Persistence

Quillium uses a crash-safe, append-only SQLite event log (WAL mode) with periodic snapshots. All database operations run in Rust via Tauri commands — the TypeScript layer calls `invoke()` wrappers in `src/lib/db/index.ts`.

### Schema overview

| Table | Purpose |
|---|---|
| `documents` | Document metadata (title, word count, preview, tags) |
| `drafts` | Named drafts per document (default one per document) |
| `events` | Append-only log of CM transactions, one row per update |
| `snapshots` | Full `EditorState.toJSON()` blobs, kept at most 3 per draft |
| `_meta` | Key/value flags (migration guard, active draft pointers) |

The `documents` table has **no `state_json` column**. Document state lives entirely in `snapshots`.

### Event log flow

```typescript
// extensions.ts
export const savedFields = { historyField, annotationField };

// On every docChanged || annotationsChanged (listeners.ts):
const result = await appendEvent(draftId, JSON.stringify(payload));
if (result.needsSnapshot) {
    createSnapshot(draftId, JSON.stringify(state.toJSON(savedFields)), result.eventId);
}
```

`appendEvent` (Rust) atomically inserts the event row, bumps `documents.updated_at`, and returns `{ eventId, needsSnapshot }`. A snapshot is triggered when ≥50 events have accumulated since the last snapshot, or ≥120 seconds have elapsed.

### Load flow

```typescript
// Editor.svelte
const loaded = await loadDocumentState(docId, draftId);
// loaded.snapshotStateJson  → latest snapshot blob
// loaded.snapshotEventId    → id of that snapshot (-1 for seed)
// loaded.eventsSince        → events after the snapshot
```

`loadDocumentState` (Rust) fetches the most-recent snapshot for the draft and all events with `event_id > snapshot.up_to_event_id`. The snapshot is restored first, then any `eventsSince` are replayed in order via `replayEvents()` to reconstruct the full editor state.

### Migration from state.json

On first launch after upgrading, `migrate_from_state_json` (Rust) runs automatically. It reads the legacy `state.json`, creates a document + draft + seed snapshot (with `up_to_event_id = -1`), and sets a `_meta` flag so it never runs again. The operation is idempotent.

> **TODO: remove when safe.** Once all users are on a build that includes the SQLite persistence layer, this migration path can be deleted. Files to remove/change:
>
> - `src-tauri/src/db/migration.rs` — delete entirely
> - `src-tauri/src/db/mod.rs` — remove `pub mod migration;` and the `MigrationResult` struct
> - `src-tauri/src/lib.rs` — remove `migration::migrate_from_state_json` import, `MigrationResult` import, and `cmd_migrate_from_state_json` command + its registration in `invoke_handler!`
> - `src/lib/db/index.ts` — replace `initDb()` body with a no-op (or just `return`); the function can stay as a call-site no-op while callers are cleaned up
> - `src/lib/db/types.ts` — remove the `MigrationResult` type
> - `tests/e2e/app.smoke.pw.ts` — remove the `cmd_migrate_from_state_json` mock and the assertion that it is called once

### Event payload format

Each event has a `type` field that determines its shape:

- `doc_change` — pure text edit `{ changes: [{from, to, insert}], selection }`
- `annotation_add` / `annotation_remove` / `annotation_update` — annotation mutations
- `compound` — doc change + annotation effects in the same CM transaction

### Snapshot pruning

`create_snapshot` (Rust) keeps only the latest 3 snapshots per draft. After inserting, it deletes all older snapshots for that draft.

`VersionState` blobs (nested editor state) are also serialized inside `annotationField.toJSON()` — they're stored as opaque objects within the `versions` array and round-trip correctly because they're already JSON-safe.

---

## Keybindings

The annotation keymap (installed at `Prec.high`) intercepts before default CodeMirror bindings:

| Key | Command chain |
|---|---|
| `Backspace` | `nudgeBoundary("backward")` → `deleteAdjacentRevision("backward")` → default |
| `Delete` | `nudgeBoundary("forward")` → `deleteAdjacentRevision("forward")` → default |
| `Mod-Alt-M` | `redirectToNestedEditor("comment")` → `createCommentCommand` |
| `Mod-Alt-K` | `redirectToNestedEditor("revision")` → `createRevisionCommand` |

Each handler returns `false` to fall through to the next binding if it doesn't apply. `redirectToNestedEditor` returns `true` (swallowing the keypress) only when the cursor is inside an active revision — otherwise it returns `false` and the real create command runs.

---

## Common Flows

### Creating a comment

```
User selects text
→ Mod-Alt-M
→ canCreateNewComment() check (enforces single-pending mutex)
→ addAnnotation dispatched { _type: "comment", thread: [] }
→ PreComment.svelte renders (thread.length === 0 = pending state)
→ User fills in text + submits
→ updateThread dispatched with first message
→ Comment.svelte renders (thread.length > 0)
```

### Creating a revision

```
User selects text
→ Mod-Alt-K
→ addAnnotation dispatched { _type: "revision", versions: [{ doc: selected }], currentlySelected: 0 }
→ Text becomes atomic in main doc (cannot edit directly)
→ Revision.svelte renders with one version pill
→ isActive → nested editor auto-opens (if setting enabled)
```

### Switching revision versions

```
User clicks version pill N
→ view.dispatch(setActiveRevisionVersion(state, id, N))
  Transaction contains:
    - _updateActiveRevisionVersion effect (N)
    - doc change: replace revision range with versions[N].doc
    - revisionInternalEdit.of(true)  ← prevents collapsedRevisionResolver from firing
    - Transaction.addToHistory.of(true)
→ annotationField Phase 2: updates currentlySelected, rebuilds selection to new span
→ Phase 3 skipped for this revision (it's in revisionsWithExplicitEffect)
→ Svelte store sync → Revision.svelte re-renders with new active pill
→ syncRecursiveEditorToActiveVersion detects version change → reloads nested editor
```

### Undo of version switch

```
User presses Cmd+Z
→ historyField inverts the transaction
→ invertedAnnotationFieldEffects called on original transaction:
    - sees _updateActiveRevisionVersion { to: N }
    - emits _updateActiveRevisionVersion { to: oldCurrentlySelected }
→ Inverted doc change restores old text
→ Inverted effect restores currentlySelected
→ Full undo: document text AND annotation state revert together
```

### Editing in main doc while revision is active

```
User types inside an active revision range
→ Normal doc change transaction (no explicit revision effects)
→ Phase 1: revision selection remapped through change
→ Phase 2: no revision effects
→ Phase 3: syncRevisionDocsWithDocument runs for this revision
    - reads doc.slice(revision.from, revision.to)
    - writes into versions[currentlySelected].doc
→ upsertVersionState fires in nested editor's updateListener
    (nested editor tracks its own changes and pushes them up)

On undo:
→ Doc change inverted → text reverts
→ Phase 3 runs again on inverted transaction → version.doc syncs back to reverted text
→ Nested editor detects lastSyncedText drift → reloads from annotation blob
```

---

## Design Constraints and Intentional Tradeoffs

### Revisions can survive empty ranges (undo restores them)

Comments and suggestions are removed when their text is deleted. Explicitly deleting the revision (select + Delete or delete-from-the-right) removes the annotation and versions immediately; nothing survives unless you undo the deletion. If you delete every character inside a nested version editor, the revision is still intact: its main-document range never collapsed, so the only thing that changes is the version text kept inside the annotation. That version can be empty safely and the revision remains available (and undoable) because the structural branch stays anchored to the original selection.

**How deletion works**: When a revision range collapses to zero length it survives only long enough for the system to record `_restoreAnnotation` effects; `collapsedRevisionResolver` immediately removes the zero-width annotation (in a microtask, tagged with `addToHistory.of(false)` and `_revisionCleanup`) so the field never holds a dangling collapsed revision.

**How undo works**: Undo is what makes it look like the revision “survived”: Cmd+Z reapplies both the deleted text and the original revision (with all versions) using the stored `_restoreAnnotation` effects.

### Nested editors are full `EditorView` instances

Each nested editor has its own annotations, history, and keybindings. The complexity is intentional — writers can annotate within a revision version (infinite nesting), and a version's full editing state (cursor, undo history, sub-annotations) is preserved across sessions via `VersionState`.

### Direct editing of active revisions is blocked

Direct editing of revision ranges from the main document is not explicitly blocked by a transaction filter. Inactive revision ranges use `atomicRanges` to govern cursor placement only. All intentional revision editing goes through the nested editor.

### Separate `StateEffect` per mutation, not a generic update

Rather than a single `mutateAnnotation` effect, there is one effect per operation. This keeps undo/redo inversion explicit and local — each effect's inverse is declared adjacent to it in `invertedAnnotationFieldEffects`. The cost is some verbosity in effect declarations.

### Full annotation stored in `addAnnotation`/`removeAnnotation`

Both carry the complete annotation object (not just an ID). This lets the undo inversion restore exact prior state without a `startState` lookup.

---

## Known Limitations

- **Multi-selection not supported.** The system assumes one selection range per annotation (`selection.main`). Multi-cursor is not handled.
- **Thread updates are coarse-grained.** `updateThread` replaces the entire thread array. Undo of a single message edit reverts the entire thread.
- **One pending comment at a time.** `canCreateNewComment()` enforces a single draft (empty-thread) comment. Finer-grained locking is unresolved.
- **No explicit annotation status enum.** `thread.length === 0` means pending comment; there is no FSM. Acknowledged technical debt.
- **`addSuggestion` inversion uses `Math.max` on IDs.** Assumes IDs are sequential and increasing; works until suggestions are added in bulk.
- **`queueMicrotask` in `collapsedRevisionResolver`.** Necessary to avoid dispatching inside a `ViewPlugin.update`, but ordering relative to other queued microtasks is not guaranteed under rapid undo.

---

## PostHog Events

| Event | When | File |
|---|---|---|
| `app_session_started` | Editor mounts with a document | `Editor.svelte` |
| `ai_sidebar_opened` | User opens AI sidebar to a mode | `AISidebar.svelte` |
| `ai_message_sent` | Any AI request is dispatched | `chatFactory.ts` |
| `ai_chat_message_sent` | User sends AI chat message | `Chat.svelte` |
| `ai_chat_quick_prompt_used` | User uses a chat quick prompt | `Chat.svelte` |
| `ai_feedback_requested` | User requests AI feedback | `Feedback.svelte` |
| `ai_feedback_quick_prompt_used` | User uses a feedback quick prompt | `Feedback.svelte` |
| `ai_revise_requested` | User triggers AI revision | `Revise.svelte` |
| `ai_revise_quick_prompt_used` | User uses a revise quick prompt | `Revise.svelte` |
| `context_generated` | AI context is generated for a document | `clientStreams.ts` |
| `context_cleared` | User clears document context | `DocumentContext.svelte` |
| `annotation_created` | AI creates a comment, suggestion, or revision | `chatFactory.ts` |
| `comment_created` | User submits a new comment | `PreComment.svelte` |
| `comment_ai_suggestion_requested` | User requests AI suggestion in thread | `Comment.svelte` |
| `suggestion_applied` | User applies an AI suggestion | `Suggestion.svelte` |
| `suggestion_branched` | User converts suggestion to revision | `Suggestion.svelte` |
| `suggestion_diff_viewed` | User views a suggestion diff inline | `Suggestion.svelte` |
| `suggestion_diff_modal_opened` | User opens the full-screen diff modal | `Suggestion.svelte` |
| `revision_version_created` | User creates a new revision version | `Revision.svelte` |
| `annotation_deleted` | User deletes a comment, suggestion, or revision | `Comment.svelte`, `Suggestion.svelte`, `Revision.svelte` |
| `tutorial_completed` | User completes onboarding | `Tutorial.svelte` |
| `tutorial_skipped` | User skips onboarding | `Tutorial.svelte` |
| `ai_settings_provider_changed` | User changes AI provider | `AISettings.svelte` |
| `ai_settings_model_changed` | User changes AI model | `AISettings.svelte` |
| `draft_scrapped` | User scraps current draft | `Save.svelte` |
