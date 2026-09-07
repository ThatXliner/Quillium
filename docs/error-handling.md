# Error Handling and Crash Recovery

A writing app that loses user text is catastrophic. The event log is crash-safe for normal operations, but two scenarios need special handling:
1. A bug that silently deletes large chunks of text
2. A JavaScript crash that prevents persistence

## Suspicious Change Detection

`errorGuard.ts` runs `isSuspiciousDeletion(oldText, newText)` in `listeners.ts` **before** persisting a transaction.

Trigger conditions:
- Single transaction batch deletes ≥20% of document
- AND deletes ≥100 characters

When triggered:
1. Pre-deletion state saved as named snapshot: "Before large deletion (auto)"
2. Error banner directs user to `/history` for restore

Thresholds are conservative: false positives just mean an extra snapshot.

## Crash Backup

`saveEmergencyBackup(reason)` captures `$documentContent` at crash time. Called from three places in `hooks.client.ts`:

| Handler | Trigger |
|---------|---------|
| `window.addEventListener("error", ...)` | Uncaught errors |
| `window.addEventListener("unhandledrejection", ...)` | Unhandled promise rejections |
| `handleError` | SvelteKit route-level errors |

Skips Svelte's benign `effect_orphan` error.

Backup goes to `"quillium_backup_crash"` in localStorage.

### Why localStorage for Crash Backups

SQLite writes go through Tauri's IPC, which may not complete if the JavaScript runtime is broken. localStorage writes are synchronous and handled by the webview engine — more likely to succeed during a crash.

## Crash Restoration (`restore.ts`)

When user clicks "Restore previous":

1. `restoreBackup(view, documentText)` replaces entire document with backup
2. Each annotation's anchor text extracted before swap
3. Re-matched in restored document using `SearchCursor`
4. If found: placed at match position
5. If not found: placed at position 0 with console warning
6. Nested annotations in `VersionState` blobs also healed

Transaction tagged with `userEvent: "input.restore"` so suspicious-change detector skips it.

## Error Banner

`ErrorBanner.svelte` has two appearances:

### Crash (Red)

- Icon: `OctagonAlert`
- Actions:
  - "Restore previous" — push backup text to editor
  - "Save copy" — download as plain text
  - "Reload app"
- "Show details" reveals stack trace

### Suspicious Deletion (Amber)

- Icon: `AlertTriangle`
- Actions:
  - "View version history" — navigate to `/history`

## Comment Modals

`CommentModal.svelte` is the full-screen overlay for comment threads. Uses the same `modalStack` and `modalAnnotationStores` pattern as revision modals:
- Root-level modals read from `$annotationsStore`
- Deeper modals read from `modalAnnotationStores[stackIndex - 1]`

Includes AI suggestion feature — prompt building and streaming extracted to `commentAi.ts`.

## Revision Modal Keyguard

`revisionModalKeyguard.ts` exports `shouldHandleRevisionModalKeydown(event)`.

The modal listens for `Ctrl-[`, `Ctrl-]`, `Mod+Enter` at the `<dialog>` level. If a CodeMirror editor inside already handled the key, the modal shouldn't also handle it.

Checks:
- `event.defaultPrevented`
- Target is inside `.cm-editor`
- Target is `<input>` or `<textarea>`

## PostHog Error Events

| Event | When |
|-------|------|
| `crash_backup_restored` | User restores from backup |
| `crash_backup_downloaded` | User downloads backup |
| `crash_banner_dismissed` | User dismisses banner |
| `crash_app_reloaded` | User clicks "Reload app" |
| `editor_replay_event_failed` | Single event fails during replay |
| `editor_replay_completed_with_failures` | Replay finishes with failures |

## Handled AI failures

AI stream and chat failures are handled by the AI client, so they do not reach the global error hooks. The AI paths explicitly write the original error and bounded provider context to the native app log while keeping prompts, credentials, and request bodies out of diagnostics.
