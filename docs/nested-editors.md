# Nested editors

Each `RevisionAnnotation` supports two editing surfaces: a lightweight inline editor inside the revision card and a full-screen modal. Both are full `CodeMirror EditorView` instances. The parent document remains the **single source of truth**.

Implementation: [NestedEditorController.ts](../packages/desktop/src/lib/editor/plugins/annotations/NestedEditorController.ts)
owns lifecycle; [nestedEditor.ts](../packages/desktop/src/lib/editor/plugins/annotations/nestedEditor.ts)
contains state creation, edit translation, and parent undo helpers. Read
[state management](state-management.md) for the reactive boundary.

Architecture decision: [nested editors use parent authority](./adr/0004-nested-editors-use-parent-authority.md).

## Parent dispatch

The controller translates nested text changes into parent coordinates and
marks the parent transaction with `nestedEditorEdit`. If the edit also changes or
remaps nested annotations, the translated text and serialized version state go
into the same parent transaction. Splitting them would let undo restore only one
half of the change. Annotation-only mutations also update the parent's version
state through an undoable transaction.

For ordinary text changes, the annotation field refreshes the active version's
prose from the parent range. Explicit version-state effects already carry that
state and skip the automatic refresh.

## NestedEditorController

Inline and modal revision editors delegate lifecycle to the controller. It
creates the view, translates edits, synchronizes parent changes, and destroys the
view when its target changes or the presentation closes. The implementation owns
the method signatures; the important distinction is whether an update came from
the user or from parent synchronization.

### Flush behavior

| Presentation | Controller mode |
|---|---|
| Inline revision | `"flush-on-destroy"` |
| Revision modal | `"flush"` |

Mutation writes sync immediately. Closing also retains the nested selection.
Bookkeeping and destroy flushes skip a newer parent annotation blob so a stale
editor cannot erase external edits. PostHog
`nested_editor_flush_to_parent_meaningful` records meaningful destroy flushes.

### Parent synchronization

The controller checks the mounted version against the live parent state before
syncing, because Svelte mirrors can trail a parent transaction. It computes a
common prefix and suffix, then replaces only the changed middle of the text.
CodeMirror can map nested annotation positions through that localized change.

The sync transaction carries `parentSyncEdit` and `addToHistory.of(false)`.
The nested listener skips forwarding it, which prevents an update from the
parent from becoming another parent edit or undo step.

## Inline editor

`Revision.svelte` uses the `flush-on-destroy` mode. Its Svelte effects synchronize
parent text through `syncFromParent()`. Version switches rebuild the view.
External annotation changes within
the same version use `syncVersionFromParent()` to retain the mounted editor,
keyboard focus, and selection. The controller reads the current parent version
rather than trusting a delayed reactive snapshot.

## Modal editor

Creates a `NestedEditorController` with `flushBehavior: "flush"`. External sync watches the parent's annotation state:

- **Root-level modals** (`stackIndex === 0`) watch `$annotationsStore`
- **Deeply nested modals** (`stackIndex > 0`) watch `$modalAnnotationStores[stackIndex - 1]`

Annotation IDs are scoped per-editor and can collide across nesting levels.

The modal state machine waits for the dialog and Svelte `tick()` before mounting
or rebuilding the editor. Its event handlers are in
[RevisionModal.svelte](../packages/desktop/src/lib/editor/plugins/annotations/RevisionModal.svelte).
Keyboard ownership is checked by
[revisionModalKeyguard.ts](../packages/desktop/src/lib/editor/plugins/annotations/revisionModalKeyguard.ts),
so a dialog does not handle a key already consumed by its editor or text input.

## Undo in nested editors

`makeParentUndoKeymap` delegates undo and redo to the parent view. Nested editors
disable their own CodeMirror history. Parent transactions retain both translated
text changes and semantic version-state effects.

## Version switching

Switching versions rebuilds the view from the selected version state. Text and
annotation updates within the mounted version synchronize in place, preserving
focus and mapped selection.

## Multiple nesting levels

Modal's `parentView` can be another nested `EditorView`. `translateAndDispatch` chains up the stack automatically.

**Upward path** (nested edit → root): Each `translateAndDispatch` maps to parent coordinates and dispatches. If parent is also nested, its watcher propagates further up.

**Downward path** (undo → nested editors): Each modal's external-sync `$effect` detects changes and patches its nested buffer. This cascades through all nesting levels.

**Sub-annotation creation**: The nested editor's `makeParentUndoKeymap` binds
Mod-Shift-c for comments and Mod-Alt-k for revisions, then emits
`"nested-annotation-create"` on the event bus. The modal catches this and pushes a new modal.

**ID independence**: Each nested editor has its own `annotationField` with IDs starting from 0. Nested modals must not look up `revisionId` in `$annotationsStore`.

## The modalStack

`modalStack` in `stores.ts` manages revision and diff overlays. Each entry records its parent view and the annotation it displays. Stack actions
open, close, or return to a level. `popToAndRebuild()` also changes the rebuild
token when a parent modal must mount a different version. The types and stack
operations live in [stores.ts](../packages/desktop/src/lib/stores.ts).

## Collaboration awareness

When collab is active, `createNestedEditorState` installs `createAwarenessExtension` with position mappers over the parent revision range. The nested editor has no Yjs text binding and syncs through `translateAndDispatch`; awareness only maps cursor coordinates.

Options: `broadcastInitialCursor: false`, `clearCursorOnDestroy: false`. Mounting a background nested editor does not replace the user's shared cursor.
