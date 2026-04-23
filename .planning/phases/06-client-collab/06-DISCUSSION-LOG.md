# Phase 6: Client Collab - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-17
**Phase:** 06-client-collab
**Areas discussed:** Collab extension integration, Socket.io client setup, Local persistence coexistence, Collab activation trigger

---

## Collab Extension Integration

| Option | Description | Selected |
|--------|-------------|----------|
| Inverting with author filtering | Tag each change with author, invert only your own changes on undo | ✓ |
| Separate history stacks | Each client maintains its own history stack | |
| Accept global undo | Simpler but violates SYNC-02 requirement | |

**User's choice:** Inverting with author filtering (A)

| Option | Description | Selected |
|--------|-------------|----------|
| Static (compartment) | Collab extension always in stack, enabled/disabled via Compartment | ✓ |
| Dynamic injection | Add/remove collab extension when connecting/disconnecting | |

**User's choice:** Static with compartment — "as with everything else"

---

## Socket.io Client Setup

| Option | Description | Selected |
|--------|-------------|----------|
| Singleton module | Single socket client for app lifetime | |
| Per-document instance | Socket created/destroyed with each collab session | ✓ |
| Store-based | Socket state in Svelte store | |

**User's choice:** Per-document instance (B)

| Option | Description | Selected |
|--------|-------------|----------|
| Connect on doc open | Socket connects when opening synced doc | |
| Long-lived connection | Single connection, join/leave rooms | |
| Connect on explicit action | User clicks "Go live" or similar | ✓ (for owner) |

**User's choice:** Auto-connect when joining someone else's doc; manual toggle for owner's own documents.

**Notes:** User clarified this is real-time collab (Omni), not background sync — that's deferred to v2.

---

## Local Persistence Coexistence

| Option | Description | Selected |
|--------|-------------|----------|
| Dual-write | Continue local persistence AND send to relay | ✓ |
| Relay-only during collab | Disable local persistence while connected | |
| Persist confirmed updates | Only persist after relay confirms | |

**User's choice:** Dual-write (A)

**Notes:** User confirmed write-through persistence stays (D-40). Owner's local SQLite is source of truth for document content; relay is source of truth for OT ordering during active session.

---

## Collab Activation Trigger

| Option | Description | Selected |
|--------|-------------|----------|
| Editor toolbar/header | "Go Live" button near title | |
| Menu action | File menu or right-click | |
| Top-right area | Near AuthButton (existing UI cluster) | ✓ |

**User's choice:** Top-right area — user noted this is where it should be (near AuthButton per D-10).

| Option | Description | Selected |
|--------|-------------|----------|
| Google Docs style (B) | Session persists, owner can disconnect | |
| Excalidraw/Zoom style (A) | Owner leaves = session ends for everyone | ✓ |
| Owner choice | "End for everyone" vs "Leave session" | |

**User's choice:** Excalidraw/Zoom style (A) — session ends when owner leaves.

**Notes:** User proposed a two-mode system for future:
1. "Shared Document" — server is source of truth, owner-independent (Google Docs)
2. "Live Room" — owner's local is source of truth, session ends with owner (Excalidraw)

For v1 prototype, implementing Live Room only. Shared Document deferred to v2.

User noted: "Shared Document mode is functionally the same if the owner left their computer on 24/7" — confirmed.

---

## Claude's Discretion

- Socket.io client configuration
- Exact UI for "Go Live" toggle
- Error handling for socket disconnection
- Compartment naming and placement

## Deferred Ideas

- Shared Document mode (server as source of truth) — v2
- Connection status indicator — Phase 7
- Reconnection handling — Phase 7
- Presence/cursors — out of scope
- Annotation sync — Phase 8

---

## Clarification: OT and Server Authority

User asked: "doesn't CodeMirror use OT (meaning we NEED a server to reconcile changes?)"

**Answer:** Yes — @codemirror/collab uses OT which requires central authority (relay server) to assign version numbers and order changes via `rebaseUpdates()`. "Owner's local is source of truth" means:
1. Owner's local state initializes the room when going live
2. Relay orders all changes via OT during session
3. Owner's local persists the result (dual-write)
4. When session ends, owner's local has the final state

User confirmed this model works.
