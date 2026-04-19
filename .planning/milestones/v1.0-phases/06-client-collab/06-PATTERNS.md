# Phase 6: Client Collab - Pattern Map

**Mapped:** 2026-04-17
**Files analyzed:** 7 new files
**Analogs found:** 7 / 7

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/collab/index.ts` | module-entry | request-response | `src/lib/editor/plugins/annotations/index.ts` | role-match |
| `src/lib/collab/socket.ts` | service | event-driven | `src/lib/auth/supabase.ts` | exact |
| `src/lib/collab/collabPlugin.ts` | viewplugin | event-driven | `src/lib/editor/harper/harperLinter.ts` (scrollLintPlugin) | exact |
| `src/lib/collab/protocol.ts` | types | -- | `.worktrees/sync-service-draft-1/relay/src/protocol.ts` | exact |
| `src/lib/collab/types.ts` | types | -- | `src/lib/db/types.ts` | role-match |
| `src/lib/editor/extensions.ts` | config | -- | `src/lib/editor/extensions.ts` (harperCompartment) | exact |
| `src/routes/+page.svelte` or `src/lib/collab/GoLiveButton.svelte` | component | request-response | `src/lib/auth/AuthButton.svelte` | exact |

## Pattern Assignments

### `src/lib/collab/index.ts` (module-entry, request-response)

**Analog:** `src/lib/editor/plugins/annotations/index.ts`

**Purpose:** Public API surface for the collab module. Re-exports from submodules, provides high-level functions (`enableCollab`, `disableCollab`), exports the `collabCompartment`.

**Imports pattern** (lines 1-50):
```typescript
// index.ts — Collab module entry point.
//
// Re-exports the public API for collaborative editing:
//   - collabCompartment: Compartment for hot-swapping collab extension
//   - enableCollab(): activate collab with socket + version
//   - disableCollab(): deactivate collab, disconnect socket
//
// Key dependencies:
//   - @codemirror/state (Compartment)
//   - @codemirror/collab (collab, getSyncedVersion)
//   - ./socket (connectToCollab, disconnectCollab)
//   - ./collabPlugin (collabPushPull)

import { Compartment } from "@codemirror/state";
import { collab } from "@codemirror/collab";
import type { EditorView } from "@codemirror/view";
import { connectToCollab, disconnectCollab } from "./socket";
import { collabPushPull } from "./collabPlugin";

export { collabCompartment } from "./collabPlugin";
export * from "./types";
```

**Core pattern** (enableCollab/disableCollab functions):
```typescript
// Pattern: Compartment.reconfigure() for hot-swapping extension
export function enableCollab(view: EditorView, startVersion: number, clientID: string) {
    const socket = connectToCollab(/* docId, token */);
    view.dispatch({
        effects: collabCompartment.reconfigure([
            collab({ startVersion, clientID }),
            collabPushPull(socket),
        ]),
    });
}

export function disableCollab(view: EditorView) {
    disconnectCollab();
    view.dispatch({
        effects: collabCompartment.reconfigure([]),
    });
}
```

---

### `src/lib/collab/socket.ts` (service, event-driven)

**Analog:** `src/lib/auth/supabase.ts`

**Purpose:** WebSocket client singleton with lifecycle management. Matches the supabase.ts pattern of a module-level singleton with configuration check and export of configured state.

**Imports pattern** (lines 1-14):
```typescript
/**
 * socket.ts — WebSocket client for collab relay.
 *
 * Module-level singleton. Created on demand when collab is enabled,
 * destroyed when collab is disabled. Uses raw WebSocket (relay uses ws,
 * not socket.io).
 */
import { getSession } from "$lib/auth/auth.svelte";
import { PUBLIC_RELAY_URL } from "$env/static/public";

const RELAY_URL = PUBLIC_RELAY_URL;

export const relayConfigured = !!RELAY_URL;
```

**Core pattern** (singleton lifecycle):
```typescript
// Pattern from supabase.ts: module-level singleton with null check
let socket: WebSocket | null = null;

export function connectToCollab(docId: string): WebSocket {
    if (socket) {
        console.warn("[collab] Socket already connected");
        return socket;
    }

    const session = getSession();
    if (!session?.access_token) {
        throw new Error("Not authenticated");
    }

    // Pass token as query param (relay expects ?token=...)
    socket = new WebSocket(`${RELAY_URL}/doc/${docId}?token=${session.access_token}`);

    socket.onopen = () => {
        console.log("[collab] Connected to relay");
    };

    socket.onerror = (error) => {
        console.error("[collab] Socket error:", error);
    };

    socket.onclose = () => {
        console.log("[collab] Disconnected from relay");
        socket = null;
    };

    return socket;
}

export function disconnectCollab(): void {
    if (socket) {
        socket.close();
        socket = null;
    }
}

export function getSocket(): WebSocket | null {
    return socket;
}
```

**Error handling pattern** (from supabase.ts lines 18-20):
```typescript
if (!relayConfigured) {
    console.warn("[collab] Missing PUBLIC_RELAY_URL — collab features will not work");
}
```

---

### `src/lib/collab/collabPlugin.ts` (viewplugin, event-driven)

**Analog:** `src/lib/editor/harper/harperLinter.ts` (scrollLintPlugin, lines 287-303)

**Purpose:** ViewPlugin that orchestrates push/pull loop with the relay. Reacts to doc changes (push local updates) and socket messages (receive remote updates).

**Imports pattern:**
```typescript
/**
 * collabPlugin.ts — ViewPlugin for collab push/pull loop.
 *
 * Sends local changes via sendableUpdates() on docChanged.
 * Receives remote changes via socket message events.
 * Applies remote changes via receiveUpdates().
 */
import { ViewPlugin, type ViewUpdate, EditorView } from "@codemirror/view";
import { Compartment } from "@codemirror/state";
import {
    collab,
    sendableUpdates,
    receiveUpdates,
    getSyncedVersion,
    type Update,
} from "@codemirror/collab";
import { ChangeSet } from "@codemirror/state";
import { encode, decode, type ServerMessage, type SerializedUpdate } from "./protocol";
```

**Compartment pattern** (from extensions.ts line 83):
```typescript
// Pattern: export Compartment at module level, initially empty
export const collabCompartment = new Compartment();
```

**ViewPlugin pattern** (from harperLinter.ts lines 287-303):
```typescript
// Pattern: ViewPlugin.fromClass with update() method and destroy() cleanup
export function collabPushPull(socket: WebSocket) {
    return ViewPlugin.fromClass(
        class {
            private pushing = false;

            constructor(private view: EditorView) {
                // Set up socket message handler for pulls
                socket.onmessage = (event) => {
                    this.handleMessage(event.data);
                };
            }

            update(update: ViewUpdate) {
                if (update.docChanged && !this.pushing) {
                    this.push();
                }
            }

            private push() {
                const updates = sendableUpdates(this.view.state);
                if (!updates.length || this.pushing) return;

                this.pushing = true;
                const version = getSyncedVersion(this.view.state);

                socket.send(encode({
                    type: "pushUpdates",
                    version,
                    updates: updates.map((u) => ({
                        changes: u.changes.toJSON(),
                        clientID: u.clientID,
                    })),
                }));
            }

            private handleMessage(raw: string) {
                const msg = decode(raw) as ServerMessage;
                if (msg.type === "pullUpdates") {
                    const updates: Update[] = msg.updates.map((u) => ({
                        changes: ChangeSet.fromJSON(u.changes),
                        clientID: u.clientID,
                    }));
                    this.view.dispatch(receiveUpdates(this.view.state, updates));
                } else if (msg.type === "pushUpdates") {
                    this.pushing = false;
                    if (!msg.ok) {
                        // Stale base version — pull first, then retry
                        socket.send(encode({
                            type: "pullUpdates",
                            version: getSyncedVersion(this.view.state),
                        }));
                    }
                    // Check for more accumulated updates
                    if (sendableUpdates(this.view.state).length) {
                        setTimeout(() => this.push(), 100);
                    }
                }
            }

            destroy() {
                // Socket lifecycle managed by socket.ts, not here
            }
        }
    );
}
```

---

### `src/lib/collab/protocol.ts` (types, --)

**Analog:** `.worktrees/sync-service-draft-1/relay/src/protocol.ts`

**Purpose:** Message types matching the relay protocol. Can be copied verbatim or imported from a shared location.

**Full file pattern** (relay/src/protocol.ts lines 1-33):
```typescript
/**
 * protocol.ts — WebSocket message types and JSON encoding.
 *
 * Client -> Server messages:
 *   - pullUpdates: "give me all updates since version N"
 *   - pushUpdates: "here are my local changes, base version N"
 *
 * Server -> Client messages:
 *   - pullUpdates: response with array of updates
 *   - pushUpdates: ack (ok: true) or reject (ok: false)
 */

/** A serialized collab update (matches @codemirror/collab wire format). */
export type SerializedUpdate = {
    changes: unknown;
    clientID: string;
};

export type ClientMessage =
    | { type: "pullUpdates"; version: number }
    | { type: "pushUpdates"; version: number; updates: SerializedUpdate[] };

export type ServerMessage =
    | { type: "pullUpdates"; updates: SerializedUpdate[] }
    | { type: "pushUpdates"; ok: boolean };

export function encode(msg: ClientMessage | ServerMessage): string {
    return JSON.stringify(msg);
}

export function decode(raw: string): ClientMessage | ServerMessage {
    return JSON.parse(raw);
}
```

---

### `src/lib/collab/types.ts` (types, --)

**Analog:** `src/lib/db/types.ts`

**Purpose:** Collab-specific type definitions.

**Types pattern:**
```typescript
/**
 * types.ts — Collab-related types.
 */

export type CollabSession = {
    docId: string;
    version: number;
    clientID: string;
    isOwner: boolean;
};

export type CollabState = "disconnected" | "connecting" | "connected" | "error";
```

---

### `src/lib/editor/extensions.ts` (config, modification)

**Analog:** Self (harperCompartment pattern, line 83)

**Purpose:** Add `collabCompartment.of([])` to the extension stack so it can be reconfigured at runtime.

**Compartment declaration pattern** (line 83):
```typescript
export const harperCompartment = new Compartment();
```

**Add to getExtensions():**
```typescript
// Import at top of file
import { collabCompartment } from "$lib/collab";

// In getExtensions() return array, add:
export const getExtensions = (options?: ListenerOptions) => {
    const withHistory = options?.history !== false;
    return [
        // ... existing extensions ...
        collabCompartment.of([]), // Initially disabled, reconfigured on "Go Live"
    ];
};
```

---

### `src/lib/collab/GoLiveButton.svelte` or inline in `+page.svelte` (component, request-response)

**Analog:** `src/lib/auth/AuthButton.svelte`

**Purpose:** "Go Live" toggle button in top-right area (per D-56). Shows when authenticated and viewing own document.

**Component structure pattern** (AuthButton.svelte):
```svelte
<!--
    GoLiveButton.svelte — Top-right collab toggle.

    Per D-56: "Go Live" toggle in top-right area (near AuthButton).
    Per D-57: Live Room mode only — session ends when owner leaves.
    Per D-58: Snapshot before pulling remote state.

    Props:
      - docId: string — current document ID
      - isOwner: boolean — true if current user owns the document
-->
<script lang="ts">
import { isAuthenticated } from "$lib/auth/auth.svelte";
import { editorView, currentDraftId, lastPersistedEventId } from "$lib/stores";
import { createNamedSnapshot } from "$lib/db";
import { savedFields } from "$lib/editor/extensions";
import { enableCollab, disableCollab, relayConfigured } from "$lib/collab";
import { get } from "svelte/store";
import { toast } from "svelte-sonner";

const { docId, isOwner }: { docId: string; isOwner: boolean } = $props();

let isLive = $state(false);
let connecting = $state(false);

const authenticated = $derived(isAuthenticated());
const canGoLive = $derived(authenticated && isOwner && relayConfigured);

async function handleToggle() {
    if (isLive) {
        // Go offline
        const view = get(editorView);
        if (view) disableCollab(view);
        isLive = false;
        toast.success("Session ended");
    } else {
        // Go live — snapshot first (D-58)
        connecting = true;
        try {
            const view = get(editorView);
            const draftId = get(currentDraftId);
            const eventId = get(lastPersistedEventId);
            if (view && draftId) {
                const stateJson = JSON.stringify(view.state.toJSON(savedFields));
                await createNamedSnapshot(draftId, stateJson, eventId, "Before going live (auto)");
                // TODO: fetch initial state from relay, get startVersion
                // enableCollab(view, startVersion, userId);
                isLive = true;
                toast.success("You're live!");
            }
        } catch (err) {
            console.error("[collab] Failed to go live:", err);
            toast.error("Failed to go live");
        } finally {
            connecting = false;
        }
    }
}
</script>

{#if canGoLive}
    <button
        onclick={handleToggle}
        disabled={connecting}
        class="px-4 py-2 text-xs font-medium rounded-full shadow-md transition-colors
            {isLive
                ? 'bg-green-500 text-white hover:bg-green-600'
                : 'text-black/50 bg-white/50 backdrop-blur-md hover:text-black/70 hover:bg-white/60'}"
    >
        {#if connecting}
            Connecting...
        {:else if isLive}
            Live
        {:else}
            Go Live
        {/if}
    </button>
{/if}
```

**Placement pattern** (from +page.svelte lines 488-491):
```svelte
<!-- Auth button — top-right per D-10 -->
<div class="fixed top-8 right-8 z-40">
    <AuthButton onauthclick={() => (authModalOpen = true)} />
</div>
```

**Modified to include GoLiveButton:**
```svelte
<!-- Top-right cluster: Go Live + Auth -->
<div class="fixed top-8 right-8 z-40 flex items-center gap-3">
    <GoLiveButton docId={currentDocId} isOwner={true} />
    <AuthButton onauthclick={() => (authModalOpen = true)} />
</div>
```

---

## Shared Patterns

### Authentication (JWT Retrieval)
**Source:** `src/lib/auth/auth.svelte.ts` (lines 102-108)
**Apply to:** `socket.ts` for relay authentication

```typescript
// Reactive getters
export function getUser() {
    return user;
}
export function getSession() {
    return session;
}
```

### Pre-Sync Snapshot
**Source:** `src/lib/errorGuard.ts` (lines 240-255)
**Apply to:** `GoLiveButton.svelte` before connecting (D-58)

```typescript
export function saveEmergencySnapshot(label: string): void {
    const view = get(editorView);
    const draftId = get(currentDraftId);
    const eventId = get(lastPersistedEventId);
    if (!view || !draftId) return;

    try {
        const stateJson = JSON.stringify(view.state.toJSON(savedFields));
        createNamedSnapshot(draftId, stateJson, eventId, label).catch((e) => {
            console.error(e);
            posthog.captureException(e instanceof Error ? e : new Error(String(e)));
        });
    } catch {
        // Best-effort
    }
}
```

### Error Handling
**Source:** `src/lib/editor/listeners.ts` (lines 374-382)
**Apply to:** Socket error handling in `socket.ts`

```typescript
} catch (e) {
    console.error("[listeners] appendEvent failed:", e);
    posthog.captureException(e instanceof Error ? e : new Error(String(e)));
    // ... update status store ...
}
```

### Module Logging
**Source:** Convention from CLAUDE.md
**Apply to:** All collab module files

```typescript
// Errors: include module prefix in brackets
console.error("[collab] Connection error:", error);
console.warn("[collab] Socket already connected");
console.log("[collab] Connected to relay");
```

---

## Test Pattern

### Unit Test Structure
**Source:** `src/lib/editor/plugins/annotations/annotationField.test.ts` (lines 1-50)
**Apply to:** `src/lib/collab/*.test.ts`

```typescript
/**
 * collabPlugin.test.ts — Unit tests for collab ViewPlugin.
 *
 * Tests push/pull loop, version handling, and error recovery.
 * Uses mock WebSocket for isolation.
 */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { collab, getSyncedVersion, sendableUpdates } from "@codemirror/collab";
import { collabCompartment, collabPushPull } from "./collabPlugin";

// Mock WebSocket
class MockWebSocket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((error: unknown) => void) | null = null;
    sent: string[] = [];

    send(data: string) {
        this.sent.push(data);
    }

    close() {
        this.onclose?.();
    }

    simulateMessage(data: string) {
        this.onmessage?.({ data });
    }
}

describe("collabPushPull", () => {
    it("sends pushUpdates on doc change", () => {
        // ... test implementation
    });
});
```

---

## No Analog Found

All files have close analogs in the codebase.

---

## Metadata

**Analog search scope:**
- `src/lib/` (main library code)
- `src/routes/` (page components)
- `.worktrees/sync-service-draft-1/relay/src/` (relay protocol)

**Files scanned:** ~50 TypeScript and Svelte files
**Pattern extraction date:** 2026-04-17
