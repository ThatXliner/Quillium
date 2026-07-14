# Known Limitations

Current gaps and technical debt.

## Annotations

| Limitation | Impact |
|------------|--------|
| **Multi-selection not supported** | System assumes one selection range per annotation (`selection.main`). Multi-cursor not handled. |
| **Thread updates are coarse-grained** | `updateThread` replaces entire thread array. Undo of a single message edit reverts the entire thread. |
| **One pending comment at a time** | `canCreateNewComment()` enforces a single annotation with `status: "pending"`. Finer-grained locking unresolved. |
| **`addSuggestion` inversion uses `Math.max` on IDs** | Assumes IDs are sequential and increasing; works until suggestions are added in bulk. |

## Nested Editors

| Limitation | Impact |
|------------|--------|
| **`queueMicrotask` in `collapsedRevisionResolver`** | Necessary to avoid dispatching inside a `ViewPlugin.update`, but ordering relative to other queued microtasks not guaranteed under rapid undo. |
| **Deeply nested modal external-sync relies on `modalAnnotationStores`** | Each RevisionModal publishes nested editor annotations to a global per-level store. Could be replaced with direct parent-child signal. |
| **No cursor persistence on buffer replacement** | `syncFromParent` replaces entire buffer; cursor/selection and scroll position don't survive. |

## Collaboration

| Limitation | Impact |
|------------|--------|
| **Live Room mode only** | Session ends when owner disconnects. Persistent shared-document ownership deferred. |
| **Manual Live Room IDs** | Joiners paste a draft UUID manually. Invite links and room permissions are deferred. |
| **No local persistence for joiners** | Joiners restored to prior local draft/library after leaving. |
| **No offline queue** | If reconnect attempts exhausted, session enters `error` and must restart. |
| **Single-view Web Preview** | Read-only public links publish the active tab+draft snapshot, not all tabs/drafts. |

## Persistence

| Limitation | Impact |
|------------|--------|
| **Version-history rewind does not restore parent/branch links** | Rewinding across an orphan-delete restores the deleted draft, but children re-attached by that delete keep their current links (`draft_reparented` is not replayed), so the restored tree can differ from the true shape at T. Nothing is lost — links live on the rows and Undo can reverse them. |
| **History storage/prune tools are draft-scoped** | The version-history timeline is document-wide, but storage size and pruning act on the active draft's snapshots only (labeled as such in the panel). |

## UI

| Limitation | Impact |
|------------|--------|
| **Single API key per provider** | Can't configure multiple API keys for same provider. |
| **No keyboard shortcut customization** | Shortcuts are hardcoded. |
| **No full provenance attestation** | Authorship reports trust the local event log; they are evidence, not cryptographic proof. |

## Performance

| Limitation | Impact |
|------------|--------|
| **Full buffer replacement for nested editor sync** | Could be optimized with incremental patches, but complexity vs. frequency tradeoff. |
| **All personas run in parallel** | No rate limiting or queuing for multi-persona feedback. |

## Platform

| Limitation | Impact |
|------------|--------|
| **Desktop only** | No web or mobile version. |
| **No sync across devices** | Each device has its own local SQLite database. |
