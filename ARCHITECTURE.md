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
- **`Transaction.annotation()`** — ephemeral metadata on the transaction itself. Not stored in history, not invertible. Used for flags like `revisionInternalEdit` (signals to `ViewPlugin`s that a transaction is revision-system-driven) and `nestedEditorEdit` (identifies the revision whose nested editor originated a parent dispatch).

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
    activeVersionIndex: number; // index into versions[]
    versions: VersionState[];  // all version texts (or full EditorState blobs)
};

type Annotations = { [id: number]: GenericAnnotation };
```

`VersionState` is intentionally opaque: `{ doc: string; label?: string } & object`. Each entry always reflects the most recent text that lived under a revision range in the parent document; Phase 3 (`pushDocToVersionState`) pushes the parent document slice into `versions[activeVersionIndex].doc` whenever the parent edits that slice. Nested editor state isn't serialized as a standalone snapshot anymore — we rebuild from whatever `doc` is stored in the revision slot when the editor reopens, so `versionText(version)` continues to just read `.doc`. `VersionStateSchema` still uses `.passthrough()` so extra keys survive if they are added elsewhere.

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
| `_updateActiveRevisionVersion` | Update `activeVersionIndex`, rebuild selection to span new text |
| `_updateRevisionVersionState` | Replace a version's blob with the nested editor's serialized state |
| `addSuggestion` | Text search + add suggestion annotation |
| `_applySuggestion` | Delete suggestion from map |

Effects touching a specific revision ID are tracked in `revisionsWithExplicitEffect` (a `Set<number>`). This set is used in Phase 3.

#### Phase 3: Push document text into version state

```
if (tr.docChanged) {
    annotations = pushDocToVersionState(annotations, tr, revisionsWithExplicitEffect);
}
```

For each revision **not** in `revisionsWithExplicitEffect`, reads the document slice under the revision's range and writes it back into `versions[activeVersionIndex].doc`. This keeps the version text current when the user types inside an active revision in the main document.

**Critical invariant:** Phase 3 only runs when `tr.docChanged`. It skips revisions that had an explicit effect this transaction (their text was already set correctly by the effect handler). The `revisionsWithExplicitEffect` set is per-revision, not a single boolean — this matters when multiple revisions exist.

**Undo interaction:** Phase 3 mutations are not directly invertible by the history system (they're inline state updates, not `StateEffect`s). However, because CodeMirror's undo also inverts the document change that caused the push, the revision range collapses back to its pre-edit position, and the next Phase 3 push on the inverted transaction re-reads the correct (pre-edit) text. The net result is correct as long as you don't switch versions mid-undo (which is handled by explicit effects + their inversions).

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

Each `RevisionAnnotation` still supports two editing surfaces: a lightweight inline editor inside the revision card and a full-screen modal. Both are full `CodeMirror EditorView` instances. The parent document remains the **single source of truth** — nested editors are direct viewports onto the parent document’s revision range `[rev.from, rev.to]`.

### Architecture: direct parent dispatch (still)

Nested editors remain intentional viewports that never own their document. When the user types inside a nested editor:

1. The `updateListener` calls `translateAndDispatch(update, parentView, revisionId)` as before.
2. `translateAndDispatch` translates each change into parent coordinates (`rev.selection.main.from + delta`) and dispatches it with `nestedEditorEdit.of(revisionId)` plus `Transaction.addToHistory.of(true)`.
3. The parent doc is the single source of truth, so Phase 3 (`pushDocToVersionState`) still re-reads the post-transaction slice and keeps `versions[activeVersionIndex].doc` current for version switching (the revision is not added to `revisionsWithExplicitEffect`, so it pushes normally).

### Reactive pull for inline/modal editors

For the inline and modal editors, we watch the parent-provided version text directly via Svelte reactivity. Inline editors observe `activeVersion?.doc` and the modal watches `$annotationsStore`; both skip re-patching when the nested editor itself authored the change (`lastDispatchedDoc`). When a truly external update occurs (undo, redo, or another cursored write), the watcher replaces the nested editor’s entire buffer with the new text via a single `EditorView.dispatch({ changes: { from: 0, to: current.length, insert: externalDoc } })`. That keeps the editor up to date without destroying the view or rebuilding the extension stack—only the contents are rewritten. The inline editor is torn down and recreated in three cases: version switches (`currentVersionId !== mountedVersionId`), when the modal closes and flushes a new `annotationField` blob into the version (`mountedAnnotationFieldBlob` changed), and when the editor is first opened (open/close toggle).

Replacing the whole buffer is the tradeoff we accepted for this reactive, bridge-less path: the cursor/selection and scroll position do not survive the rewrite, so the nested editor appears to jump back to the top. There is no dedicated cursor-persistence mechanism yet, and documenting that limitation in this section keeps intentions clear for future follow-ups.

`lastDispatchedDoc` is the guard that prevents a feedback loop. Translate-and-dispatch updates set it to the nested editor’s current text, so the reactive watcher ignores the transaction that originated from the nested editor itself. Everything else is treated as an external edit that needs a full replace, which is why the watcher lives outside CodeMirror (in Svelte `$effect`s) rather than inside a CodeMirror ViewPlugin.

### Inline editor

`Revision.svelte` still uses `createNestedEditorState` to bootstrap the inline editor and installs `translateAndDispatch` in the nested update listener. When the inline editor toggles open, it creates the view and sets `lastDispatchedDoc`. Closing destroys the view like before. Version switches trigger `currentVersionId !== mountedVersionId` to rebuild from the new `VersionState`. A third rebuild path handles modal flushes: when the modal closes and writes a new `annotationField` blob into the version via `_updateRevisionVersionState`, `mountedAnnotationFieldBlob` changes and triggers a rebuild so the inline editor picks up nested annotation decorations.

### Modal editor

The modal editor (`RevisionModal.svelte`) reuses the same helpers and keeps its own `lastDispatchedDoc`. The external-sync `$effect` watches the parent's annotation state for changes:

- **Root-level modals** (`stackIndex === 0`) watch `$annotationsStore` (the global Svelte store mirroring the main editor's `annotationField`).
- **Deeply nested modals** (`stackIndex > 0`) watch `$modalAnnotationStores[stackIndex - 1]` — a per-level global store that each RevisionModal publishes its nested editor's annotation state into. This chains recursively: undo at the root cascades through each level's external-sync `$effect`.

Annotation IDs are scoped per-editor and can collide across nesting levels, so deeply nested modals must never read from `$annotationsStore` directly.

`destroyEditor` flushes the nested editor's state (including sub-annotations) into the parent revision's version blob. It uses a tracked `editorVersionIndex` (set when the editor was created) rather than `rev.activeVersionIndex`, which may have changed if a parent breadcrumb version switch happened before the destroy. This prevents flushing old version content into the wrong version slot.

#### RevisionModal FSM

The modal editor's lifecycle is governed by a finite state machine rather than ad-hoc `$effect` chains. All transitions go through a single `send(event)` function.

```
         DIALOG_BOUND           TICK_RESOLVED
unmounted ──────────► mounting ──────────────► ready
                                                │ ▲
                          REBUILD_REQUESTED /   │ │  TICK_RESOLVED
                          VERSION_SWITCHED      ▼ │
                                              rebuilding
```

| State | Description |
|---|---|
| `unmounted` | Initial. Waiting for `dialogEl` to bind in the DOM. |
| `mounting` | Dialog is open, waiting for `tick()` so the editor host div is rendered. On `TICK_RESOLVED`: creates the nested editor, executes any `pendingNestedCommand`, transitions to `ready`. |
| `ready` | Normal operating state. Processes external doc changes (`EXTERNAL_DOC_CHANGED`), nested annotation events (`NESTED_ANNOTATION_EVENT`), and rebuild/version-switch requests. |
| `rebuilding` | Editor destroyed, waiting for `tick()` before recreating from the (possibly new) active version. Transitions back to `ready` on `TICK_RESOLVED`. |

| Event | Trigger |
|---|---|
| `DIALOG_BOUND` | Sensor Effect A detects `dialogEl` is bound |
| `TICK_RESOLVED` | `tick().then(...)` resolves after a state transition |
| `REBUILD_REQUESTED` | Sensor Effect A detects a new `rebuildToken` on the modal stack entry (set by `popToAndRebuild` when a child modal switches the parent's active version) |
| `VERSION_SWITCHED` | User picks a different version from the breadcrumb dropdown, or Sensor Effect B detects the parent's `activeVersionIndex` changed |
| `EXTERNAL_DOC_CHANGED` | Sensor Effect B detects the parent's version doc text changed (undo, typing in parent) |
| `NESTED_ANNOTATION_EVENT` | Sensor Effect C receives a `revision-open-nested-editor` UI event targeting this modal's revision |

#### Sensor effects

The FSM is driven by four reactive sensor effects that translate external signals into FSM events:

| Effect | Watches | Sends |
|---|---|---|
| **A: Dialog bind + rebuild token** | `dialogEl`, `$modalStack[stackIndex].rebuildToken` | `DIALOG_BOUND`, `REBUILD_REQUESTED` |
| **B: External sync** | `$annotationsStore` (root) or `$modalAnnotationStores[stackIndex-1]` (nested) | `VERSION_SWITCHED`, `EXTERNAL_DOC_CHANGED` |
| **C: Nested annotation event** | `$annotationUiEvent` where `type === "revision-open-nested-editor"` and `command.revisionId === revisionId` | `NESTED_ANNOTATION_EVENT` |
| **D: Nested revision click** | `$annotationUiEvent` where `type === "revision-focus-request"` and `revisionId` exists in `editor.state.field(annotationField)` | Pushes a new modal onto `modalStack` directly (no FSM event needed) |

Sensor Effect D handles the case where the user clicks on a nested revision decoration inside the modal's CodeMirror editor. The `revisionClickHandler` extension (included in every nested editor via `getExtensions`) fires a `revision-focus-request` with the nested annotation's ID. Effect D checks whether that ID belongs to a revision in *this* modal's nested editor — if so, it pushes a new modal with `parentView: editor`, enabling click-to-open at any nesting depth.

### Undo

`makeParentUndoKeymap` still delegates `Mod-z`/`Mod-y` to `undo(parentView)`/`redo(parentView)` because nested editors continue to have no local history (`getExtensions({ history: false })`). The parent history records nested edits as plain doc changes (via `translateAndDispatch` + `addToHistory:true`), and the reactive watcher eventually catches the inverted transaction and replaces the nested buffer, so the editor always reflects the current undo/redo state.

### Version switch

The inline nested editor is torn down and recreated in three cases: version switches, modal flushes (new `annotationField` blob), and open/close toggles (see "Inline editor" above). Other parent-driven updates mutate the existing view via `dispatch`ed buffer replacements, so there is no rebuilding on every keystroke—just a new text payload that overwrites the current document when something external touched the revision range.

### `nestedSavedFields`

```typescript
export const nestedSavedFields = { annotationField };
```

`nestedSavedFields` is still exported mainly for tooling/tests. No `historyField` is present because nested editors continue to have no local history. `VersionStateSchema` uses `.passthrough()` so any extra keys survive round-trips through `RawAnnotationsSchema.safeParse()`, but the production path now only relies on simple `{ doc, label? }` blobs.

### Infinite nesting

Modal’s `parentView` can be another nested `EditorView`. `translateAndDispatch` chains up the stack automatically — each call dispatches to its immediate parent, which may itself be a nested editor whose watcher catches the change.

**Upward path** (nested edit → root): each `translateAndDispatch` call maps the change to parent coordinates and dispatches to the parent view. If the parent is itself a nested editor, its own `translateAndDispatch` fires and propagates further up. This continues until the root editor is reached and the change enters the global undo history.

**Downward path** (undo/external change → nested editors): each modal’s external-sync `$effect` detects changes in its parent `view`’s annotation state and patches its nested editor buffer. This cascades: root change → level-0 modal pulls → level-0’s nested editor state changes → level-1 modal pulls, etc.

**Sub-annotation creation from within a modal**: the nested editor’s `makeParentUndoKeymap` binds Mod-Alt-m/k to fire `publishAnnotationUiEvent("revision-open-nested-editor")`. The `Revision.svelte` component in the modal’s sidebar catches this and pushes a new modal for the sub-annotation. The sub-annotation is created directly in the new modal’s nested editor via `executePendingNestedCommand`.

**Annotation ID independence**: each nested editor has its own `annotationField` with IDs starting from 0. The global `$annotationsStore` only contains the root editor’s annotations. Nested modals must not look up their `revisionId` in `$annotationsStore` — it would find an unrelated annotation or `undefined`.

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
| `revision-focus-request` | `revisionClickHandler` dom event | `Revision.svelte` (places cursor in nested editor; opens modal for clicked nested revision in inline editor), `RevisionModal.svelte` Sensor Effect D (opens modal for clicked nested revision in modal editor) |
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

### Crash-safety matrix

| Data | Durability on crash |
|---|---|
| Main doc text | Per-keystroke — every `doc_change` event is written to SQLite before the next keystroke |
| Active revision version text | Per-keystroke — `translateAndDispatch` forwards nested editor changes to the parent as `doc_change` events; Phase 3 (`pushDocToVersionState`) keeps `versions[activeVersionIndex].doc` current |
| Non-active revision version text | **Snapshot-only** — see known gap below |
| `activeVersionIndex` version index | **Snapshot-only** |
| Version labels | **Snapshot-only** |
| Thread messages | Per-action — captured as `annotation_update` events |

### Revision version state persistence

**Relevant files:**
- `src/lib/editor/listeners.ts` — `extractAnnotationEvents()`
- `src-tauri/src/db/events.rs` — `SNAPSHOT_EVENT_THRESHOLD = 50`, `SNAPSHOT_TIME_THRESHOLD_SECS = 120`

`extractAnnotationEvents` writes `addAnnotation`, `removeAnnotation`, and `updateThread` as explicit event log entries. Revision-specific internal effects (`_updateRevisionVersionState`, `_addVersionToRevision`, etc.) are captured by a pre/post diff on `annotationField`: any annotation whose identity changed between `tr.startState` and `tr.state` (and wasn't already handled by an explicit effect) gets an `annotation_update` event emitted. This ensures version switches, label edits, and structural changes are persisted per-action without needing to export internal effects.

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
→ addAnnotation dispatched { _type: "revision", versions: [{ doc: selected }], activeVersionIndex: 0 }
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
→ annotationField Phase 2: updates activeVersionIndex, rebuilds selection to new span
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
→ Inverted effect restores activeVersionIndex
→ Full undo: document text AND annotation state revert together
```

### Editing in nested editor (inline or modal)

```
User types in nested editor
→ nested editor updateListener fires
→ translateAndDispatch(update, parentView, revisionId):
    - maps changes to parent coordinates (+ rev.selection.main.from offset)
    - dispatches to parent with nestedEditorEdit.of(revisionId) + addToHistory:true
→ Parent transaction:
    Phase 1: revision selection remapped (no-op for inserts inside range)
    Phase 2: no revision effects
    Phase 3: nestedEditorEdit is not added to revisionsWithExplicitEffect → annotationField runs and updates versions[activeVersionIndex].doc

On undo (Mod-z in nested editor delegates to undo(parentView)):
→ Parent undoes doc change → revision range text reverts
→ Phase 3 runs on inverted transaction → version.doc pushed to reverted text
→ Svelte $effect in Revision.svelte / RevisionModal.svelte detects activeVersion.doc changed
    → patches nested editor buffer (full replace, guarded by pullingFromParent)
    → nested editor shows reverted text (no destroy/recreate)
```

### Editing in main doc while revision is active (non-atomic mode)

```
User types inside an active revision range (atomicRevisions off)
→ Normal doc change transaction (no explicit revision effects, no nestedEditorEdit)
→ Phase 1: revision selection remapped through change
→ Phase 2: no revision effects
→ Phase 3: pushDocToVersionState runs for this revision
    - reads doc.slice(revision.from, revision.to)
    - writes into versions[activeVersionIndex].doc
→ Svelte $effect detects activeVersion.doc changed → patches nested editor buffer

On undo:
→ Doc change inverted → text reverts
→ Phase 3 runs again on inverted transaction → version.doc pushed back to reverted text
→ Svelte $effect patches nested editor with reverted text
```

---

## Design Constraints and Intentional Tradeoffs

### Revisions can survive empty ranges (undo restores them)

Comments and suggestions are removed when their text is deleted. Explicitly deleting the revision (select + Delete or delete-from-the-right) removes the annotation and versions immediately; nothing survives unless you undo the deletion. If you delete every character inside a nested version editor, the revision is still intact: its main-document range never collapsed, so the only thing that changes is the version text kept inside the annotation. That version can be empty safely and the revision remains available (and undoable) because the structural branch stays anchored to the original selection.

**How deletion works**: When a revision range collapses to zero length it survives only long enough for the system to record `_restoreAnnotation` effects; `collapsedRevisionResolver` immediately removes the zero-width annotation (in a microtask, tagged with `addToHistory.of(false)` and `_revisionCleanup`) so the field never holds a dangling collapsed revision.

**How undo works**: Undo is what makes it look like the revision “survived”: Cmd+Z reapplies both the deleted text and the original revision (with all versions) using the stored `_restoreAnnotation` effects.

### Nested editors are full `EditorView` instances

Each nested editor has its own annotations and keybindings, but **no local history** — undo/redo delegates to the parent via `makeParentUndoKeymap`. Writers can annotate within a revision version (infinite nesting), and nested annotation state (sub-annotations) is preserved across sessions in `VersionState` blobs via `editor.state.toJSON(nestedSavedFields)` + `updateRevisionVersionState` (called by the modal editor's `destroyEditor`).

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
- **Deeply nested modal external-sync relies on `modalAnnotationStores`.** Each RevisionModal publishes its nested editor's annotations to a global per-level store (`modalAnnotationStores`). Child modals read from `modalAnnotationStores[stackIndex - 1]` instead of `$annotationsStore`. This chains correctly for undo cascades but adds a global store dependency that could be replaced with a more direct parent-child signal in the future.

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
