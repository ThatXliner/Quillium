# Known limitations

Constraints to check when scoping work. Use the linked system guides and current
code to confirm a limitation before designing around it; planned work belongs in
[GitHub Issues](https://github.com/ThatXliner/Quillium/issues).

## Annotations

| Limitation | Impact |
|------------|--------|
| **Multi-selection not supported** | System assumes one selection range per annotation (`selection.main`). Multi-cursor not handled. |
| **Thread updates are coarse-grained** | `updateThread` replaces entire thread array. Undo of a single message edit reverts the entire thread. |
| **One pending comment at a time** | `canCreateNewComment()` enforces a single annotation with `status: "pending"`. Other pending-comment creation is declined. |

## Nested editors

| Limitation | Impact |
|------------|--------|
| Deferred collapsed-revision cleanup | Cleanup cannot dispatch during `ViewPlugin.update`. A stale-state guard skips cleanup after a newer transaction; changes to this path need rapid edit and undo coverage. |
| **Deeply nested modal external-sync relies on `modalAnnotationStores`** | Each RevisionModal publishes nested editor annotations to a global per-level store. Changes must resolve annotation IDs against the parent editor level. |

## Collaboration

| Limitation | Impact |
|------------|--------|
| **Live Room mode only** | Session ends when owner disconnects. Persistent shared-document ownership deferred. |
| **Manual Live Room IDs** | Joiners paste a draft UUID manually. Invite links and room permissions are deferred. |
| **No local persistence for joiners** | Joiners restored to prior local draft/library after leaving. |
| **No offline queue** | If reconnect attempts exhausted, session enters `error` and must restart. |
| **One draft per Web Preview tab** | Public links can include all draft tabs, but publish one selected draft state per tab rather than every run and draft. |

## Persistence

| Limitation | Impact |
|------------|--------|
| **Version-history rewind does not restore parent/branch links** | Rewinding across an orphan-delete restores the deleted draft, but children re-attached by that delete keep their current links (`draft_reparented` is not replayed), so the restored tree can differ from the true shape at T. Session deletion Undo can reverse the saved link rewrites, but coordinate rewind does not. |
| Failed event appends require recovery | The loaded draft retains a save error and blocks navigation and checkpoints. Later successful writes do not clear it. Copy current writing before a forced restart; unwritten events cannot be recovered by reload. See [persistence](persistence.md#durability-boundaries). |
| Crash backups contain plain text | Backups may be truncated when localStorage is full. Annotation placement during restore is best effort. See [recovery](error-handling.md). |
| **History storage/prune tools are draft-scoped** | The version-history timeline is document-wide, but storage size and pruning act on the active draft's snapshots only (labeled as such in the panel). |

## UI and search

| Limitation | Impact |
|------------|--------|
| Search does not index every draft | The indexed body follows document content metadata. Inactive drafts and revision versions are not separately searchable. See [search](search.md). |
| **Single API key per provider** | Can't configure multiple API keys for same provider. |
| **No keyboard shortcut customization** | Shortcuts are hardcoded. |
| **No full provenance attestation** | Authorship reports trust the local event log; they are evidence, not cryptographic proof. |

## Performance

| Limitation | Impact |
|------------|--------|
| **All personas run in parallel** | No rate limiting or queuing for multi-persona feedback. |

## Platform

| Limitation | Impact |
|------------|--------|
| **Web Preview is read-only** | Published pages reuse editor presentation but do not provide the full editable app. |
| **No general background library sync** | Each installation has local SQLite storage; Live Rooms exchange edits during a session. |
