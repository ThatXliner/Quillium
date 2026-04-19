# Phase 5: Relay Persistence - Pattern Map

**Mapped:** 2026-04-17
**Files analyzed:** 9
**Analogs found:** 6 / 9

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `relay/src/persistence/index.ts` | module-entry | N/A | `relay/src/rooms/index.ts` (implied) | role-match |
| `relay/src/persistence/retry.ts` | utility | request-response | (none in codebase) | no-analog |
| `relay/src/persistence/updates.ts` | service | CRUD | `relay/src/auth/supabase.ts` | partial-match |
| `relay/src/persistence/snapshots.ts` | service | CRUD | `src-tauri/src/db/events.rs` (Quillium) | exact |
| `relay/src/rooms/manager.ts` | service | event-driven | (existing - modify) | existing |
| `relay/src/handlers/push.ts` | handler | event-driven | (existing - modify) | existing |
| `relay/src/schemas.ts` | model | N/A | (existing - extend) | existing |
| `supabase/migrations/20260417000001_create_collab_snapshots.sql` | migration | N/A | `supabase/migrations/20260416000004_create_collab_updates.sql` | exact |
| `relay/src/__tests__/persistence.test.ts` | test | N/A | `relay/src/__tests__/auth.test.ts` | exact |

## Pattern Assignments

### `relay/src/persistence/updates.ts` (service, CRUD)

**Analog:** `relay/src/auth/supabase.ts` (Supabase client usage pattern)

**Imports pattern** (lines 1-12):
```typescript
/**
 * supabase.ts -- Supabase Admin client for relay server.
 *
 * Uses service_role key for JWT validation and permission queries.
 * No session persistence needed -- server-side only.
 *
 * Per D-32: Uses Supabase Admin SDK (@supabase/supabase-js with service_role key)
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
```

**Supabase query pattern** (from RESEARCH.md Code Examples):
```typescript
// Batch insert pattern for updates
const { error } = await supabase
    .from("collab_updates")
    .insert(rows);

// Query pattern for max version
const { data, error } = await supabase
    .from("collab_updates")
    .select("version")
    .eq("document_id", documentId)
    .order("version", { ascending: false })
    .limit(1)
    .single();
```

**Null-safe client check pattern** (lines 14-18):
```typescript
export const supabaseConfigured = !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

if (!supabaseConfigured) {
    console.warn("[supabase] Missing environment variables -- auth features will not work");
}
```

---

### `relay/src/persistence/snapshots.ts` (service, CRUD)

**Analog:** `src-tauri/src/db/events.rs` (Quillium local persistence)

**Snapshot threshold constants** (lines 6-7):
```rust
const SNAPSHOT_EVENT_THRESHOLD: i64 = 50;
const SNAPSHOT_TIME_THRESHOLD_SECS: i64 = 120;
```

**TypeScript adaptation:**
```typescript
const SNAPSHOT_UPDATE_THRESHOLD = 50;  // Match local Quillium
const SNAPSHOT_TIME_THRESHOLD_MS = 120_000;  // 2 minutes
```

**Threshold check logic** (lines 61-94):
```rust
fn check_snapshot_threshold(conn: &Connection, draft_id: &str, now_ms: i64) -> Result<bool> {
    // Get the latest snapshot for this draft
    let latest_snapshot: Option<(i64, i64)> = conn
        .query_row(
            "SELECT up_to_event_id, created_at FROM snapshots
             WHERE draft_id = ?1 ORDER BY up_to_event_id DESC LIMIT 1",
            params![draft_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .ok();

    match latest_snapshot {
        None => {
            // No snapshot at all -- check total event count
            let total: i64 = conn.query_row(
                "SELECT COUNT(*) FROM events WHERE draft_id = ?1",
                params![draft_id],
                |row| row.get(0),
            )?;
            Ok(total >= SNAPSHOT_EVENT_THRESHOLD)
        }
        Some((last_event_id, last_snap_time)) => {
            // Events since last snapshot
            let events_since: i64 = conn.query_row(
                "SELECT COUNT(*) FROM events WHERE draft_id = ?1 AND id > ?2",
                params![draft_id, last_event_id],
                |row| row.get(0),
            )?;
            let secs_since = (now_ms - last_snap_time) / 1000;
            Ok(events_since >= SNAPSHOT_EVENT_THRESHOLD
                || secs_since >= SNAPSHOT_TIME_THRESHOLD_SECS)
        }
    }
}
```

**TypeScript adaptation for relay:**
```typescript
interface RoomSnapshotMeta {
    lastSnapshotVersion: number;
    lastSnapshotTime: number;
}

const roomSnapshotMeta = new Map<string, RoomSnapshotMeta>();

export async function checkSnapshotThreshold(room: DocumentRoom): Promise<boolean> {
    const meta = roomSnapshotMeta.get(room.documentId) ?? {
        lastSnapshotVersion: 0,
        lastSnapshotTime: Date.now(),
    };

    const updatesSinceSnapshot = room.version - meta.lastSnapshotVersion;
    const timeSinceSnapshot = Date.now() - meta.lastSnapshotTime;

    return (
        updatesSinceSnapshot >= SNAPSHOT_UPDATE_THRESHOLD ||
        timeSinceSnapshot >= SNAPSHOT_TIME_THRESHOLD_MS
    );
}
```

**Snapshot creation** (lines 96-109):
```rust
pub fn create_snapshot(
    conn: &Connection,
    draft_id: &str,
    state_json: &str,
    up_to_event_id: i64,
) -> Result<()> {
    let now = now_ms();
    conn.execute(
        "INSERT INTO snapshots (draft_id, up_to_event_id, state_json, created_at, label)
         VALUES (?1, ?2, ?3, ?4, NULL)",
        params![draft_id, up_to_event_id, state_json, now],
    )?;
    Ok(())
}
```

---

### `relay/src/rooms/manager.ts` (existing - modify for DB loading)

**Analog:** `src-tauri/src/db/load.rs` (Quillium state reconstruction)

**Current getOrCreateRoom pattern** (lines 22-42):
```typescript
export function getOrCreateRoom(documentId: string): DocumentRoom {
    let room = rooms.get(documentId);

    if (!room) {
        room = {
            documentId,
            doc: Text.of([""]), // Empty doc for Phase 4; Phase 5 loads from DB
            version: 0,
            updates: [],
            pending: new Map(),
            cleanupTimer: null,
        };
        rooms.set(documentId, room);
        console.log(`[rooms] Created room ${documentId.slice(0, 8)}...`);
    }

    // Cancel any pending cleanup
    cancelRoomCleanup(room);

    return room;
}
```

**Load state pattern from Quillium** (lines 5-83):
```rust
pub fn load_document_state(
    conn: &Connection,
    doc_id: &str,
    draft_id: Option<&str>,
) -> Result<LoadResult> {
    // ... resolve draft_id ...

    // Get the latest snapshot
    let snapshot: Option<(String, i64)> = conn
        .query_row(
            "SELECT state_json, up_to_event_id FROM snapshots
             WHERE draft_id = ?1 ORDER BY up_to_event_id DESC LIMIT 1",
            params![resolved_draft_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .ok();

    let (snapshot_state_json, snapshot_event_id) = match snapshot {
        Some((json, id)) => (Some(json), id),
        None => (None, -1),
    };

    // Get events after the snapshot
    let mut stmt = conn.prepare(
        "SELECT id, event_type, payload, created_at FROM events
         WHERE draft_id = ?1 AND id > ?2 ORDER BY id ASC",
    )?;
    // ... replay events ...

    Ok(LoadResult {
        snapshot_state_json,
        snapshot_event_id,
        events_since: events,
    })
}
```

**TypeScript adaptation for relay (from RESEARCH.md):**
```typescript
export async function loadRoomState(documentId: string): Promise<{
    doc: Text;
    version: number;
    updates: Update[];
}> {
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

    // 3. Replay updates
    const replayedUpdates: Update[] = [];
    for (const row of updates ?? []) {
        const changes = ChangeSet.fromJSON(row.changes);
        doc = changes.apply(doc);
        replayedUpdates.push({ clientID: row.client_id, changes });
    }

    return { doc, version: updates?.at(-1)?.version ?? snapshotVersion, updates: replayedUpdates };
}
```

---

### `relay/src/handlers/push.ts` (existing - modify for write-through)

**Current handler pattern** (lines 17-75):
```typescript
export function handlePushUpdates(
    io: Server,
    socket: Socket,
    room: DocumentRoom,
    data: unknown,
    callback: (response: unknown) => void,
): void {
    // ... validation ...
    
    // Process updates with OT
    const result = processUpdates(room, clientVersion, clientUpdates);

    if (!result.success) {
        console.warn("[push] Processing failed:", result.error);
        callback({ error: result.error ?? "PROCESSING_FAILED" });
        return;
    }

    // Acknowledge to sender
    callback({ version: result.version });

    // Per RELY-04: Broadcast to all room members except sender
    socket.to(room.documentId).emit("updates", { updates: serialized });
}
```

**Modification needed per D-40 (write-through):**
```typescript
// D-40: Persist BEFORE broadcast
const persistResult = await persistUpdate(room.documentId, result.updates, result.version);
if (!persistResult.success) {
    // D-42: Retry exhausted, reject to client
    callback({ error: "PERSIST_FAILED", code: 5001 });
    // Roll back room state
    return;
}

// Only broadcast on successful persistence
callback({ version: result.version });
socket.to(room.documentId).emit("updates", { updates: serialized });

// Check snapshot threshold after successful persist
await checkSnapshotThreshold(room);
```

---

### `relay/src/persistence/retry.ts` (utility, retry logic)

**Analog:** None in codebase - use RESEARCH.md Pattern 2

**Retry pattern from RESEARCH.md:**
```typescript
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
    const message = error.message.toLowerCase();
    return message.includes("unique constraint") ||
           message.includes("foreign key") ||
           message.includes("not null") ||
           message.includes("invalid");
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
```

---

### `relay/src/schemas.ts` (existing - extend with error codes)

**Current error codes** (lines 24-31):
```typescript
export const AuthErrorCode = {
    AUTH_REQUIRED: 4001,
    AUTH_INVALID: 4002,
    AUTH_EXPIRED: 4003,
    PERMISSION_DENIED: 4004,
} as const;
```

**Extension needed (from RESEARCH.md):**
```typescript
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

---

### `supabase/migrations/20260417000001_create_collab_snapshots.sql` (migration)

**Analog:** `supabase/migrations/20260416000004_create_collab_updates.sql`

**Table creation pattern** (lines 5-15):
```sql
create table public.collab_updates (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.sync_documents on delete cascade,
  version bigint not null,
  client_id text not null,
  changes jsonb not null,
  created_at timestamptz default now() not null,

  -- Enforce version uniqueness per document (critical for OT ordering)
  unique (document_id, version)
);
```

**Index pattern** (lines 21-23):
```sql
-- Critical index for version queries (relay hot path)
create index idx_collab_updates_doc_version
  on public.collab_updates (document_id, version);
```

**Comment pattern** (lines 25-28):
```sql
comment on table public.collab_updates is 'Ordered OT updates from @codemirror/collab - DATA-03';
comment on column public.collab_updates.version is 'Monotonic version assigned by relay server (D-08)';
```

**collab_snapshots table (from RESEARCH.md):**
```sql
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

---

### `relay/src/__tests__/persistence.test.ts` (test)

**Analog:** `relay/src/__tests__/auth.test.ts`

**Mock pattern** (lines 95-110):
```typescript
// Mock Supabase module
vi.mock("../auth/supabase.js", () => ({
    supabaseConfigured: true,
    supabase: {
        auth: {
            getUser: vi.fn(),
        },
        from: vi.fn(() => ({
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    single: vi.fn(),
                })),
            })),
        })),
    },
}));
```

**Describe block pattern** (lines 623-643):
```typescript
describe("RELY-01: JWT Authentication", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("rejects connection without token", async () => {
        const socket = createMockSocket({});
        const next = vi.fn();

        await authMiddleware(socket, next);

        expect(next).toHaveBeenCalledWith(expect.any(Error));
        expect(next.mock.calls[0][0].message).toBe(`${AuthErrorCode.AUTH_REQUIRED}`);
    });
```

**Persistence test pattern:**
```typescript
describe("RELY-05: Update Persistence", () => {
    it("persists updates to collab_updates table", async () => {
        // Mock Supabase insert
        const mockInsert = vi.fn().mockResolvedValue({ error: null });
        vi.mocked(supabase!.from).mockReturnValue({
            insert: mockInsert,
        } as any);

        const result = await persistUpdates(documentId, updates, version);

        expect(result.success).toBe(true);
        expect(mockInsert).toHaveBeenCalled();
    });

    it("retries on transient error", async () => {
        // First two calls fail, third succeeds
        const mockInsert = vi.fn()
            .mockResolvedValueOnce({ error: { message: "connection timeout" } })
            .mockResolvedValueOnce({ error: { message: "connection timeout" } })
            .mockResolvedValueOnce({ error: null });

        vi.mocked(supabase!.from).mockReturnValue({
            insert: mockInsert,
        } as any);

        const result = await persistUpdates(documentId, updates, version);

        expect(result.success).toBe(true);
        expect(mockInsert).toHaveBeenCalledTimes(3);
    });
});
```

---

## Shared Patterns

### Error Handling
**Source:** `relay/src/handlers/push.ts` (lines 47-51)
**Apply to:** All persistence operations

```typescript
if (!result.success) {
    console.warn("[push] Processing failed:", result.error);
    callback({ error: result.error ?? "PROCESSING_FAILED" });
    return;
}
```

### Logging Convention
**Source:** `relay/src/rooms/manager.ts`, `relay/src/rooms/ot.ts`
**Apply to:** All persistence files

```typescript
// Module prefix in square brackets
console.log(`[persistence] Created snapshot for ${documentId.slice(0, 8)}... at v${version}`);
console.warn(`[persistence] Retry ${attempt + 1}/${MAX_RETRIES} for ${operationName}`);
console.error(`[persistence] ${operationName} failed after ${MAX_RETRIES} retries:`, error);
```

### Supabase Query Pattern
**Source:** `relay/src/auth/supabase.ts`
**Apply to:** `relay/src/persistence/updates.ts`, `relay/src/persistence/snapshots.ts`

```typescript
// Null-safe supabase check
if (!supabase) {
    return { success: false, error: "Supabase not configured" };
}

// Query with error handling
const { data, error } = await supabase
    .from("table_name")
    .select("columns")
    .eq("column", value);

if (error) {
    return { success: false, error: error.message };
}
```

### ChangeSet Serialization
**Source:** `relay/src/rooms/ot.ts` (lines 118-131)
**Apply to:** `relay/src/persistence/updates.ts`

```typescript
// Serialize for storage
changes: update.changes.toJSON()

// Deserialize from storage
changes: ChangeSet.fromJSON(row.changes)
```

---

## No Analog Found

Files with no close match in the codebase (use RESEARCH.md patterns):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `relay/src/persistence/retry.ts` | utility | request-response | No retry wrapper exists; use RESEARCH.md Pattern 2 |

**Recommendation:** The retry logic is well-documented in RESEARCH.md with a complete implementation. Use that pattern directly.

---

## Metadata

**Analog search scope:**
- `/Users/bryanhu/Developer/current/Quillium/src-tauri/src/db/` (Quillium local persistence)
- `/Users/bryanhu/Developer/current/quillium-landing/relay/src/` (Phase 4 relay code)
- `/Users/bryanhu/Developer/current/Quillium/supabase/migrations/` (DB migrations)

**Files scanned:** 15+
**Pattern extraction date:** 2026-04-17
