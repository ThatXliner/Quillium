# Quillium

Quillium is a writing environment for exploring alternatives without flattening
them into one linear document history.

## Writing structure

**Document**:
A Library item containing tabs and document-level metadata.
_Avoid_: File, project, draft

**Tab**:
A named top-level content area within a document. A draft tab contains related
drafts.
_Avoid_: Document, draft

**Draft**:
A complete writing state within a draft tab. Each draft owns its content history
and occupies one position in a run.
_Avoid_: Version, revision, snapshot

**Run**:
An ordered lineage of drafts connected by iteration. A branch is an alternate
run that begins from one of those drafts.
_Avoid_: Version chain

**Iteration**:
A new draft that continues a run and supersedes its source as the head.
_Avoid_: Version, branch

**Branch**:
An alternate run that begins from a source draft without superseding the source
run. Its first draft is the branch root.
_Avoid_: Fork, alternate draft

**Root**:
The first draft in a run.
_Avoid_: Head

**Head**:
The newest live draft in a run. Iteration advances the head and supersedes the
previous head.
_Avoid_: Tip, latest version

**Lock**:
A draft state that prevents editing because the draft was superseded or manually
locked.
_Avoid_: Read-only mode

## In-text alternatives and feedback

**Annotation**:
A comment, suggestion, or revision attached to a range of prose.
_Avoid_: Markup

**Comment**:
An annotation whose purpose is discussion. It anchors a thread to prose but
contains neither replacement text nor alternate versions.
_Avoid_: Thread, suggestion

**Suggestion**:
Proposed replacement text that the writer can apply or reject.
_Avoid_: Revision, comment

**Revision**:
A region of prose containing alternate versions, exactly one of which is active.
_Avoid_: Draft, branch

**Version**:
One alternate text state inside a revision.
_Avoid_: Draft, snapshot

**Version group**:
A matched set of versions from different revisions that activate together.
_Avoid_: Revision group

**Thread**:
The ordered messages attached to an annotation. Comments, suggestions, and
revisions can each own a thread; the thread is the conversation, not the
annotation attached to the prose.
_Avoid_: Comment

**Nested annotation**:
An annotation belonging to a revision version rather than directly to the draft.
_Avoid_: Root annotation

## Editing surfaces

**Root editor**:
The top-level editor for the active draft. It is the root of the nested editing
hierarchy.
_Avoid_: Main document, parent editor

**Parent editor**:
The editor containing the revision currently viewed through a nested editor. A
parent editor can be the root editor or another nested editor.
_Avoid_: Root editor

**Nested editor**:
An editor scoped to the active version of a revision inside a parent editor. It
can appear inline or in a modal; both presentations edit the same prose rather
than separate copies.
_Avoid_: Inline editor, revision document

**Inline editor**:
The compact presentation of a nested editor inside a revision card.
_Avoid_: Root editor, separate editor

**Modal editor**:
The expanded presentation of a nested editor inside a revision modal. It edits
the same revision version as the inline editor and provides room for deeper
nested annotations.
_Avoid_: Separate document, modal-only editor

**Revision card**:
The annotation-panel representation of a revision. It contains version controls,
discussion, and the inline editor.
_Avoid_: Revision, nested editor

## History

**Snapshot**:
A captured prose state for one draft, used for recovery and historical browsing.
_Avoid_: Version, draft

**Checkpoint**:
A named snapshot retained until the writer explicitly deletes it.
_Avoid_: Version

**Document activity**:
A recorded structural change to a document, such as creating, renaming,
reordering, deleting, iterating, branching, or locking a tab or draft. It records
organization rather than prose content.
_Avoid_: Draft history, content history

**Version history**:
The document-wide timeline that combines draft snapshots with document activity.
It shows both prose states and structural changes across every tab and draft.
_Avoid_: Revision versions, draft history

## Sharing and collaboration

**Omni**:
The Quillium service covering public previews and real-time collaboration.

**Web Preview**:
A published, read-only view of a document.
_Avoid_: Live Room

**Live Room**:
A temporary real-time editing session led by the document owner.
_Avoid_: Web Preview, shared document

**Owner**:
The participant whose local draft starts and governs a Live Room.
_Avoid_: Host

**Joiner**:
A participant who enters an existing Live Room.
_Avoid_: Owner, guest

## Writing extensions

**Preset**:
Configuration of existing writing behavior for a task.
_Avoid_: Plugin

**Plugin**:
An addition to Quillium's writing capabilities, which may also supply presets.
_Avoid_: Preset, distribution package

## AI discussions

**Conversation**:
A saved Chat, Feedback, or Revise discussion with its own identity and original
draft association. A conversation branch copies a message prefix into another
conversation and records its origin. It does not branch the draft or change prose.
_Avoid_: Draft history, revision version
