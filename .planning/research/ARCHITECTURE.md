# Architecture Patterns

**Domain:** Real-time collaborative text editing with @codemirror/collab
**Researched:** 2026-04-16
**Confidence:** HIGH (based on official CodeMirror documentation and established collaborative editing patterns)

## Recommended Architecture

Quillium Omni follows the **Operational Transformation (OT) with Central Authority** pattern, which is the native model for `@codemirror/collab`. This architecture has three tiers:

```
                              ┌─────────────────────────────────┐
                              │         Supabase                │
                              │  ┌──────────┐  ┌─────────────┐  │
                              │  │   Auth   │  │  Postgres   │  │
                              │  │          │  │             │  │
                              │  │  JWT     │  │ collab_     │  │
                              │  │  tokens  │  │ updates     │  │
                              │  └────┬─────┘  └──────┬──────┘  │
                              │       │               │         │
                              └───────┼───────────────┼─────────┘
                                      │               │
                              ┌───────┴───────────────┴─────────┐
                              │        Collab Relay Server      │
                              │        (Node.js + WebSocket)    │
                              │                                 │
                              │  ┌───────────────────────────┐  │
                              │  │     Per-Document Room     │  │
                              │  │                           │  │
                              │  │  • Version counter        │  │
                              │  │  • In-memory doc state    │  │
                              │  │  • Connected clients[]    │  │
                              │  │  • Pending pulls[]        │  │
                              │  └───────────────────────────┘  │
                              │                                 │
                              │  Fly.io (~$7/mo)                │
                              └──────────┬──────────────────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                    │
           ┌────────┴────────┐  ┌────────┴────────┐  ┌────────┴────────┐
           │   Quillium A    │  │   Quillium B    │  │   Quillium C    │
           │   (Owner)       │  │  (Collaborator) │  │  (Collaborator) │
           │                 │  │                 │  │                 │
           │  ┌───────────┐  │  │  ┌───────────┐  │  │  ┌───────────┐  │
           │  │ collab()  │  │  │  │ collab()  │  │  │  │ collab()  │  │
           │  │ extension │  │  │  │ extension │  │  │  │ extension │  │
           │  │           │  │  │  │           │  │  │  │           │  │
           │  │ • version │  │  │  │ • version │  │  │  │ • version │  │
           │  │ • pending │  │  │  │ • pending │  │  │  │ • pending │  │
           │  │ • clientID│  │  │  │ • clientID│  │  │  │ • clientID│  │
           │  └───────────┘  │  │  └───────────┘  │  │  └───────────┘  │
           │                 │  │                 │  │                 │
           │  Local SQLite   │  │  No local       │  │  No local       │
           │  (offline edits)│  │  persistence    │  │  persistence    │
           └─────────────────┘  └─────────────────┘  └─────────────────┘
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|----------------|-------------------|
| **Supabase Auth** | JWT token issuance, user identity, session management | Quillium clients (login flow), Relay server (token validation) |
| **Supabase Postgres** | Persistent storage for collab_updates, document registry | Relay server (read/write on connect/disconnect) |
| **Collab Relay Server** | WebSocket hub, version arbitration, OT rebasing, broadcast | All connected Quillium clients, Supabase Postgres |
| **Quillium Client (collab module)** | Local collab() extension, sendable/receive updates, offline queue | Relay server via WebSocket |
| **Quillium Client (editor)** | CodeMirror state, annotations, local persistence | collab module (for sync), local SQLite (owner only) |

### Data Flow

**Edit propagation (happy path):**

```
1. User types in CodeMirror
   │
   ▼
2. Transaction dispatched → collab extension intercepts
   │
   ▼
3. sendableUpdates(state) returns pending changes
   │
   ▼
4. Client sends: { type: "pushUpdates", version, updates[] }
   │
   ▼
5. Relay validates version matches server version
   │
   ├─ YES: Accept updates, bump version, broadcast to all peers
   │
   └─ NO: rebaseUpdates() transforms client changes over missed history
          then accept + broadcast
   │
   ▼
6. Other clients receive: { type: "updates", updates[] }
   │
   ▼
7. Each client: view.dispatch(receiveUpdates(state, updates))
   │
   ▼
8. OT transposes remote changes across local unconfirmed edits
   │
   ▼
9. Document converges to same state on all clients
```

**Initial connection:**

```
1. Client opens document with sync enabled
   │
   ▼
2. Client authenticates with Supabase Auth → receives JWT
   │
   ▼
3. Client connects WebSocket with JWT in handshake
   │
   ▼
4. Relay validates JWT, looks up document in Postgres
   │
   ├─ Document exists: Load collab_updates since last snapshot
   │
   └─ New document: Initialize with current doc state from client
   │
   ▼
5. Relay sends: { type: "document", version, doc, updates[] }
   │
   ▼
6. Client initializes collab() extension with starting version
```

**Offline → reconnection (owner only):**

```
1. Connection lost, client detects disconnect
   │
   ▼
2. Local edits continue → stored in offline queue (local SQLite)
   │
   ▼
3. Connection restored → WebSocket reconnects
   │
   ▼
4. Client sends: { type: "getDocument", lastKnownVersion }
   │
   ▼
5. Relay returns all updates since lastKnownVersion
   │
   ├─ History available: Client receives updates, rebases local queue
   │
   └─ History pruned: Full document sync required (rare)
   │
   ▼
6. Client pushes offline queue with rebased changes
```

## Patterns to Follow

### Pattern 1: Central Authority with Version Counter

**What:** A single server maintains the authoritative document version. Version = number of accepted updates since document creation.

**When:** Always for @codemirror/collab systems.

**Example:**
```typescript
// Server-side
interface DocumentRoom {
    doc: Text;
    version: number;
    updates: Update[];
    pendingPulls: Array<{ version: number; resolve: (updates: Update[]) => void }>;
}

// Accept updates only if version matches
function pushUpdates(room: DocumentRoom, clientVersion: number, updates: Update[]): boolean {
    if (clientVersion !== room.version) {
        // Rebase or reject
        return false;
    }
    room.updates.push(...updates);
    room.version += updates.length;
    applyUpdates(room.doc, updates);
    notifyPendingPulls(room);
    return true;
}
```

### Pattern 2: Long-Polling Pull with Pending Queue

**What:** When clients ask for updates at the current version, the server holds the request until new updates arrive.

**When:** Always for efficient real-time sync without constant polling.

**Example:**
```typescript
// Server-side pull handler
async function pullUpdates(room: DocumentRoom, clientVersion: number): Promise<Update[]> {
    if (clientVersion < room.version) {
        // Return immediately if behind
        return room.updates.slice(clientVersion);
    }
    // Wait for new updates
    return new Promise(resolve => {
        room.pendingPulls.push({ version: clientVersion, resolve });
    });
}

// When new updates arrive
function notifyPendingPulls(room: DocumentRoom) {
    for (const pending of room.pendingPulls) {
        pending.resolve(room.updates.slice(pending.version));
    }
    room.pendingPulls = [];
}
```

### Pattern 3: WebSocket Message Protocol

**What:** Structured message types for client-server communication.

**When:** For production WebSocket relay servers.

**Example:**
```typescript
// Message types
type ClientMessage =
    | { type: "getDocument"; documentId: string }
    | { type: "pushUpdates"; documentId: string; version: number; updates: SerializedUpdate[] }
    | { type: "pullUpdates"; documentId: string; version: number };

type ServerMessage =
    | { type: "document"; version: number; doc: string }
    | { type: "updates"; updates: SerializedUpdate[] }
    | { type: "pushResult"; success: boolean; version?: number }
    | { type: "error"; code: string; message: string };

// Serialized update format (JSON-safe)
interface SerializedUpdate {
    clientID: string;
    changes: any; // ChangeSet.toJSON() output
    effects?: any[]; // Optional shared effects
}
```

### Pattern 4: Shared Effects for Annotations

**What:** Using @codemirror/collab's sharedEffects to sync non-document state (annotations, comments, revisions).

**When:** When annotation state must sync across collaborators.

**Example:**
```typescript
import { collab, sendableUpdates, receiveUpdates } from "@codemirror/collab";
import { addAnnotation, removeAnnotation, updateThread } from "./annotationField";

// Configure collab with annotation effects
const collabExtension = collab({
    startVersion: initialVersion,
    clientID: uniqueClientId,
    sharedEffects: (tr) => {
        // Extract annotation effects that should sync
        const shared: StateEffect<any>[] = [];
        for (const effect of tr.effects) {
            if (effect.is(addAnnotation) ||
                effect.is(removeAnnotation) ||
                effect.is(updateThread)) {
                shared.push(effect);
            }
        }
        return shared;
    }
});
```

### Pattern 5: JWT Validation on WebSocket Handshake

**What:** Validate Supabase JWT during WebSocket upgrade, not per-message.

**When:** For authenticated collaborative sessions.

**Example:**
```typescript
// Server-side WebSocket handler (ws library)
import { createClient } from "@supabase/supabase-js";

wss.on("connection", async (ws, req) => {
    // Extract token from query string or header
    const token = new URL(req.url, "http://localhost").searchParams.get("token");
    
    if (!token) {
        ws.close(4001, "Missing authentication token");
        return;
    }
    
    // Validate with Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
        ws.close(4003, "Invalid token");
        return;
    }
    
    // Attach user to connection for later use
    ws.userId = user.id;
    ws.email = user.email;
    
    // Connection is now authenticated
    handleAuthenticatedConnection(ws);
});
```

### Pattern 6: Document Room Lifecycle

**What:** Create rooms on-demand, persist on idle, clean up when empty.

**When:** For efficient resource usage on the relay server.

**Example:**
```typescript
const rooms = new Map<string, DocumentRoom>();

async function getOrCreateRoom(documentId: string): Promise<DocumentRoom> {
    if (rooms.has(documentId)) {
        return rooms.get(documentId)!;
    }
    
    // Load from database
    const { doc, updates } = await loadDocumentFromPostgres(documentId);
    
    const room: DocumentRoom = {
        doc: Text.of([doc]),
        version: updates.length,
        updates,
        clients: new Set(),
        pendingPulls: [],
        lastActivity: Date.now(),
    };
    
    rooms.set(documentId, room);
    return room;
}

// Periodic cleanup
setInterval(() => {
    const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
    for (const [id, room] of rooms) {
        if (room.clients.size === 0 && Date.now() - room.lastActivity > IDLE_TIMEOUT) {
            // Persist to database before evicting
            persistRoomToPostgres(id, room);
            rooms.delete(id);
        }
    }
}, 60 * 1000);
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Polling Instead of Long-Polling

**What:** Clients repeatedly request updates on a fixed interval.

**Why bad:** Wastes bandwidth, adds latency (average delay = interval/2), hammers server.

**Instead:** Use long-polling where server holds request until updates exist, or WebSocket push.

### Anti-Pattern 2: Broadcasting Without Version Tracking

**What:** Server broadcasts all changes to all clients without checking client version.

**Why bad:** Clients may receive duplicate updates or miss updates during reconnection.

**Instead:** Always track client version; send only updates since their known version.

### Anti-Pattern 3: Storing Full Document State Per Update

**What:** Each update stores a complete document snapshot.

**Why bad:** O(n*m) storage where n = doc size, m = update count. Unsustainable.

**Instead:** Store change deltas only. Reconstruct state by replaying updates on a base snapshot.

### Anti-Pattern 4: Trusting Client Version Without Validation

**What:** Accepting whatever version number the client claims.

**Why bad:** Malicious or buggy clients can corrupt document history.

**Instead:** Server is authority. If client version mismatches, either rebase or reject.

### Anti-Pattern 5: Per-Message JWT Validation

**What:** Validating the JWT token on every WebSocket message.

**Why bad:** Unnecessary overhead; JWT validation is expensive.

**Instead:** Validate once on connection. Use WebSocket close to revoke access.

### Anti-Pattern 6: Synchronous Annotation Sync Separate from Document Sync

**What:** Syncing annotations through a different channel than document changes.

**Why bad:** Race conditions where annotation refers to deleted text, or text exists without expected annotation.

**Instead:** Use @codemirror/collab's sharedEffects to bundle annotations with document changes atomically.

## Suggested Build Order

Based on component dependencies, the recommended implementation order is:

```
Phase 1: Auth Foundation
├── Supabase Auth integration (client-side)
├── JWT token storage and refresh
└── Login/logout UI (minimal)
    │
    ▼
Phase 2: Relay Server Core
├── WebSocket server skeleton (ws or uWebSockets.js)
├── JWT validation on handshake
├── In-memory document rooms
├── Message protocol (getDocument, pushUpdates, pullUpdates)
└── Basic broadcast
    │
    ▼
Phase 3: Client Collab Integration
├── collab() extension wired into CodeMirror
├── WebSocket client in src/lib/sync/relay.ts
├── sendableUpdates → push loop
├── receiveUpdates → pull loop
└── Connection state UI (connected/disconnected)
    │
    ▼
Phase 4: Persistence Layer
├── Supabase Postgres tables (sync_documents, collab_updates)
├── Relay loads room from DB on first connect
├── Relay persists updates to DB periodically
└── Relay persists on room idle/empty
    │
    ▼
Phase 5: Annotation Sync
├── sharedEffects configuration for annotationField effects
├── Effect serialization/deserialization
└── Integration testing with comments/revisions
    │
    ▼
Phase 6: Offline Queue (Owner Only)
├── Detect disconnect, queue local changes
├── On reconnect, request updates since lastKnownVersion
├── Rebase offline queue, push
└── Handle history-pruned case (full sync)
```

**Dependency rationale:**
- Phase 1 (Auth) is prerequisite for everything — relay needs to know who's connecting
- Phase 2 (Relay Core) must exist before client can integrate
- Phase 3 (Client Collab) needs relay to test against
- Phase 4 (Persistence) can be added after core sync works in-memory
- Phase 5 (Annotation Sync) needs both relay and client collab working
- Phase 6 (Offline) is an enhancement after basic sync works

## Scalability Considerations

| Concern | At 10 users | At 100 users | At 10K users |
|---------|-------------|--------------|--------------|
| **Relay instances** | 1 Fly.io machine | 1 Fly.io machine | Shard by document hash across N machines |
| **In-memory state** | All rooms in memory | LRU eviction for idle rooms | Redis/Postgres for hot room state |
| **Database writes** | Batch every 5s | Batch every 2s, async | Write-ahead log with background flush |
| **WebSocket connections** | Simple ws library | ws with connection pooling | uWebSockets.js or Cloudflare Durable Objects |
| **Update history size** | Keep all updates | Prune updates older than 7 days | Periodic snapshot + discard old updates |

For Quillium Omni prototype scope (dogfoodable with few users), the 10-user column is sufficient.

## Sources

- [CodeMirror Collaborative Editing Example](https://codemirror.net/examples/collab/) - Official @codemirror/collab documentation
- [CodeMirror collab source](https://github.com/codemirror/collab/blob/main/src/collab.ts) - API reference
- [react-codemirror-collab-sockets](https://github.com/BjornTheProgrammer/react-codemirror-collab-sockets) - WebSocket implementation example
- [How to Design a Real-Time Collaborative Document Editor](https://www.designgurus.io/blog/design-real-time-editor) - System design patterns
- [Collaborative Editing System Development](https://djangostars.com/blog/collaborative-editing-system-development/) - Component architecture
- [Supabase Realtime Documentation](https://supabase.com/docs/guides/realtime/architecture) - Broadcast and presence patterns
- [WebSocket Authentication with JWT](https://websocket.org/guides/security/) - Security patterns
- [Building real-time collaboration: OT vs CRDT](https://www.tiny.cloud/blog/real-time-collaboration-ot-vs-crdt/) - OT vs CRDT comparison
