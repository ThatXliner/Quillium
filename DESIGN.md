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

## AI interactions

AI suggestions appear in the same annotation flow as comments and revisions — they are another annotation type, not a separate modal. The AI sidebar groups prompts, feedback, and revision generation so users can switch modes without losing their place in the document.
