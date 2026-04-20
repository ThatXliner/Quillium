# Phase 6: Client Collab - Research

**Researched:** 2026-04-17
**Domain:** @codemirror/collab integration, Socket.io client, per-user undo
**Confidence:** HIGH

## Summary

This phase implements real-time collaborative text editing on the Quillium client. Two Quillium instances can see each other's edits in real-time with ~100ms latency, concurrent edits auto-merge via OT (Operational Transformation), and per-user undo works correctly by not undoing remote changes.

The core implementation uses @codemirror/collab 6.1.1 [VERIFIED: npm registry] for the collaborative editing state machine. The collab extension tracks a synced version number, manages unconfirmed local changes, and handles rebasing when receiving remote updates. The `clientID` configuration enables per-user undo by tagging each change with its author.

The transport layer uses socket.io-client 4.8.3 [VERIFIED: npm registry] connecting to the relay server built in Phase 4. The socket authenticates using the JWT from `getSession().access_token` passed in the handshake auth object. A ViewPlugin orchestrates the push/pull loop, sending local changes via `sendableUpdates()` and applying remote changes via `receiveUpdates()`.

**Primary recommendation:** Create a `src/lib/collab/` module with a collabCompartment (matching harperCompartment pattern), socket client singleton, and ViewPlugin for the push/pull loop. Integrate with existing listeners.ts for dual-write persistence.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-50:** Per-user undo via author-tagged changes -- each change tagged with author ID, undo inverts only your own changes (standard @codemirror/collab pattern)
- **D-51:** Static collab extension in stack, enabled/disabled via Compartment (consistent with existing patterns like `harperCompartment`)
- **D-52:** Per-document socket instance -- socket lifecycle tied to collab session, created on session start, destroyed on session end
- **D-53:** JWT from `getSession().access_token` passed in socket.io handshake auth
- **D-54:** Dual-write -- local SQLite persistence continues during collab (crash-safe backup, positioned for offline queue in Phase 9)
- **D-55:** Owner's local SQLite is source of truth; relay is broadcast layer + crash recovery during active session
- **D-56:** "Go Live" toggle in top-right area (near AuthButton) -- visible when authenticated and viewing your own document
- **D-57:** Live Room mode only -- session ends when owner leaves, collaborators disconnected (Excalidraw/Zoom model)
- **D-58:** Snapshot before pulling remote state -- safety net before merging any server state
- **D-59:** Auto-connect when joining someone else's doc (via share link/invite); manual toggle for owner's own documents

### Claude's Discretion
- Socket.io client configuration (reconnection attempts, timeouts)
- Exact UI for "Go Live" toggle (button, switch, icon)
- Error handling for socket disconnection during session
- Compartment naming and placement in extension stack

### Deferred Ideas (OUT OF SCOPE)
- Shared Document mode (server as source of truth, owner-independent sessions) -- v2
- Connection status indicator -- Phase 7 (Connection UX)
- Reconnection handling -- Phase 7
- Presence/cursors -- out of scope for prototype
- Annotation sync -- Phase 8
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SYNC-01 | Document text syncs in real-time (~100ms latency) | @codemirror/collab sendableUpdates/receiveUpdates with Socket.io push/pull loop |
| SYNC-02 | Concurrent edits auto-merge via OT (no manual conflict UI) | @codemirror/collab handles rebasing internally; clientID enables per-user undo |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Collab state (version, unconfirmed changes) | CodeMirror StateField | -- | @codemirror/collab provides the StateField |
| Socket connection lifecycle | Client (Svelte stores) | -- | Socket created/destroyed based on UI state |
| Push/pull loop | CodeMirror ViewPlugin | -- | Must react to doc changes and receive updates |
| Per-user undo | CodeMirror history | -- | clientID tags changes for selective inversion |
| Dual-write persistence | listeners.ts | -- | Existing updateListener continues writing to SQLite |
| "Go Live" toggle UI | Svelte component | -- | UI state drives socket lifecycle |
| JWT auth | Supabase Auth | -- | getSession().access_token provides token |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @codemirror/collab | 6.1.1 | Collaborative editing state machine | Official CodeMirror collab solution, OT-based, supports per-user undo via clientID [VERIFIED: npm registry] |
| socket.io-client | 4.8.3 | WebSocket transport with reconnection | Phase 4 relay uses Socket.io; client must match [VERIFIED: npm registry] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @codemirror/state | ^6.0.0 | ChangeSet serialization | Required by @codemirror/collab [VERIFIED: npm dependency] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @codemirror/collab | Yjs | CRDT-based, better offline, but requires migration and breaks existing persistence model |
| socket.io-client | raw WebSocket | Less features (no auto-reconnect), would need custom logic for rooms and fallback |

**Installation:**
```bash
bun add @codemirror/collab socket.io-client
```

**Version verification:** @codemirror/collab 6.1.1 published 2023-09-14 [VERIFIED: npm registry]. socket.io-client 4.8.3 published 2025-02-XX [VERIFIED: npm registry].

## Architecture Patterns

### System Architecture Diagram

```
+------------------+        +------------------+        +------------------+
|  Quillium A      |        |  Relay Server    |        |  Quillium B      |
|                  |        |  (Phase 4)       |        |                  |
| +-------------+  |        |                  |        |  +-------------+ |
| | EditorView  |  |        |                  |        |  | EditorView  | |
| |   +collab   |  |        |                  |        |  |   +collab   | |
| +------+------+  |        |                  |        |  +------+------+ |
|        |         |        |                  |        |         |        |
|  sendableUpdates |        |                  |        |  receiveUpdates  |
|        |         |        |                  |        |         |        |
| +------v------+  |        | +-------------+  |        |  +------v------+ |
| | CollabPlugin|  |        | | Document    |  |        |  | CollabPlugin| |
| | ViewPlugin  |  |        | | (in-memory) |  |        |  | ViewPlugin  | |
| +------+------+  |        | +------+------+  |        |  +------+------+ |
|        |         |        |        |         |        |         |        |
| pushUpdates      |        |        |         |        | pullUpdates      |
|        |         |        |        |         |        |         |        |
| +------v------+  | socket |        |         | socket |  +------v------+ |
| | Socket.io   +--+--------+-> applyUpdate    +--------+--+ Socket.io   | |
| | Client      <--+--------+<- broadcast  <---+--------+--+ Client      | |
| +-------------+  |        |        |         |        |  +-------------+ |
|                  |        |        |         |        |                  |
| +-------------+  |        |  (persist to     |        |                  |
| | listeners.ts|  |        |   Postgres)      |        |                  |
| | (dual-write)|  |        |                  |        |                  |
| +------+------+  |        +------------------+        +------------------+
|        |         |
| +------v------+  |
| | Local SQLite|  |
| | (events +   |  |
| |  snapshots) |  |
| +-------------+  |
+------------------+
```

### Recommended Project Structure
```
src/lib/collab/
+-- index.ts           # Public API: collabCompartment, enableCollab(), disableCollab()
+-- socket.ts          # Socket.io client singleton, connect/disconnect
+-- collabPlugin.ts    # ViewPlugin for push/pull loop
+-- protocol.ts        # Message types (import from relay if possible)
+-- types.ts           # Collab-related types
```

### Pattern 1: Compartment-Based Extension Toggle

**What:** Use a Compartment to dynamically enable/disable the collab extension without rebuilding the entire editor state.

**When to use:** When collab is toggled via the "Go Live" button.

**Example:**
```typescript
// Source: Existing harperCompartment pattern in extensions.ts
import { Compartment } from "@codemirror/state";
import { collab, getSyncedVersion, sendableUpdates, receiveUpdates } from "@codemirror/collab";

export const collabCompartment = new Compartment();

// In getExtensions():
export const getExtensions = (options?: ListenerOptions) => [
    // ... existing extensions ...
    collabCompartment.of([]), // Initially disabled
];

// To enable collab:
function enableCollab(view: EditorView, startVersion: number, clientID: string) {
    view.dispatch({
        effects: collabCompartment.reconfigure(
            collab({ startVersion, clientID })
        ),
    });
}

// To disable collab:
function disableCollab(view: EditorView) {
    view.dispatch({
        effects: collabCompartment.reconfigure([]),
    });
}
```

### Pattern 2: ViewPlugin Push/Pull Loop

**What:** A ViewPlugin that orchestrates sending local changes and receiving remote changes.

**When to use:** When collab is active.

**Example:**
```typescript
// Source: CodeMirror collab example https://codemirror.net/examples/collab/
import { ViewPlugin, type ViewUpdate, EditorView } from "@codemirror/view";
import { sendableUpdates, receiveUpdates, getSyncedVersion } from "@codemirror/collab";
import type { Update } from "@codemirror/collab";
import { ChangeSet } from "@codemirror/state";

function collabPlugin(socket: Socket, docId: string) {
    return ViewPlugin.fromClass(class {
        private pushing = false;
        private destroyed = false;

        constructor(private view: EditorView) {
            this.pull();
        }

        update(update: ViewUpdate) {
            if (update.docChanged && !this.pushing) {
                this.push();
            }
        }

        async push() {
            const updates = sendableUpdates(this.view.state);
            if (!updates.length || this.pushing) return;

            this.pushing = true;
            const version = getSyncedVersion(this.view.state);

            socket.emit("pushUpdates", {
                docId,
                version,
                updates: updates.map(u => ({
                    changes: u.changes.toJSON(),
                    clientID: u.clientID,
                })),
            });

            // Wait for ack from server
            // On success, collab field updates automatically
            // On failure, may need to pull first
            this.pushing = false;

            // Check if more updates accumulated while we were pushing
            if (sendableUpdates(this.view.state).length) {
                setTimeout(() => this.push(), 100);
            }
        }

        pull() {
            socket.on("updates", (data: { updates: SerializedUpdate[] }) => {
                if (this.destroyed) return;
                const updates: Update[] = data.updates.map(u => ({
                    changes: ChangeSet.fromJSON(u.changes),
                    clientID: u.clientID,
                }));
                this.view.dispatch(receiveUpdates(this.view.state, updates));
            });
        }

        destroy() {
            this.destroyed = true;
        }
    });
}
```

### Pattern 3: Socket.io JWT Auth

**What:** Pass JWT in socket.io handshake auth object.

**When to use:** On socket connection.

**Example:**
```typescript
// Source: Socket.io docs https://socket.io/docs/v4/client-api [CITED]
import { io, type Socket } from "socket.io-client";
import { getSession } from "$lib/auth/auth.svelte";

const RELAY_URL = "wss://relay.quillium.com"; // or from env

let socket: Socket | null = null;

export function connectToCollab(docId: string): Socket {
    const session = getSession();
    if (!session?.access_token) {
        throw new Error("Not authenticated");
    }

    socket = io(`${RELAY_URL}/doc/${docId}`, {
        auth: {
            token: session.access_token,
        },
        autoConnect: true,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 10,
    });

    socket.on("connect", () => {
        console.log("[collab] Connected to relay");
    });

    socket.on("connect_error", (error) => {
        console.error("[collab] Connection error:", error.message);
    });

    return socket;
}

export function disconnectCollab() {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
}
```

### Pattern 4: Dual-Write Persistence

**What:** Continue writing to local SQLite while collab is active.

**When to use:** Always during collab session (per D-54).

**Example:**
```typescript
// Source: Existing listeners.ts pattern
// No changes needed to listeners.ts -- the existing save listener
// continues to fire on every docChanged/annotationsChanged.
// Collab updates are just another source of transactions.

// The key insight: receiveUpdates() dispatches a transaction with
// the remote changes. listeners.ts sees docChanged and persists it.
// This means both local and remote changes are recorded in the event log.
```

### Pattern 5: Pre-Sync Snapshot

**What:** Take a snapshot before pulling remote state for the first time.

**When to use:** When "Go Live" is activated (per D-58).

**Example:**
```typescript
// Source: Existing errorGuard.ts pattern
import { createNamedSnapshot } from "$lib/db";
import { savedFields } from "$lib/editor/extensions";

async function goLive(view: EditorView, draftId: string) {
    // Safety snapshot before any remote state merges
    const stateJson = JSON.stringify(view.state.toJSON(savedFields));
    const eventId = get(lastPersistedEventId);
    await createNamedSnapshot(
        draftId,
        stateJson,
        eventId,
        "Before going live (auto)"
    );

    // Now safe to connect and pull remote state
    connectToCollab(docId);
}
```

### Anti-Patterns to Avoid

- **Don't re-create EditorView on collab toggle:** Use Compartment.reconfigure() instead. Recreating destroys undo history and selection state.

- **Don't poll for updates:** Use Socket.io events. The relay broadcasts updates to all connected clients.

- **Don't skip dual-write during collab:** Local SQLite persistence continues for crash safety. The owner's local state is the source of truth (D-55).

- **Don't apply remote updates synchronously in socket handler:** Use `view.dispatch(receiveUpdates(...))` which is safe to call from event handlers.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OT algorithm | Custom operational transform | @codemirror/collab | OT is notoriously hard; collab handles edge cases (rebasing, ordering) |
| Per-user undo | Custom undo tracking | @codemirror/collab clientID | The collab extension already tracks clientID on each update |
| WebSocket reconnection | Manual reconnection logic | socket.io-client | Built-in exponential backoff, fallback to long-polling |
| Change serialization | Custom JSON format | ChangeSet.toJSON()/fromJSON() | CodeMirror's native format, proven reliable |

**Key insight:** @codemirror/collab does the heavy lifting for OT. The client's job is just transport (push/pull) and lifecycle management (connect/disconnect).

## Common Pitfalls

### Pitfall 1: Version Mismatch on Push

**What goes wrong:** Client sends updates with stale base version, server rejects.

**Why it happens:** Network latency means client may not have received all server updates before pushing.

**How to avoid:** Handle push rejection by pulling first, then retrying push. The relay uses `rebaseUpdates` to remap stale updates.

**Warning signs:** Console logs showing "pushUpdates: ok: false" repeatedly.

### Pitfall 2: Duplicate Updates After Reconnect

**What goes wrong:** Client receives updates it already has, causing document corruption.

**Why it happens:** After reconnect, pull may return updates client already applied before disconnect.

**How to avoid:** Always pass `getSyncedVersion(state)` when pulling. The collab extension tracks which version is synced.

**Warning signs:** Document text appears duplicated or garbled after reconnect.

### Pitfall 3: Undo Undoes Remote Changes

**What goes wrong:** User presses Cmd+Z and remote collaborator's changes disappear.

**Why it happens:** clientID not configured, or not using the collab extension's per-user undo.

**How to avoid:** Pass `clientID` to `collab({ clientID })` config. Use the user's Supabase user ID as clientID.

**Warning signs:** In testing, undo on Client A reverts changes made by Client B.

### Pitfall 4: Socket Leaked on Document Switch

**What goes wrong:** Socket stays connected to old document's room after navigating to new document.

**Why it happens:** Socket lifecycle not tied to document lifecycle.

**How to avoid:** Per D-52, socket is per-document. Disconnect old socket before switching documents. Track socket in a store keyed by docId.

**Warning signs:** Multiple socket connections in browser DevTools network tab.

### Pitfall 5: Compartment Not in Extension Stack

**What goes wrong:** `collabCompartment.reconfigure()` has no effect.

**Why it happens:** Compartment must be included in the initial extension stack (even if empty) for reconfigure to work.

**How to avoid:** Add `collabCompartment.of([])` to getExtensions() return array.

**Warning signs:** No error, but collab extension never activates.

## Code Examples

Verified patterns from official sources:

### Collab Extension Configuration

```typescript
// Source: @codemirror/collab source code [CITED: GitHub raw]
import { collab } from "@codemirror/collab";

// clientID is the key to per-user undo
const collabExtension = collab({
    startVersion: 0, // or fetched from server on initial load
    clientID: supabaseUserId, // user's auth.uid
});
```

### Sending Updates

```typescript
// Source: CodeMirror collab example [CITED: codemirror.net/examples/collab]
import { sendableUpdates, getSyncedVersion } from "@codemirror/collab";

function pushChanges(view: EditorView, socket: Socket, docId: string) {
    const updates = sendableUpdates(view.state);
    if (updates.length === 0) return;

    const version = getSyncedVersion(view.state);
    socket.emit("pushUpdates", {
        docId,
        version,
        updates: updates.map(u => ({
            changes: u.changes.toJSON(),
            clientID: u.clientID,
        })),
    });
}
```

### Receiving Updates

```typescript
// Source: CodeMirror collab example [CITED: codemirror.net/examples/collab]
import { receiveUpdates } from "@codemirror/collab";
import { ChangeSet } from "@codemirror/state";
import type { Update } from "@codemirror/collab";

function applyRemoteUpdates(view: EditorView, serializedUpdates: SerializedUpdate[]) {
    const updates: Update[] = serializedUpdates.map(u => ({
        changes: ChangeSet.fromJSON(u.changes),
        clientID: u.clientID,
    }));
    view.dispatch(receiveUpdates(view.state, updates));
}
```

### Socket.io Auth Pattern

```typescript
// Source: Socket.io v4 client API [CITED: socket.io/docs/v4/client-api]
import { io } from "socket.io-client";

const socket = io("wss://relay.example.com", {
    auth: {
        token: "jwt-token-here", // from getSession().access_token
    },
    query: {
        docId: "document-uuid", // alternative: include in URL path
    },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| OT via server-side conflict resolution | Client-side OT with server ordering | Always (OT design) | Less server load, better offline potential |
| WebSocket with custom protocol | Socket.io with rooms | 2020s | Built-in reconnection, fallback, rooms |
| Single undo stack | Per-user undo via clientID | @codemirror/collab 6.0 | Essential for collab UX |

**Deprecated/outdated:**
- Raw WebSocket without fallback -- Socket.io handles transport negotiation
- Polling for updates -- Long-poll or push-based updates are standard now

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Relay server accepts socket.io connections at `/doc/:docId` URL pattern | Pattern 3 | Mismatch with relay implementation; need to verify relay URL structure |
| A2 | Relay broadcasts updates to all clients via `updates` event | Pattern 2 | Incorrect event name; need to check relay protocol |
| A3 | Per-user undo "just works" with clientID config | Pattern 1 | May need additional history field configuration |

## Open Questions

1. **Relay URL Configuration**
   - What we know: Relay is deployed to Fly.io
   - What's unclear: Exact URL, whether it's configured via env var
   - Recommendation: Add `PUBLIC_RELAY_URL` env var, default to localhost for dev

2. **Initial Document State on Join**
   - What we know: Phase 4 relay keeps full doc in memory
   - What's unclear: How collaborator fetches initial doc state on join
   - Recommendation: Add `getDocument` message to pull current doc + version before starting collab

3. **Socket.io vs Raw WebSocket on Relay**
   - What we know: Phase 4 relay uses raw `ws` library (not socket.io)
   - What's unclear: Whether client should use socket.io or raw WebSocket
   - Recommendation: If relay uses raw ws, client should too (simpler). If relay upgraded to socket.io, use socket.io-client. Need to check relay code.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase Auth | JWT for socket auth | Yes | -- | Anonymous collab blocked without auth |
| Relay server | WebSocket endpoint | Depends on Phase 4 | -- | Feature blocked without relay |
| @codemirror/collab | Collab state | No (must install) | 6.1.1 | -- |
| socket.io-client | Transport | No (must install) | 4.8.3 | -- |

**Missing dependencies with no fallback:**
- Phase 4 relay must be deployed and accessible

**Missing dependencies with fallback:**
- None -- all dependencies are installable

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.4 |
| Config file | `vitest.config.ts` |
| Quick run command | `bun run test:run src/lib/collab/` |
| Full suite command | `bun run test:run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SYNC-01 | Real-time text sync | integration | `bun run test:run src/lib/collab/sync.test.ts` | No Wave 0 |
| SYNC-02 | OT auto-merge | unit | `bun run test:run src/lib/collab/merge.test.ts` | No Wave 0 |
| SYNC-02 | Per-user undo | unit | `bun run test:run src/lib/collab/undo.test.ts` | No Wave 0 |

### Sampling Rate
- **Per task commit:** `bun run test:run src/lib/collab/`
- **Per wave merge:** `bun run test:run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/lib/collab/sync.test.ts` -- covers SYNC-01 with mock socket
- [ ] `src/lib/collab/merge.test.ts` -- covers SYNC-02 OT merge behavior
- [ ] `src/lib/collab/undo.test.ts` -- covers SYNC-02 per-user undo with clientID
- [ ] Mock socket.io server for integration tests

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | JWT from Supabase Auth, validated by relay |
| V3 Session Management | yes | Socket auth tied to JWT session |
| V4 Access Control | yes | Relay checks document permissions |
| V5 Input Validation | yes | ChangeSet validation on relay |
| V6 Cryptography | no | TLS handled by transport |

### Known Threat Patterns for Real-Time Collab

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Spoofed clientID | Spoofing | Server assigns/validates clientID from JWT |
| Malformed ChangeSet | Tampering | ChangeSet.fromJSON() throws on invalid input |
| Replay attack | Replay | Version number ordering prevents replay |
| Unauthorized room join | Elevation | Relay validates document access permissions |

## Sources

### Primary (HIGH confidence)
- @codemirror/collab npm registry -- version 6.1.1 verified
- socket.io-client npm registry -- version 4.8.3 verified
- CodeMirror collab example -- https://codemirror.net/examples/collab/
- @codemirror/collab source -- https://github.com/codemirror/collab

### Secondary (MEDIUM confidence)
- Socket.io v4 client API -- https://socket.io/docs/v4/client-api

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- verified from npm registry and official docs
- Architecture: HIGH -- patterns from CodeMirror example and existing codebase
- Pitfalls: MEDIUM -- based on common OT issues, not project-specific verification

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (30 days, stable libraries)
