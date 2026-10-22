# Design notes

## Core model

The active draft has one authoritative CodeMirror document. The text of each
active revision version appears in that document. Inactive versions retain their
own saved text and annotations.

A revision annotation marks a span and keeps the inactive versions off to the side. The active version's text *is* the document text at that span. There's no separate "revision document."

## Nested editors

When you edit a revision, you use a nested editor—the inline card or the full-screen modal. Both are viewports onto the same span in the main document. Editing in either one is editing the main document, just scoped to the revision range.

Inline and modal are functionally identical for history and sync. The only difference is space: inline is lightweight and in-context, the modal gives more room and shows nested annotations.

## Undo is global and linear

Cmd-Z anywhere—main document, inline editor, modal—walks back through one shared history. Typing in a nested editor, switching versions, creating versions: all one timeline. Closing the modal doesn't lose undo history. There is no "modal-only undo."

Consecutive typing in the same revision groups into one undo step. Moving between a revision and surrounding text, or between revision targets, starts another step. Emptying a revision or typing into an empty revision is a separate step so undo can restore its exact boundary.

## Version navigation

Version pills are the primary control. Switching versions replaces the text at the revision span and updates the pill selection. It's a normal document edit, so Cmd-Z after a version switch goes back to the previous version.

`Ctrl-[` / `Ctrl-]` navigate versions from anywhere: main doc, inline editor, or modal.

### Undo of a version delete does not move the active version (issue #270)

Deleting a version and undoing must restore the *prior state exactly*, including which version was active. Undo is a time machine, not a focus command — it should never change the active selection as a side effect.

Concretely: if version 0 is active and you delete the non-active version 2, undo brings version 2 back **without** making it active; version 0 stays active. Deleting the *active* version is the one case where undo re-activates the restored version, because that restores the prior active pointer too. The two cases are symmetric: undo always returns the active pointer to what it was before the delete.

We deliberately rejected the alternative ("undo of a delete focuses the thing that reappeared"). Surfacing the restored version is a real need, but it belongs to a separate, transient affordance — a brief highlight/flash on the re-added pill — not to stealing the active pointer. That highlight is not yet implemented; this note records the intended direction so the focus-stealing behavior isn't reintroduced as a "fix" for discoverability.

## Annotation lifecycle

- **Comments** and **suggestions** are tied to their text. Delete the text, the annotation goes away.
- An ordinary deletion in the parent document removes a revision when its range
  becomes empty. Cmd-Z restores the text and all versions in one step. Empty
  versions are valid when created intentionally, selected through a version
  switch, or cleared inside a nested editor. Those revisions remain available.
- Only one pending (unsaved) comment at a time per editor level. The main doc and each nested editor enforce this independently since they have separate annotation state.

## Nested annotations (annotations inside revisions)

A revision version can contain its own annotations—comments, sub-revisions, whatever. Each nested editor has its own annotation state, independent from the parent. Annotation IDs are scoped per editor level, not global.

### Creating sub-annotations

From an inline card, a new sub-annotation appears inline and can expand into a
modal. From within a modal, the sub-annotation opens in another modal on the
stack. Both paths edit the same parent-owned state.

### Synchronization and persistence

Nested edits translate into parent transactions, and parent changes update the
nested views. Annotation IDs require an editor context because the same ID can
appear at different levels. Closing a modal does not create a separate undo
history or discard its annotations.

Nested annotations belong to a revision version. Switching away and back retains
them. Parent edits remap their ranges. Read [nested editors](docs/nested-editors.md)
for routing, synchronization, serialization, and modal lifecycle details.

## AI

Separate Chat, Feedback, and Revise panels are the default. Unified Chat is an
explicit opt-in in Settings → Advanced → AI → AI panel layout. Both layouts keep
the same saved discussions and use the current editorial pipeline.

AI is an editorial collaborator, not the owner of the draft. The writer's text
remains canonical until the writer applies a suggestion or chooses a revision
version. The opt-in One assistant layout uses independently selected comment, suggestion,
and revision tools. Its Tools popup saves choices per conversation on this device;
each request snapshots those permissions. The assistant can use enabled tools as
the request needs, without switching between Discuss, Feedback, and Revise modes.
Response length, editorial stance, feedback density, and voice latitude shape the
response separately. Structural recipes stay conversational and specialized context
actions can narrow the selected permissions. The separate legacy panels retain
their original task limits. A valid AI turn may produce no document action.

Every turn has an explicit task and capability set. Prompt wording, reader
personas, saved decisions, and device-local editorial preferences can shape the
response but cannot grant another action type. Before dispatch, Quillium resolves
one exact target in the editor that originated the request and checks document,
tab, draft, nested revision branch, selection, read-only state, conflicting
annotations, and duplicate concerns. In-flight selections map through edits before
the passage; edits inside the passage invalidate the result.

AI actions use the same CodeMirror annotation commands, history, persistence, and
collaboration paths as human actions. Generated annotations and revision versions
carry request provenance. AutoAI uses the same policy and action gateway, defaults
off and to comments only, and reports whether a review applied, found nothing new,
was skipped or discarded, or failed. See
[AI Features and Request Pipeline](./docs/ai-sidebar.md).
