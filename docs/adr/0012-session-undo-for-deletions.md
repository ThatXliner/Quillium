# Keep deletion undo in the editor session

Draft and tab deletion use database operations, while prose and annotation edits
use draft-scoped CodeMirror history. Keep those authorities separate, as required
by [ADR 0003](0003-separate-activity-from-content-history.md).

`StructureHistory` holds undo/redo callbacks for successful deletions during the
open editor session. Keyboard shortcuts and Undo toasts consume the same entries.
A CodeMirror history-depth boundary makes newer content edits undo before the
structural deletion; typing on either side stays in separate groups. Loading a
different draft starts a boundary against that draft's own content history.

Do not serialize these callbacks into content events or snapshots. Leaving the
editor or changing documents clears this session history; persisted document
activity remains the recovery path afterward. This follows
[ADR 0006](0006-lossless-persisted-undo.md). Live Rooms retain their Yjs keyboard
undo authority; structural deletion toasts remain available there.

Restoration keeps the current surviving draft selected, restores cascade members
parent-first, and reverses orphan link rewrites. Failed restores remain retryable.
New edits or structural mutations discard structural redo. Creating, renaming,
reordering, and locking tabs/drafts do not gain keyboard undo in this change.

Lock changes reconfigure the current CodeMirror state rather than reconstructing
it, preserving session-only undo and redo when a restore relocks a parent.
Explicit reloads rebase deletion boundaries to the reachable content history.
Async completions cannot repopulate a disposed session, and edits during a pending
restore invalidate its redo. Only the latest deletion toast remains actionable,
so an older child cannot be restored ahead of its deleted parent.

A successful database mutation remains undoable even if refreshing the panel
fails. Deleting an active draft or tab requires a completed switch to a survivor;
a cancelled navigation must not leave the editor writing into a deleted draft.
