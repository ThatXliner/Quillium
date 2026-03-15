# Design Notes

## Core model

The document is the single source of truth. Every piece of text the user sees — including text inside revision regions — lives in the main CodeMirror document.

A **revision annotation** marks a span of the document and stores the inactive versions on the side. The active version's text *is* the document text at that span; the annotation just tracks the range and keeps the alternatives. There is no separate "revision document" — only the main one.

## Nested editors

When a user edits a revision, they use a **nested editor** — either the inline card or the full modal. These are two UI surfaces for the same thing: a focused viewport onto the revision's span in the main document. Editing in a nested editor is editing the main document, scoped to the revision range.

The inline card and the modal are functionally identical in terms of history and sync. The only difference is screen real estate: inline is lightweight and in-context; the modal gives more room and shows nested annotations.

## Undo is global and linear

`Mod-z` anywhere — main document, inline editor, modal — walks back through a single shared history. Typing in a nested editor, switching versions, creating versions: all of it is one timeline. Closing the modal does not lose undo history. There is no concept of "this undo only works inside the modal."

From the user's perspective, it just works like normal document undo — except some undo steps happen to affect text inside a revision region.

## Version navigation

Version pills are the primary navigation control. Switching versions replaces the active version's text in the main document and updates the pill selection. This is a normal document edit and goes into the global undo history — `Mod-z` after a version switch returns to the previous version.

`Ctrl-[` / `Ctrl-]` navigate versions from anywhere: main doc, inline editor, or modal.

## Annotation lifecycle

- **Comments** and **suggestions** are tied to live text; deleting their text removes the annotation.
- **Revisions** survive text deletion — the annotation persists so the user can reopen the version later without losing the branch point.
- Only one pending (empty-thread) comment is allowed at a time to avoid duplicated drafts.

## Nested annotations (annotations inside revisions)

A revision version can itself contain annotations — comments, sub-revisions, etc. Each nested editor has its own `annotationField`, independent from the parent. Annotation IDs are scoped to their editor level (not globally unique).

### Creating sub-annotations

When the user selects text inside a revision and invokes the annotation shortcut:

- **From the main doc sidebar** (inline revision card): the sub-annotation is created inline in the nested editor. The user sees it in the annotation sidebar panel. They can expand it into a modal if they want.
- **From within a modal's nested editor**: the sub-annotation is created and immediately opens in its own modal (pushed onto the modal stack). The user goes directly from the parent modal to editing the sub-annotation. No intermediate inline step — the modal context is already focused, and an immediate modal-to-modal transition is the natural flow.

### Undo across nesting levels

Undo is recursive. There is one effective undo tree rooted in the main document's history. Pressing `Mod-z` at any nesting level delegates up to the root editor's `undo()`. When the root undoes a change:

1. The document text reverts.
2. Each modal's external-sync mechanism detects the change in its parent `view` and patches its nested editor buffer.
3. This cascades: level 0 syncs from the root, level 1 syncs from level 0's nested editor, etc.

The upward path (nested editor → parent) uses `translateAndDispatch`. The downward path (parent change → nested editor sync) uses each modal's `$effect` watcher on its parent view's annotation state.

### Sub-annotation persistence

Sub-annotations are stored in the `VersionState` blob via `editor.state.toJSON(nestedSavedFields)`. When the modal closes or a version switch occurs, the nested editor's full state (including sub-annotations) is flushed into the parent's version slot. When the version is reopened, the state is restored from the blob.

Sub-annotations are tied to specific version content. If the user switches to a different version and back, the sub-annotations are preserved (they're stored per-version). If the parent text that a sub-annotation is anchored to is modified via undo from a higher level, the sub-annotation's selection remaps through the change like any other annotation.

### External sync for deeply nested modals

Each modal watches its parent `view`'s annotation state — not the global `$annotationsStore` (which only reflects the root editor). For root-level modals (`stackIndex === 0`), the parent is the main editor and `$annotationsStore` is correct. For deeper levels, each modal reads from `view.state.field(annotationField)` directly, triggered by its parent's state updates.

## AI interactions

AI suggestions appear in the same annotation flow as comments and revisions — they are another annotation type, not a separate modal. The AI sidebar groups prompts, feedback, and revision generation so users can switch modes without losing their place in the document.
