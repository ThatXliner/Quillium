# Version History

`src/lib/editor/VersionHistory.svelte` is a full-screen snapshot browser. The route `routes/history/+page.svelte` is a thin wrapper.

## Layout

Two-panel layout:
- **Left**: Read-only CodeMirror preview
- **Right**: Timeline sidebar with snapshots grouped by date (Today / Yesterday / day-of-week / This month / month + year)

## Snapshot Types

| Type | Description | Retention |
|------|-------------|-----------|
| Auto-saved | Created every 50 events or 120 seconds | Configurable policy |
| Named checkpoints | Created by user via "Name this version…" | Until explicitly deleted |

## Snapshot Preview

Selecting a snapshot:
1. Calls `loadSnapshotState(snapshot.id)` to fetch state JSON
2. Reconstructs read-only CodeMirror instance via `EditorState.fromJSON`
3. Preview rebuilt via Svelte `$effect` when target element or state changes

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
