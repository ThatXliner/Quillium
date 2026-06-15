# Design notes

## Core model

One document. That's it. Every piece of text the user sees, including text inside revision regions, lives in the main CodeMirror document.

A revision annotation marks a span and keeps the inactive versions off to the side. The active version's text *is* the document text at that span. There's no separate "revision document."

## Nested editors

When you edit a revision, you use a nested editor—the inline card or the full-screen modal. Both are viewports onto the same span in the main document. Editing in either one is editing the main document, just scoped to the revision range.

Inline and modal are functionally identical for history and sync. The only difference is space: inline is lightweight and in-context, the modal gives more room and shows nested annotations.

## Undo is global and linear

Cmd-Z anywhere—main document, inline editor, modal—walks back through one shared history. Typing in a nested editor, switching versions, creating versions: all one timeline. Closing the modal doesn't lose undo history. There is no "modal-only undo."

From the user's perspective it just works like normal undo, except some steps happen to affect text inside a revision.

## Version navigation

Version pills are the primary control. Switching versions replaces the text at the revision span and updates the pill selection. It's a normal document edit, so Cmd-Z after a version switch goes back to the previous version.

`Ctrl-[` / `Ctrl-]` navigate versions from anywhere: main doc, inline editor, or modal.

### Undo of a version delete does not move the active version (issue #270)

Deleting a version and undoing must restore the *prior state exactly*, including which version was active. Undo is a time machine, not a focus command — it should never change the active selection as a side effect.

Concretely: if version 0 is active and you delete the non-active version 2, undo brings version 2 back **without** making it active; version 0 stays active. Deleting the *active* version is the one case where undo re-activates the restored version, because that restores the prior active pointer too. The two cases are symmetric: undo always returns the active pointer to what it was before the delete.

We deliberately rejected the alternative ("undo of a delete focuses the thing that reappeared"). Surfacing the restored version is a real need, but it belongs to a separate, transient affordance — a brief highlight/flash on the re-added pill — not to stealing the active pointer. That highlight is not yet implemented; this note records the intended direction so the focus-stealing behavior isn't reintroduced as a "fix" for discoverability.

## Annotation lifecycle

- **Comments** and **suggestions** are tied to their text. Delete the text, the annotation goes away.
- **Revisions** don't survive deletion either, but undo brings them back whole. When you delete a revision's text, the system briefly keeps the annotation alive (long enough to record restore-on-undo information), then removes it. Cmd-Z restores the text *and* all versions in one step. From the user's perspective: delete and undo work as expected.
- Only one pending (unsaved) comment at a time per editor level. The main doc and each nested editor enforce this independently since they have separate annotation state.

## Nested annotations (annotations inside revisions)

A revision version can contain its own annotations—comments, sub-revisions, whatever. Each nested editor has its own annotation state, independent from the parent. Annotation IDs are scoped per editor level, not global.

### Event routing across nesting levels

The event bus is global but annotation IDs are per-editor, so events include `sourceView` (the EditorView that contains the target annotation). Each listener checks `sourceView` against its own editor to avoid handling events from a different nesting level. Without this, ID collisions across levels (e.g. both parent and child having annotation ID 0) route events to the wrong handler.

### Creating sub-annotations

When the user selects text inside a revision and invokes the annotation shortcut:

- **From the sidebar** (inline card): the sub-annotation is created inline. The user sees it in the annotation panel and can expand it into a modal.
- **From within a modal**: the sub-annotation opens immediately in its own modal (pushed onto the stack). No intermediate inline step—you're already in a focused context, so modal-to-modal is the natural flow.

### Undo across nesting levels

One undo tree, rooted in the main document's history. Cmd-Z at any depth delegates up to the root editor's `undo()`. When the root undoes a change:

1. The document text reverts.
2. Each modal detects the change in its parent view and patches its nested editor.
3. This cascades down: level 0 syncs from root, level 1 syncs from level 0, etc.

Upward: `translateAndDispatch`. Downward: each modal's `$effect` watcher on its parent's annotation state.

### Sub-annotation persistence

Sub-annotations are serialized into the `VersionState` blob (`editor.state.toJSON(nestedSavedFields)`). When a modal closes or a version switch happens, the nested editor's state (including sub-annotations) is flushed to the parent's version slot. Reopening the version restores from the blob.

Sub-annotations are per-version. Switching versions and switching back preserves them. If a higher-level undo modifies the parent text, sub-annotation positions remap through the change like any other annotation.

### External sync for nested modals

Root-level modals (`stackIndex === 0`) watch `$annotationsStore` (which reflects the main editor). Deeper modals watch `modalAnnotationStores[stackIndex - 1]`, a per-level store that each modal publishes its nested editor's annotations into. A modal also reads its own revision data directly from `view.state.field(annotationField)` for internal use (version text, thread state).

## AI

AI suggestions are just another annotation type. They show up in the same flow as comments and revisions, not in a separate UI. The AI sidebar has three modes—Chat, Feedback, and Revise—so you can switch without losing your place in the document. AutoAI can also create annotations automatically in the background based on document content.
