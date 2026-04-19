# Phase 5: Relay Persistence - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-17
**Phase:** 05-relay-persistence
**Areas discussed:** Persistence Strategy, State Reload, Failure Handling

---

## Persistence Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Write-through | Persist to DB before broadcasting (safest, ~5-10ms added latency) | ✓ |
| Broadcast-then-persist | Broadcast immediately, persist async (lowest latency, small loss window on crash) | |
| Batched async | Buffer updates, batch insert every 100ms or 10 updates (balanced) | |

**User's choice:** Write-through
**Notes:** User asked about "small loss window" — clarified that async persistence risks losing updates if server crashes between broadcast and DB write. Chose safety over latency.

---

## State Reload

| Option | Description | Selected |
|--------|-------------|----------|
| Replay all updates | Store only collab_updates rows, replay from version 0 (simple, slower reload) | |
| Periodic snapshots | Snapshot every N updates or T minutes, replay from snapshot (faster reload) | ✓ |
| Snapshot on room close | Snapshot when room goes idle, replay from there (balanced) | |

**User's choice:** Periodic snapshots
**Notes:** User recognized this matches local Quillium persistence pattern (events + snapshots in SQLite). Chose consistency with existing architecture.

---

## Failure Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Retry then reject | Retry 2-3 times with backoff, then reject update with error | ✓ |
| Reject immediately | No retries, client gets error instantly | |
| Queue and pause room | Queue updates in memory, pause broadcasting, retry DB connection | |

**User's choice:** Retry then reject
**Notes:** User wanted clients to understand there's an error but still have the server retry before giving up.

---

## Claude's Discretion

- Exact snapshot frequency (N updates, T minutes)
- Snapshot storage location
- Retry backoff timing and attempt count
- Error codes/messages for client rejection

## Deferred Ideas

- Snapshot compaction/cleanup
- Read replicas
- Update compression
