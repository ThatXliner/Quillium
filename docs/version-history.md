# Version History

`src/lib/editor/VersionHistory.svelte` is a full-screen snapshot browser. The route `routes/history/+page.svelte` is a thin wrapper.

## Layout

Two-panel layout:
- **Left**: Historical document shell using the live `DocumentTabs` and
  `DraftTreePanel` presentation in navigation-only mode, plus the real read-only
  CodeMirror document and snapshot annotations
- **Right**: Unified history timeline with snapshots and document activity
  grouped by date (Today / Yesterday / day-of-week / This month / month + year)

## Snapshot Types

| Type | Description | Retention |
|------|-------------|-----------|
| Auto-saved | Created every 50 events or 120 seconds | Configurable policy |
| Named checkpoints | Created by user via "Name this version…" | Until explicitly deleted |

## Document Activity

Tab and draft operations (`doc_events`) appear inline with snapshots in the
same timeline. Deleted tabs and drafts expose a Restore action on their
activity row while they are still deleted.

## Snapshot Preview

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
deleted and shows its last available snapshot; later coordinates exclude it
again. Browsing either state never changes the document's live active tab or
draft pointers.

## Restore

Two-click confirmation:
1. First click arms the restore button
2. Second click calls `restoreToSnapshot(draftId, snapshotId)`
3. After success, navigate back via `goToEditor()`

## Named Checkpoint Creation

Top bar has text input + "Save" button:
- Calls `createNamedSnapshot(draftId, stateJson, eventId, label)`
- State serialized via `view.state.toJSON(savedFields)`
- Pressing Escape with unsaved text triggers shake animation

## Storage Management

Sidebar shows total snapshot storage size for current draft. Warning displayed if exceeds 1 GB.

### Storage Panel

Clicking size badge opens collapsible panel:

| Control | Action |
|---------|--------|
| Auto-prune retention | Select dropdown: Never, 30/60/90/180/365 days |
| Keep last N | Prune all but most recent N snapshots |
| Older than N days | Prune snapshots older than N days |

Both prune actions require two-click confirmation.

## DB Wrapper Functions (TypeScript)

These are the TypeScript wrapper functions in `src/lib/db/index.ts` that call Tauri commands (actual Tauri command names are `cmd_*` variants).

| Function | Purpose |
|----------|---------|
| `listSnapshots` | Get all snapshots for draft |
| `loadSnapshotState` | Get specific snapshot blob |
| `labelSnapshot` | Add/update label |
| `createNamedSnapshot` | Create labeled snapshot |
| `restoreToSnapshot` | Reset to snapshot state |
| `getSnapshotStorageSize` | Get total size |
| `getSnapshotRetention` | Get retention policy |
| `setSnapshotRetention` | Set retention policy |
| `pruneSnapshotsKeepLastN` | Keep only N most recent |
| `pruneSnapshotsOlderThan` | Delete older than N days |

## Bootstrap

Navigating directly to `/history` (bypassing editor) may leave `currentDraftId` unset. `bootstrapDraftId()` handles this by loading the first document's active draft.
