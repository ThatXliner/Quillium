# Version history

[VersionHistory.svelte](../packages/desktop/src/lib/editor/VersionHistory.svelte)
combines draft snapshots and document activity in one timeline. The history route
is a thin wrapper around this component.

Architecture decision: [document activity and draft content history](./adr/0003-separate-activity-from-content-history.md).

## Layout

Two-panel layout:
- **Left**: Historical document shell using the live `DocumentTabs` and
  `DraftTreePanel` presentation in navigation-only mode, plus the real read-only
  CodeMirror document and snapshot annotations
- **Right**: Unified history timeline with snapshots and document activity
  grouped by date (Today / Yesterday / day-of-week / This month / month + year)

## Snapshot types

| Type | Description | Retention |
|------|-------------|-----------|
| Automatic | Created at event or elapsed-time thresholds, before selected editing actions, and when leaving with unsnapshotted edits | Unlabeled snapshots follow retention policy |
| Labeled | Manual checkpoints and named recovery snapshots | Exempt from snapshot pruning |

Leaving the editor queues a snapshot of the latest persisted draft state before navigation
completes. Repeated navigation without further edits reuses that checkpoint, including
when an automatic or named snapshot already captured the latest event. Normal editing
keeps the existing snapshot thresholds.

## Document activity

Tab and draft operations (`doc_events`) appear inline with snapshots in the
same timeline. Deleted tabs and drafts expose a Restore action on their
activity row while they are still deleted.

## Snapshot preview

Selecting a snapshot:
1. Calls `loadSnapshotState(snapshot.id)` to fetch state JSON
2. Reconstructs read-only CodeMirror instance via `EditorState.fromJSON`
3. Resolves the immediately previous snapshot of the same draft as its baseline
4. Preview rebuilt via Svelte `$effect` when target element or state changes

The preview toolbar offers two persisted layouts:

| Layout | Presentation |
|--------|--------------|
| Inline | Selected text with additions highlighted and removed text injected in place |
| Side by side | Previous and selected snapshots in separate read-only editor panes |

Side-by-side diffing reuses the shared word-level algorithm. The previous pane
marks removals; the selected pane marks additions. At narrow content widths the
panes stack without shrinking the configured document typography.

Tabs and drafts remain navigable at the selected coordinate, but structural
mutations (create, rename, reorder, delete, iterate, branch, and lock toggling)
are unavailable. Diff decorations compare snapshots only within the selected
draft. When no earlier snapshot exists for that draft, the document renders
normally without an all-added diff.

Selecting a tab-deletion activity renders that tab as a read-only tombstone
instead of falling through to another live tab. The shell identifies it as
deleted with a red, struck-through tab and shows its last available snapshot;
later coordinates exclude it again. Browsing either state never changes the
document's live active tab or draft pointers.

## Restore

The first click arms the restore button. The second calls
`restoreToCoordinate()` with the document ID, timestamp, activity ID, and optional
snapshot ID. Rust restores the structural coordinate and, for a snapshot, seeds a
new iteration with that content. Existing draft events and snapshots remain
available. The editor opens after a successful restore; failures leave the
history page open and show an error.

Structural rewind does not replay orphan-deletion link changes. See
[known limitations](known-limitations.md#persistence).

## Named checkpoint creation

The editor status bar also offers "Name this version" (`Cmd/Ctrl+Shift+S`). Its focused
prompt trims the name, saves on Enter, and cancels on Escape. The loader binds the
prompt to its committed document/tab/draft and cancels stale submissions. The
persistence queue writes the captured state after its pending events and before
later edits. A failed event write blocks naming for the loaded draft. Recovery
requires preserving current writing before a reload; see
[failed saves](error-handling.md#failed-saves).

Version History also has a top-bar checkpoint input. Both entry points use
`persistNamedVersion()` to order the captured state after pending edits. They
must not combine a captured state with a later global event cursor. See
[persistence](persistence.md) for failure handling.

## Storage management

Storage size and manual pruning apply to the active draft, even though the
timeline spans the document. A warning appears above 1 GB. Labeled snapshots are
excluded from both automatic and manual pruning.

### Storage panel

Clicking size badge opens collapsible panel:

| Control | Action |
|---------|--------|
| Auto-prune retention | Select dropdown: Never, 30/60/90/180/365 days |
| Keep last N | Prune all but most recent N snapshots |
| Older than N days | Prune snapshots older than N days |

Both prune actions require two-click confirmation.

## Bootstrap

Navigating directly to `/history` (bypassing editor) may leave `currentDraftId` unset. `bootstrapDraftId()` handles this by loading the first document's active draft.
