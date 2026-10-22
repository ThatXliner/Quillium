# Error handling and recovery

The normal save path is the [SQLite event log](persistence.md). Recovery snapshots
and localStorage backups provide additional copies when they can be written.
They cannot guarantee recovery after a failed database write or storage failure.

## Failed saves

An event append failure remains attached to the loaded draft. The save indicator
shows an error, and persistence flushes reject. Navigation, draft switches, named
checkpoints, and going live must respect that rejection. A later successful append
does not clear the failure or allow a snapshot over the uncertain event history.

The current text stays in memory. Copy the writing somewhere safe before a forced
reload or restart. The app does not retry failed appends automatically because the
native call can fail after inserting an event. Reloading can restore only the
state that reached storage.

The owner of this behavior is
[listeners.ts](../packages/desktop/src/lib/editor/listeners.ts). The ordinary
error banner uses `goToHistory()`, which flushes persistence before navigating.
If the flush fails, the editor and banner remain visible.

## Recovery snapshots

The persistence listener saves selected pre-change states and checks for
suspicious text or annotation loss before appending the change:

- Deleting at least 20 characters or four words creates a pre-change snapshot.
  Undo, redo, crash restoration, and revision-internal swaps are excluded.
- Revision creation gets a named pre-change snapshot. Comment creation gets a
  named post-change snapshot.
- A text loss of at least 100 characters and 20% of the draft triggers a named
  recovery snapshot and a warning, unless all changes were explicit deletes or
  crash restoration.
- Mass annotation removal and the loss of deeply nested annotation content also
  trigger recovery snapshots and warnings.

[deletionHistory.ts](../packages/desktop/src/lib/editor/deletionHistory.ts)
owns the deletion thresholds and rolling reminder policy.
[errorGuard.ts](../packages/desktop/src/lib/errorGuard.ts) owns the suspicious-loss
predicates. These snapshots are best effort; a storage error can prevent them.
They do not stop the accepted editor transaction.

## Crash backups

[hooks.client.ts](../packages/desktop/src/hooks.client.ts) handles uncaught errors,
unhandled promise rejections, and SvelteKit route errors. The rejection handler
keeps `PersistenceError` on the save-failure path and excludes known nonfatal
Svelte, auth-lock, and network failures from the crash banner. The predicates
live in the hook rather than in the banner component.

`saveEmergencyBackup()` copies the `documentContent` mirror, document title,
timestamp, and reason to `quillium_backup_crash` in localStorage. This synchronous
write can still work when asynchronous Tauri calls cannot finish. If storage is
full, the function tries progressively smaller tails of the text and records the
truncation in the reason. The backup contains plain text, not full editor state.

The hooks also request an emergency editor snapshot through
`persistNamedVersion()`. A persistence failure blocks that snapshot without
preventing the independent localStorage attempt.

## Restoring a crash backup

[ErrorBanner.svelte](../packages/desktop/src/lib/ErrorBanner.svelte) offers backup
restoration in the editor, text or JSON downloads, history, and reload actions.
Its crash history action performs a full navigation because a crashed Svelte
boundary may have destroyed the page router. This differs from ordinary warning
navigation, which must flush persistence first.

[restore.ts](../packages/desktop/src/lib/editor/restore.ts) replaces the prose and
tries to reattach the editor's existing annotations using their anchor text.
It uses the first matching passage; an unmatched anchor moves to position zero.
It also repairs ranges in serialized nested annotations. This is best-effort
placement, not a reconstruction of annotations from the plain-text backup.
The replacement transaction carries `input.restore` so it does not trigger the
suspicious-deletion warning again.

## Diagnostics

Recovery actions and replay failures emit the events listed in the
[PostHog catalog](posthog-events.md). AI request failures are handled in the AI
client rather than by global hooks. Those paths log the original error and bounded
provider context to the native app log, excluding prompts, credentials, and
request bodies.
