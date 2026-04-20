# Phase 5: Relay Persistence - Research

**Researched:** 2026-04-17
**Domain:** Relay server database persistence with Supabase Postgres, write-through strategy, snapshots
**Confidence:** HIGH

## Summary

Phase 5 adds durability to the in-memory relay from Phase 4. The relay will persist all updates to Supabase Postgres via write-through persistence (D-40), store periodic snapshots (D-41), and reload full document state from DB on restart. This mirrors Quillium's local SQLite persistence pattern (events + snapshots) but adapted for a server-side relay context.

The existing `collab_updates` table from Phase 1 already has the correct schema for storing OT updates. The key implementation challenges are: (1) integrating Supabase writes into the existing push handler without blocking OT transforms, (2) implementing snapshot creation and storage, and (3) modifying room creation to load state from DB instead of starting empty.

**Primary recommendation:** Add a persistence layer module (`relay/src/persistence/`) that wraps Supabase client operations with retry logic per D-42. Modify `handlePushUpdates` to persist before broadcasting. Add snapshot creation on configurable thresholds. Modify `getOrCreateRoom` to load from DB.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-40:** Write-through persistence -- persist update to Postgres before broadcasting to clients (safest approach, ~5-10ms added latency acceptable for prototype)
- **D-41:** Periodic snapshots -- store full document snapshots every N updates or T minutes, replay only updates since last snapshot on reload. Matches Quillium's local SQLite persistence pattern.
- **D-42:** Retry then reject -- retry DB write 2-3 times with backoff, then reject the update with an error to the client. Client understands something is wrong and can retry or surface error to user.

### Claude's Discretion
- Exact snapshot frequency (N updates, T minutes)
- Snapshot storage location (new table vs column on sync_documents)
- Retry backoff timing and attempt count
- Error codes/messages for client rejection

### Deferred Ideas (OUT OF SCOPE)
- Snapshot compaction/cleanup (old snapshots accumulate) -- future optimization
- Read replicas for faster catchup -- not needed for prototype scale
- Compression of stored updates -- premature optimization
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RELY-05 | Relay persists updates to Supabase Postgres | Write-through in `handlePushUpdates` -> Supabase `collab_updates.insert()` with retry wrapper per D-42 |
| RELY-06 | Relay can reload state from DB on restart | `getOrCreateRoom` queries `collab_updates` for max version + updates; rebuilds `Text` from snapshot + replay |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Update persistence | Relay Server | Supabase Postgres | Relay writes to DB before broadcast per D-40 |
| Snapshot creation | Relay Server | Supabase Postgres | Relay creates snapshots on threshold; stores in DB |
| State reconstruction | Relay Server | Supabase Postgres | Relay queries DB to rebuild room state on creation |
| OT transforms | Relay Server | -- | Still in-memory per D-35; persistence is write-through |
| Version ordering | Relay Server | Supabase Postgres | Version assigned by relay, stored in `collab_updates.version` |

## Standard Stack

### Core (Existing from Phase 4)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @supabase/supabase-js | 2.103.3 | DB operations via Supabase client | [VERIFIED: npm registry] Already in relay deps; provides automatic retries since v2.102.0 |
| @codemirror/state | 6.6.0 | Text reconstruction from ChangeSet replay | [VERIFIED: npm registry] Already in relay; `Text.of()` + `changes.apply()` |

### New (Phase 5)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| fetch-retry | 6.0.0 | Custom retry wrapper for DB operations | [VERIFIED: npm registry] Supabase docs recommend for custom retry logic; exponential backoff |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| fetch-retry | Manual retry loop | fetch-retry handles jitter, backoff, error conditions; less code |
| Separate snapshots table | Column on sync_documents | Separate table allows multiple snapshots per document; better for history |
| Write-through | Write-behind (async) | Write-behind faster but risks data loss on crash; D-40 chose safety |

**Installation (in quillium-landing/relay/):**
```bash
bun add fetch-retry
```

**Version verification:**
- @supabase/supabase-js 2.103.3 -- already installed in relay [VERIFIED: relay/package.json]
- fetch-retry 6.0.0 -- [VERIFIED: npm view fetch-retry version]

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Quillium Client                                   │
│  ┌──────────────────┐                                                       │
│  │  pushUpdates     │──────────────────────────────────────────────┐        │
│  │  (version, [])   │                                              │        │
│  └──────────────────┘                                              │        │
└────────────────────────────────────────────────────────────────────┼────────┘
                                                                     │
                              WebSocket                              │
                                                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Relay Server (Fly.io)                                │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  pushUpdates Handler (modified in Phase 5)                            │  │
│  │                                                                       │  │
│  │    ┌─────────────┐    ┌──────────────┐    ┌────────────────────┐     │  │
│  │    │ processOT() │───▶│ persistToDB()│───▶│ broadcast()        │     │  │
│  │    │ (rebase)    │    │ (D-40 first) │    │ (only on success)  │     │  │
│  │    └─────────────┘    └──────┬───────┘    └────────────────────┘     │  │
│  │                              │                                        │  │
│  │                              │ retry on failure (D-42)                │  │
│  │                              │ 2-3 attempts, exponential backoff      │  │
│  │                              ▼                                        │  │
│  │    ┌─────────────────────────────────────────────────────────────┐   │  │
│  │    │ On retry exhausted: reject to client with error code        │   │  │
│  │    │ Client can retry or surface error to user                   │   │  │
│  │    └─────────────────────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  Room Manager (modified in Phase 5)                                   │  │
│  │                                                                       │  │
│  │  getOrCreateRoom(documentId)                                          │  │
│  │    ├─── room exists in memory? ───▶ return existing room             │  │
│  │    │                                                                  │  │
│  │    └─── room not in memory? ──────▶ loadFromDB()                     │  │
│  │                                      │                                │  │
│  │                                      ├── Query snapshots table        │  │
│  │                                      ├── Get latest snapshot          │  │
│  │                                      ├── Query collab_updates > ver   │  │
│  │                                      └── Rebuild Text via replay      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  Snapshot Manager (new in Phase 5)                                    │  │
│  │                                                                       │  │
│  │  checkSnapshotThreshold(room)                                         │  │
│  │    ├── updates since last snapshot >= N? ───▶ createSnapshot()       │  │
│  │    └── time since last snapshot >= T?    ───▶ createSnapshot()       │  │
│  │                                                                       │  │
│  │  createSnapshot(room)                                                 │  │
│  │    └── INSERT INTO snapshots (doc_id, version, state_json, ...)      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Supabase Postgres                                   │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │  collab_updates (existing from Phase 1)                            │    │
│  │  ┌──────────────────────────────────────────────────────────────┐  │    │
│  │  │ id | document_id | version | client_id | changes | created_at│  │    │
│  │  │ 1  | doc-abc     | 1       | cli-123   | {...}   | ...       │  │    │
│  │  │ 2  | doc-abc     | 2       | cli-456   | {...}   | ...       │  │    │
│  │  └──────────────────────────────────────────────────────────────┘  │    │
│  │  Index: (document_id, version) -- for version queries               │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │  collab_snapshots (new table for Phase 5)                          │    │
│  │  ┌──────────────────────────────────────────────────────────────┐  │    │
│  │  │ id | document_id | version | state_json | created_at         │  │    │
│  │  │ 1  | doc-abc     | 50      | "full doc" | ...                 │  │    │
│  │  │ 2  | doc-abc     | 100     | "full doc" | ...                 │  │    │
│  │  └──────────────────────────────────────────────────────────────┘  │    │
│  │  Index: (document_id, version DESC) -- for latest snapshot query    │    │
│  └────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (additions)
```
quillium-landing/
└── relay/
    └── src/
        ├── persistence/              # NEW: Phase 5
        │   ├── index.ts              # Export public API
        │   ├── retry.ts              # Retry wrapper with exponential backoff
        │   ├── updates.ts            # collab_updates operations
        │   └── snapshots.ts          # Snapshot create/load operations
        ├── rooms/
        │   └── manager.ts            # MODIFIED: loadFromDB on room creation
        └── handlers/
            └── push.ts               # MODIFIED: persist before broadcast
```

### Pattern 1: Write-Through Persistence in Push Handler
**What:** Persist update to DB before broadcasting to clients
**When to use:** Every pushUpdates call per D-40
**Example:**
```typescript
// Source: D-40, CONTEXT.md
import { persistUpdate } from "../persistence/updates.js";

export async function handlePushUpdates(
    io: Server,
    socket: Socket,
    room: DocumentRoom,
    data: unknown,
    callback: (response: unknown) => void,
): Promise<void> {
    // ... existing validation and OT processing ...

    const result = processUpdates(room, clientVersion, clientUpdates);
    if (!result.success) {
        callback({ error: result.error ?? "PROCESSING_FAILED" });
        return;
    }

    // D-40: Persist BEFORE broadcast
    const persistResult = await persistUpdate(room.documentId, result.updates, result.version);
    if (!persistResult.success) {
        // D-42: Retry exhausted, reject to client
        callback({ error: "PERSIST_FAILED", code: 5001 });
        // Roll back in-memory state? Or leave it? See Open Questions
        return;
    }

    // Only broadcast on successful persistence
    callback({ version: result.version });
    socket.to(room.documentId).emit("updates", { updates: serialized });

    // Check snapshot threshold after successful persist
    await checkSnapshotThreshold(room);
}
```

### Pattern 2: Retry Wrapper with Exponential Backoff
**What:** Wrap DB operations with retry logic per D-42
**When to use:** All Supabase insert/select operations
**Example:**
```typescript
// Source: D-42, Supabase docs on automatic-retries
// [CITED: https://supabase.com/docs/guides/api/automatic-retries-in-supabase-js]

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 100;
const MAX_DELAY_MS = 2000;

export async function withRetry<T>(
    operation: () => Promise<{ data: T | null; error: Error | null }>,
    operationName: string,
): Promise<{ success: boolean; data: T | null; error: string | null }> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const { data, error } = await operation();
            if (!error) {
                return { success: true, data, error: null };
            }
            lastError = error;
            
            // Don't retry on non-transient errors
            if (isNonTransientError(error)) {
                console.error(`[persistence] Non-transient error in ${operationName}:`, error);
                return { success: false, data: null, error: error.message };
            }

            // Exponential backoff with jitter
            const delay = Math.min(
                BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 100,
                MAX_DELAY_MS
            );
            console.warn(
                `[persistence] Retry ${attempt + 1}/${MAX_RETRIES} for ${operationName}, ` +
                `waiting ${delay}ms: ${error.message}`
            );
            await sleep(delay);
        } catch (err) {
            lastError = err as Error;
        }
    }

    console.error(`[persistence] ${operationName} failed after ${MAX_RETRIES} retries:`, lastError);
    return { success: false, data: null, error: lastError?.message ?? "Unknown error" };
}

function isNonTransientError(error: Error): boolean {
    // Constraint violations, invalid data, etc. won't succeed on retry
    const message = error.message.toLowerCase();
    return message.includes("unique constraint") ||
           message.includes("foreign key") ||
           message.includes("not null") ||
           message.includes("invalid");
}
```

### Pattern 3: Load Room State from Database
**What:** Reconstruct room state from snapshot + updates on room creation
**When to use:** When room doesn't exist in memory (first client or server restart)
**Example:**
```typescript
// Source: D-41, local Quillium pattern (src-tauri/src/db/load.rs)
import { Text } from "@codemirror/state";
import { ChangeSet } from "@codemirror/state";
import { supabase } from "../auth/supabase.js";
import type { Update } from "@codemirror/collab";

interface LoadResult {
    doc: Text;
    version: number;
    updates: Update[];
}

export async function loadRoomState(documentId: string): Promise<LoadResult> {
    // 1. Get latest snapshot
    const { data: snapshot } = await supabase
        .from("collab_snapshots")
        .select("version, state_json")
        .eq("document_id", documentId)
        .order("version", { ascending: false })
        .limit(1)
        .single();

    const snapshotVersion = snapshot?.version ?? 0;
    let doc = snapshot?.state_json
        ? Text.of([snapshot.state_json])
        : Text.of([""]);

    // 2. Get updates since snapshot
    const { data: updates } = await supabase
        .from("collab_updates")
        .select("version, client_id, changes")
        .eq("document_id", documentId)
        .gt("version", snapshotVersion)
        .order("version", { ascending: true });

    // 3. Replay updates to reconstruct current state
    const replayedUpdates: Update[] = [];
    for (const row of updates ?? []) {
        const changes = ChangeSet.fromJSON(row.changes);
        doc = changes.apply(doc);
        replayedUpdates.push({
            clientID: row.client_id,
            changes,
        });
    }

    const currentVersion = updates?.length
        ? updates[updates.length - 1].version
        : snapshotVersion;

    console.log(
        `[persistence] Loaded room ${documentId.slice(0, 8)}... ` +
        `from snapshot v${snapshotVersion}, replayed ${updates?.length ?? 0} updates to v${currentVersion}`
    );

    return {
        doc,
        version: currentVersion,
        updates: replayedUpdates,
    };
}
```

### Pattern 4: Snapshot Threshold Check (Matching Local Quillium)
**What:** Create snapshot after N updates or T minutes
**When to use:** After successful update persistence
**Example:**
```typescript
// Source: D-41, local pattern from src-tauri/src/db/events.rs
const SNAPSHOT_UPDATE_THRESHOLD = 50;  // Match local Quillium
const SNAPSHOT_TIME_THRESHOLD_MS = 120_000;  // 2 minutes, match local

interface RoomSnapshotMeta {
    lastSnapshotVersion: number;
    lastSnapshotTime: number;
}

const roomSnapshotMeta = new Map<string, RoomSnapshotMeta>();

export async function checkSnapshotThreshold(room: DocumentRoom): Promise<void> {
    const meta = roomSnapshotMeta.get(room.documentId) ?? {
        lastSnapshotVersion: 0,
        lastSnapshotTime: Date.now(),
    };

    const updatesSinceSnapshot = room.version - meta.lastSnapshotVersion;
    const timeSinceSnapshot = Date.now() - meta.lastSnapshotTime;

    if (
        updatesSinceSnapshot >= SNAPSHOT_UPDATE_THRESHOLD ||
        timeSinceSnapshot >= SNAPSHOT_TIME_THRESHOLD_MS
    ) {
        await createSnapshot(room);
        roomSnapshotMeta.set(room.documentId, {
            lastSnapshotVersion: room.version,
            lastSnapshotTime: Date.now(),
        });
    }
}

export async function createSnapshot(room: DocumentRoom): Promise<void> {
    const { error } = await supabase
        .from("collab_snapshots")
        .insert({
            document_id: room.documentId,
            version: room.version,
            state_json: room.doc.toString(),
        });

    if (error) {
        console.error(`[persistence] Snapshot creation failed:`, error);
        // Non-critical: don't fail the operation, just log
    } else {
        console.log(
            `[persistence] Created snapshot for ${room.documentId.slice(0, 8)}... at v${room.version}`
        );
    }
}
```

### Anti-Patterns to Avoid
- **Persisting AFTER broadcast:** Violates D-40. If persist fails after broadcast, clients have state that server doesn't have durably.
- **Blocking on retry indefinitely:** Per D-42, retry 2-3 times then reject. Don't hold up the client forever.
- **Loading full update history:** Without snapshots, loading a document with 10,000 updates would be slow. Snapshots are mandatory per D-41.
- **Skipping snapshot check on fast edits:** Snapshot threshold should be checked on every persist, not debounced.
- **Storing ChangeSet as string:** Must use `ChangeSet.toJSON()` for storage; raw toString() loses structure.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Retry with backoff | Manual sleep loops | withRetry wrapper or fetch-retry | Handles jitter, backoff caps, error classification |
| JSON serialization of ChangeSets | JSON.stringify(changes) | ChangeSet.toJSON() / fromJSON() | CodeMirror provides proper serialization that preserves structure |
| Version tracking | Custom counter table | collab_updates.version column | Already in schema per D-07/D-08; max(version) query is efficient with index |
| Snapshot compaction | Periodic DELETE old snapshots | Skip for prototype | D-41 defers cleanup; focus on correctness first |

**Key insight:** The persistence layer's job is to mirror memory to DB reliably. Use Supabase client's built-in retries (v2.102.0+) where possible, add custom retry wrapper for critical operations.

## Common Pitfalls

### Pitfall 1: In-Memory/DB State Divergence
**What goes wrong:** Room in memory has updates that aren't in DB, or vice versa
**Why it happens:** Persist fails but memory state already updated; or server restarts mid-batch
**How to avoid:** Per D-40, persist BEFORE updating memory. If persist fails, don't update room state.
**Warning signs:** Client reconnects and sees different version than expected; "time travel" in document

### Pitfall 2: Snapshot Version Mismatch
**What goes wrong:** Snapshot at version N, but updates start at version N+5 (gap)
**Why it happens:** Snapshot created but some updates already persisted since
**How to avoid:** Snapshot version MUST match room.version at creation time. Query max(version) from collab_updates, not room.version.
**Warning signs:** Replay produces corrupted text; changes applied in wrong order

### Pitfall 3: ChangeSet Serialization Format
**What goes wrong:** ChangeSet stored as string or wrong JSON format; can't deserialize on load
**Why it happens:** Using JSON.stringify() instead of ChangeSet.toJSON()
**How to avoid:** Always use CodeMirror's toJSON()/fromJSON() methods
**Warning signs:** "Cannot read property 'sections'" on load; invalid ChangeSet errors

### Pitfall 4: Retry Exhaustion Without Client Feedback
**What goes wrong:** Client waits forever; operation silently fails
**Why it happens:** Server retries but never responds to client callback
**How to avoid:** Per D-42, always respond to client. On retry exhaustion, send error code.
**Warning signs:** Client timeouts; operations "hang" from user perspective

### Pitfall 5: Memory Leak from Failed Persists
**What goes wrong:** Room state grows but isn't durable; on restart, data lost
**Why it happens:** Update added to room.updates[] but persist failed
**How to avoid:** Roll back room state on persist failure (remove update from room.updates)
**Warning signs:** High memory usage; document "resets" on server restart

## Code Examples

### New Migration: collab_snapshots Table
```sql
-- Migration: 20260417000001_create_collab_snapshots.sql
-- Purpose: Document snapshots for fast state reconstruction (D-41)

create table public.collab_snapshots (
    id bigint generated always as identity primary key,
    document_id uuid not null references public.sync_documents on delete cascade,
    version bigint not null,
    state_json text not null,
    created_at timestamptz default now() not null,

    -- One snapshot per version per document
    unique (document_id, version)
);

-- Index for latest snapshot query (ORDER BY version DESC LIMIT 1)
create index idx_collab_snapshots_doc_version
    on public.collab_snapshots (document_id, version desc);

comment on table public.collab_snapshots is 'Document snapshots for fast state reconstruction - D-41';
comment on column public.collab_snapshots.version is 'Version at which snapshot was taken';
comment on column public.collab_snapshots.state_json is 'Full document text at this version';
```

### Persistence Module: updates.ts
```typescript
// relay/src/persistence/updates.ts
// Source: D-40 write-through, D-42 retry

import { supabase } from "../auth/supabase.js";
import { withRetry } from "./retry.js";
import type { Update } from "@codemirror/collab";

export interface PersistResult {
    success: boolean;
    error?: string;
}

/**
 * Persist a batch of updates to collab_updates table.
 * Per D-40: Called BEFORE broadcasting to clients.
 * Per D-42: Retries on transient errors.
 */
export async function persistUpdates(
    documentId: string,
    updates: Update[],
    startVersion: number,
): Promise<PersistResult> {
    if (!supabase) {
        return { success: false, error: "Supabase not configured" };
    }

    // Build rows for batch insert
    const rows = updates.map((update, index) => ({
        document_id: documentId,
        version: startVersion - updates.length + index + 1,
        client_id: update.clientID,
        changes: update.changes.toJSON(),
    }));

    const result = await withRetry(
        () => supabase.from("collab_updates").insert(rows),
        `persistUpdates(${documentId.slice(0, 8)}..., ${updates.length} updates)`
    );

    return {
        success: result.success,
        error: result.error ?? undefined,
    };
}

/**
 * Get max version for a document.
 * Used when creating room to determine current version.
 */
export async function getMaxVersion(documentId: string): Promise<number> {
    if (!supabase) return 0;

    const { data, error } = await supabase
        .from("collab_updates")
        .select("version")
        .eq("document_id", documentId)
        .order("version", { ascending: false })
        .limit(1)
        .single();

    if (error || !data) return 0;
    return data.version;
}
```

### Error Codes for Client
```typescript
// relay/src/schemas.ts (additions)

/**
 * Error codes for persistence failures.
 * Per D-42: Client receives error code and can retry or surface to user.
 */
export const PersistErrorCode = {
    PERSIST_FAILED: 5001,
    PERSIST_TIMEOUT: 5002,
    PERSIST_CONFLICT: 5003,
} as const;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual retry loops | supabase-js built-in retries | v2.102.0 (Feb 2026) | Use built-in for simple cases; custom wrapper for control |
| Single table history | Snapshot + delta pattern | Well-established | Fast loading; bounded replay cost |
| Async persistence | Write-through | D-40 decision | Safer for prototype; add async later if latency matters |

**Deprecated/outdated:**
- **Manual JWKS/auth in persistence:** Already handled by existing supabase client from Phase 4
- **Storing raw ChangeSet.toString():** Must use toJSON() for proper serialization

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | 50 updates / 2 minutes snapshot threshold matches local Quillium pattern | Pattern 4 | Low -- can adjust thresholds easily |
| A2 | ~5-10ms added latency for write-through is acceptable | Summary (from CONTEXT.md) | Low -- prototype focus, can optimize later |
| A3 | Separate collab_snapshots table is better than column on sync_documents | Standard Stack | Low -- either works; separate table more flexible |

## Open Questions

1. **What happens to room memory state on persist failure?**
   - What we know: D-42 says reject to client. But room.updates[] already has the update.
   - What's unclear: Should we roll back room state? Or keep it and let client retry?
   - Recommendation: Roll back. If persist fails, pop the update from room.updates and decrement room.version. Client can retry the same operation.

2. **Snapshot threshold: updates OR time?**
   - What we know: Local Quillium uses `events >= 50 || seconds >= 120`
   - What's unclear: Should relay match exactly, or tune differently for server context?
   - Recommendation: Start with same thresholds (50 updates OR 2 minutes). Adjust if needed based on prototype usage.

3. **Should snapshots be created synchronously or asynchronously?**
   - What we know: D-41 says "periodic snapshots" but doesn't specify sync/async
   - What's unclear: Should snapshot creation block the push response?
   - Recommendation: Async. Snapshot creation is non-critical -- if it fails, next threshold check will try again. Don't add latency to push handler.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase Postgres | collab_updates, collab_snapshots tables | Yes | -- | -- |
| @supabase/supabase-js | DB operations | Yes | 2.103.3 | -- |
| collab_updates table | Update storage | Yes | -- | -- (Phase 1 created it) |
| collab_snapshots table | Snapshot storage | No | -- | Create in Wave 0 migration |

**Missing dependencies with no fallback:**
- collab_snapshots table -- must be created in Wave 0 migration

**Missing dependencies with fallback:**
- None

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.x (existing in relay) |
| Config file | `relay/vitest.config.ts` (exists) |
| Quick run command | `cd relay && bun run test` |
| Full suite command | `cd relay && bun run test:run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RELY-05 | persistUpdates inserts to collab_updates | unit (mocked Supabase) | `bun run test persistence.test.ts` | Wave 0 |
| RELY-05 | pushUpdates persists before broadcast | integration | `bun run test push.test.ts` | Wave 0 |
| RELY-05 | Retry logic retries on transient errors | unit | `bun run test retry.test.ts` | Wave 0 |
| RELY-05 | Retry exhaustion returns error to client | unit | `bun run test retry.test.ts` | Wave 0 |
| RELY-06 | loadRoomState queries snapshot + updates | unit (mocked) | `bun run test persistence.test.ts` | Wave 0 |
| RELY-06 | Room creation loads from DB | integration | `bun run test room.test.ts` | Modify existing |

### Sampling Rate
- **Per task commit:** `cd relay && bun run test` (unit tests with mocked Supabase)
- **Per wave merge:** Full suite + manual test with real Supabase
- **Phase gate:** Server restart test -- verify clients reconnect with correct state

### Wave 0 Gaps
- [ ] `relay/src/persistence/` directory structure
- [ ] `relay/src/__tests__/persistence.test.ts` -- persistence unit tests
- [ ] `relay/src/__tests__/retry.test.ts` -- retry logic tests
- [ ] `supabase/migrations/20260417000001_create_collab_snapshots.sql` -- new table
- [ ] Test helper for mocking Supabase client

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Already handled by Phase 4 auth middleware |
| V3 Session Management | No | No changes to session handling |
| V4 Access Control | Yes | Verify user has access before persisting (already checked in middleware) |
| V5 Input Validation | Yes | ChangeSet validated by CodeMirror before persist |
| V6 Cryptography | No | No crypto operations; TLS handled by Supabase |

### Known Threat Patterns for Persistence Layer

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via changes JSON | Tampering | Supabase client uses parameterized queries; ChangeSet validated by CodeMirror |
| Unauthorized document modification | Elevation | Auth middleware checks access before pushUpdates reaches persist |
| Denial of service via large updates | DoS | Rate limiting at Socket.io layer; DB connection limits |
| Data corruption via concurrent writes | Tampering | version column UNIQUE constraint; retry on conflict |

## Sources

### Primary (HIGH confidence)
- [CONTEXT.md D-40, D-41, D-42](file://.planning/phases/05-relay-persistence/05-CONTEXT.md) -- Locked decisions for this phase
- [Supabase Automatic Retries](https://supabase.com/docs/guides/api/automatic-retries-in-supabase-js) -- Built-in retry support, custom retry configuration
- [npm @supabase/supabase-js](https://www.npmjs.com/package/@supabase/supabase-js) -- Version 2.103.3 verified
- [npm fetch-retry](https://www.npmjs.com/package/fetch-retry) -- Version 6.0.0 verified
- [Local Quillium events.rs](file://src-tauri/src/db/events.rs) -- Snapshot threshold pattern (50 updates / 120 seconds)
- [Local Quillium load.rs](file://src-tauri/src/db/load.rs) -- State reconstruction pattern

### Secondary (MEDIUM confidence)
- [hyPiRion: System-Versioned Tables](https://hypirion.com/musings/implementing-system-versioned-tables-in-postgres) -- Snapshot + delta pattern reference
- [Store revisions in PostgreSQL](https://kaustavdm.in/versioning-content-postgresql/) -- Content versioning patterns

### Tertiary (LOW confidence)
- None -- all claims verified with official docs or locked decisions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use or verified via npm
- Architecture: HIGH -- mirrors local Quillium pattern with minor adaptations
- Pitfalls: HIGH -- based on D-40/D-41/D-42 decisions and established patterns

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (30 days -- stable libraries)
