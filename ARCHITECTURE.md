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

Each `RevisionAnnotation` supports two editing surfaces: a lightweight inline editor inside the revision card, and a full-screen modal. **The inline editor is over-engineered for what it actually needs to do** — see the planned simplification below.

### Two surfaces

**Inline editor** (`Revision.svelte`): a 220px `EditorView` mounted inside the revision card. Visible when `isEditorOpen` is true. The nested editor's state is synced back to the parent annotation on every keystroke via `upsertVersionState()`, which calls `updateRevisionVersionState(...)` and dispatches a `_updateRevisionVersionState` effect to the parent. An `updateListener` guard (`shouldSyncNestedEditorUpdate`) now gates `upsertVersionState()` so only transactions with doc changes or annotation effects touch the parent—selection-only moves stay in the nested view and no longer create extra undo entries.

**Modal editor** (`RevisionModal.svelte`): a full-screen overlay with a full CodeMirror instance. Pushed onto `modalStack` from `Revision.svelte` or triggered by `redirectToNestedEditor`. Supports arbitrary nesting (revisions inside revisions inside modals). Each modal carries a `parentView` — the `EditorView` it dispatches to.

**Why the creation code differs**: The matrix below explains why the inline path needs the longer helper lifecycle in `nestedEditor.ts` while the modal can rely on a single `createVersionState` + `EditorView` setup. Inline undo meaningfully touches both text edits and version slots because it only sees the parent history; the modal, by contrast, keeps those concerns colocated in one `EditorView`.

| Behavior | Inline card editor (`Revision.svelte`) | Modal editor (`RevisionModal.svelte`) |
|---|---|---|
| Undo/redo stack | History disabled inside the nested `EditorView`. `makeParentUndoKeymap` reroutes `Mod-z`/`Mod-y`/`Mod-Shift-z` to `undo(parentView)`/`redo(parentView)`, because every keystroke feeds `updateRevisionVersionState` and only the parent undo stack actually stores the `VersionState` blobs. | Own CodeMirror history and annotations; undo/redo operations run on the modal’s `EditorView` alone while it is open. Changes are still serialised back to the parent on every transaction, but the modal does not need to delegate undo commands. |
| Version switching | The inline view must detect when `revision.currentlySelected` or `activeText` change, persist the outgoing version via `upsertVersionState`, destroy the current `EditorView`, and recreate it from the new `VersionState`. Reactive guards (`lastSyncedText`, `isSyncingFromAnnotation`) keep the view from reloading unnecessarily. | The modal rebuilds the single `EditorView` when the breadcrumb dropdown selects a different version. The `EditorView` is destroyed and recreated for that version, but there is never more than one concurrent view inside that modal layer. |
| Sync direction | Every keystroke serialises the nested state and dispatches `_updateRevisionVersionState`/`updateRevisionVersionState`; the parent in turn triggers `$effect` in `Revision.svelte`, so the inline view must listen for parent-origin updates to avoid stale state. | Same serialisation back to the parent occurs on each transaction, but because the modal sits on top of the stack it controls the active version directly and doesn’t need to guard against other components mutating the nested view at the same time. |
| Nested annotations | Inline editor allows nested annotations but has to track them itself; it uses `nestedEditorHasActiveAnnotation` and exposes a modal button when necessary. | Modal editor already runs a full CodeMirror instance with its own annotation field, so nesting works out of the box via `modalAnnotations` and `Annotations.svelte`. |

Now that we have a birds-eye overview of the usage differences, here is a more detailed view on how the inline editor works (the modal editor is very simple, similar to the main editor, so it doesn't need to be documented here):

### Keeping the inline editor in sync with the parent

The inline editor lifecycle:

1. `createRecursiveEditor(version)` — mounts a new `EditorView`. If `version` has an `annotationField` key (it's a full blob), restores state via `EditorState.fromJSON`. Otherwise creates fresh from `doc`. Records `lastSyncedText`.
2. `upsertVersionState(editor, versionId)` — serializes `editor.state.toJSON(nestedSavedFields)` and dispatches `updateRevisionVersionState` to the parent. Updates `lastSyncedText` to prevent false-positive reload detection.
   - Its `updateListener` now consults `shouldSyncNestedEditorUpdate(update)` and only fires `upsertVersionState` when the nested change touched the document or emitted annotation effects, so cursor-only moves no longer push extra history entries.
   - `updateRevisionVersionState` now accepts an `addToHistory` option so the inline view can fix drift without inserting extra undo entries.
3. `syncRecursiveEditorToActiveVersion(prevId?)` — called whenever `revision.currentlySelected` or `activeText` changes (the `$effect` reads `void activeText` to register it as a reactive dependency):
   - If version changed: save old version's state, destroy+recreate with new version blob.
   - If text drifted externally (undo/redo or main-doc edit): reload state from the annotation blob. Detected via `lastSyncedText !== activeText` rather than comparing editor text directly — because after undo the editor text may coincidentally match the target text, masking the stale state.

### Undo history — current design and its problems

The inline editor has **no independent undo stack** (`getExtensions({ history: false })`). Instead, `makeParentUndoKeymap(parentView)` intercepts `Mod-z` / `Mod-y` / `Mod-Shift-z` and delegates to `undo(parentView)` / `redo(parentView)`.

The parent records every nested edit because `syncVersionToParent` dispatches `_updateRevisionVersionState` with `Transaction.addToHistory.of(true)`. Undoing on the parent restores the old `VersionState` blob via `invertedAnnotationFieldEffects`. The `$effect` in `Revision.svelte` detects the version text changed and calls `recursiveEditor.setState(createVersionState(activeVersion, ...))` to reload.

**This works, but the bridging machinery is fragile:**

- Undo fires on the parent CodeMirror instance. The parent has no reference to the nested `EditorView`. The only way to reload the nested editor is via Svelte's reactivity: `$effect` tracking `activeText` → `syncRecursiveEditorToActiveVersion` → `recursiveEditor.setState(...)`. If that reactive chain breaks (wrong dependency tracked, effect not re-running), the nested editor silently shows stale content.
- The inline editor and parent editor are two `EditorView` instances pointing at the same logical content. Every sync operation (type → push to parent → detect drift → reload nested) is a round-trip through three layers: CodeMirror state → Svelte reactivity → CodeMirror state again.
- `lastSyncedText`, `isSyncingFromAnnotation`, and the `previousVersionId` variable exist solely to prevent this round-trip from triggering infinite loops or phantom reloads.
- `HistEvent.fromJSON` silently drops all `effects` — so even before undo delegation was added, annotation undo inside nested editors was broken after a session restart.

The inline sync loop now compares the document slice under the revision to the stored version text during every sync. If undo (or any other parent-only edit) reverts the main doc but the annotation blob lags behind, we dispatch `updateRevisionVersionState(..., { addToHistory: false })` with the doc text before continuing. This keeps the annotation aligned with the doc without creating a new undo entry, so the nested editor can safely reload with the restored content.

The inline listener now filters `ViewUpdate`s through `shouldSyncNestedEditorUpdate`, so only doc mutations and explicit annotation effects ever trigger `upsertVersionState`. Selection-only moves therefore stay out of the parent’s undo stack and clearing a version’s text (select-all + delete) produces a single undo entry instead of the three-step sequence we used to see.

**Known bug (fixed, but symptomatic):** The sync `$effect` previously only tracked `revision.currentlySelected`. A version-content change from undo (same index, different text) would not re-run the effect — nested editor showed stale text. Fixed by adding `void activeText` inside the effect, but this is a workaround for the structural problem above.

### Planned simplification: replace inline editor with a textarea

The inline editor is solving two problems: (1) edit version text, (2) support nested annotations. Problem 2 is already handled by the modal — when the nested editor has an active annotation, a "View in modal" button appears. The inline editor is therefore over-engineered for problem 1.

**Proposed design:**

| Surface | Technology | Purpose |
|---|---|---|
| Inline card | `<textarea>` | Quick text edits, version switching |
| Modal | Full `EditorView` | Deep editing, nested annotations, undo |

The textarea's `input` event calls `updateRevisionVersionState` directly — no second `EditorView`, no history delegation, no `lastSyncedText`, no `isSyncingFromAnnotation`. Undo/redo on the parent just works because there is only one `EditorView`. The entire `nestedEditor.ts` file would be reduced to `previewVersionText` and a small `syncVersionToParent` helper.

**What the modal keeps:** Its full CodeMirror instance with its own history (independent from the parent, because while the modal is open it is the active editing surface — there is no ambiguity). Nested annotations continue to work inside modals. The breadcrumb system handles infinite nesting.

**Migration:** `VersionState` is already opaque — `versionText()` always reads `.doc`. Old blobs with embedded CM state (from the old inline editor) continue to load correctly via `versionText()`. The modal still calls `EditorState.fromJSON` on them if they contain `annotationField`. No data migration needed.

**Edge case to document:** The modal saves back a full CM state blob (with nested `annotationField`) on every keystroke. If that version is later opened in the new textarea inline editor, it shows only `.doc` — the nested annotations are invisible until the modal is opened again. This is intentional: the textarea is not a CM editor and cannot render annotations. Users who need to see or manage nested annotations must use the modal.

### `lastSyncedText` — why it exists (current implementation)

Before this pattern, `syncRecursiveEditorToActiveVersion` compared `currentText === targetText` to decide whether to reload. This silently failed in the following scenario:

```
Revision V1 active, text = "hello"
User types in main doc: V1.doc updated to "hello world" (Phase 3 sync)
User presses Cmd+Z: doc reverts, V1.doc reverts to "hello"
Nested editor still shows "hello world"
syncRecursive... sees: currentText="hello world", targetText="hello"
  → These differ → reloads! ✓

But what if undo brought doc BACK to exactly what nested editor shows?
Nested editor: "hello" (user had previously edited to "hello")
V1.doc after undo: "hello"
currentText === targetText === "hello" → no reload → nested editor is STALE

lastSyncedText solves this: we remember "hello world" was last pushed in,
so lastSyncedText="hello world" ≠ targetText="hello" → force reload. ✓
```

This complexity goes away entirely with the textarea approach — there is no second editor to reload.

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
