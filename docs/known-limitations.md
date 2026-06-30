# Known Limitations

Current gaps and technical debt.

## Annotations

| Limitation | Impact |
|------------|--------|
| **Multi-selection not supported** | System assumes one selection range per annotation (`selection.main`). Multi-cursor not handled. |
| **Thread updates are coarse-grained** | `updateThread` replaces entire thread array. Undo of a single message edit reverts the entire thread. |
| **One pending comment at a time** | `canCreateNewComment()` enforces single draft (empty-thread) comment. Finer-grained locking unresolved. |
| **No explicit annotation status enum** | `thread.length === 0` means pending comment; no FSM. Acknowledged technical debt. |
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
| **Non-active revision version text is snapshot-only** | If crash occurs between snapshots, non-active versions may be stale. |
| **`activeVersionId` is snapshot-only** | Same crash window concern. |
| **Version labels are snapshot-only** | Same crash window concern. |

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
