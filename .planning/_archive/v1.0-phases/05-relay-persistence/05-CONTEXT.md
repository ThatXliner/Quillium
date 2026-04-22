# Phase 5: Relay Persistence - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Relay persists all updates to Supabase Postgres and can reload full document state from DB on restart. Clients reconnecting after server restart get correct state. This phase adds durability to the in-memory relay from Phase 4.

</domain>

<decisions>
## Implementation Decisions

### Persistence Strategy
- **D-40:** Write-through persistence — persist update to Postgres before broadcasting to clients (safest approach, ~5-10ms added latency acceptable for prototype)

### State Reload
- **D-41:** Periodic snapshots — store full document snapshots every N updates or T minutes, replay only updates since last snapshot on reload. Matches Quillium's local SQLite persistence pattern (events table + snapshots table).

### Failure Handling
- **D-42:** Retry then reject — retry DB write 2-3 times with backoff, then reject the update with an error to the client. Client understands something is wrong and can retry or surface error to user.

### Claude's Discretion
- Exact snapshot frequency (N updates, T minutes)
- Snapshot storage location (new table vs column on sync_documents)
- Retry backoff timing and attempt count
- Error codes/messages for client rejection

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — RELY-05 (persist updates), RELY-06 (reload state on restart)

### Prior Decisions
- `.planning/phases/01-data-model/01-CONTEXT.md` — D-07/D-08 (one row per update, each = version number)
- `.planning/phases/04-relay-core/04-CONTEXT.md` — D-35 (full doc in memory per room), D-36 (client-driven catchup)

### Architecture Context
- `.planning/PROJECT.md` — Relay location (quillium-landing), Supabase Postgres as source of truth
- `docs/omni-reference/OMNI-CONTEXT.md` — Full architecture diagram, data model

### Local Persistence Pattern (reference)
- `ARCHITECTURE.md` § Persistence — Event log + snapshots pattern used locally
- `src-tauri/src/db/events.rs` — Event append, snapshot threshold logic
- `src-tauri/src/db/load.rs` — State reconstruction from snapshot + events

### Database Schema
- `supabase/migrations/20260416000004_create_collab_updates.sql` — collab_updates table structure

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Local persistence pattern (events + snapshots) provides reference implementation
- Supabase client patterns from Phase 4 relay (Admin SDK with service_role key)

### Established Patterns
- Write-ahead logging concept from local SQLite (similar to write-through)
- Snapshot thresholds: local uses ~50 events or ~120 seconds — can inform relay settings

### Integration Points
- Relay server (Phase 4) needs persistence layer added
- `collab_updates` table receives all persisted updates
- New snapshots storage needed (table or column TBD)

</code_context>

<specifics>
## Specific Ideas

- Persistence pattern mirrors local Quillium architecture — familiar pattern, proven approach
- Write-through chosen over async for data safety in prototype (latency acceptable)
- Retry-then-reject gives clients clear signal to handle errors gracefully

</specifics>

<deferred>
## Deferred Ideas

- Snapshot compaction/cleanup (old snapshots accumulate) — future optimization
- Read replicas for faster catchup — not needed for prototype scale
- Compression of stored updates — premature optimization

</deferred>

---

*Phase: 05-relay-persistence*
*Context gathered: 2026-04-17*
