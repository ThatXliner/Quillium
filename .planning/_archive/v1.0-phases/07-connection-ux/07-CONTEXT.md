# Phase 7: Connection UX - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning (replanning required — original plans referenced OT/Socket.io)

<domain>
## Phase Boundary

Users always know connection status and recover gracefully from disconnects. Connection indicator shows connected/syncing/offline status. Reconnection automatically recovers pending changes with no data loss or duplication. User sees clear feedback during reconnection attempts.

**Note:** Phase 7.5 (Yjs Migration) was completed out-of-order. The codebase now uses y-websocket instead of Socket.io. Original plans (07-01 through 07-05) referenced the old architecture and must be deleted and replanned.

</domain>

<decisions>
## Implementation Decisions

### Reconnection Behavior
- **D-100:** Max 10 reconnection attempts with exponential backoff (1s → 30s cap)
- **D-101:** Toast feedback on first reconnection attempt ("Connection lost, reconnecting...")
- **D-102:** Toast on final failure ("Connection lost. Please go live again to reconnect.")
- **D-103:** `reconnectAttempt` store updated during actual y-websocket reconnection attempts

### Failure Handling
- **D-104:** On reconnection failure, set `collabState` to "error" — user must manually Go Live again
- **D-105:** No silent fallback to local-only mode — user should always know when collab is broken

### y-websocket Configuration
- **D-106:** Configure WebsocketProvider with explicit reconnection settings (not defaults)
- **D-107:** Track reconnection attempts via y-websocket's internal retry count or custom counter

### Existing Infrastructure (already implemented)
- StatusBar already displays `collabState` with colored dot and text
- GoLiveButton already handles `reconnectAttempt` and `collabState` for toast messages
- Stores exist: `collabState`, `pendingUpdatesCount`, `reconnectAttempt`
- `yjsProvider.ts` sets `collabState` but doesn't track attempt count

### Claude's Discretion
- Exact exponential backoff formula (e.g., min(1000 * 2^attempt, 30000))
- Whether to show attempt count in StatusBar ("Reconnecting (3/10)") — GoLiveButton currently expects this
- Whether `pendingUpdatesCount` is still useful with Yjs (Yjs syncs automatically; may not need explicit pending tracking)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — SYNC-03 (connection status indicator), SYNC-04 (reconnection with pending recovery)

### Prior Phase Decisions
- `.planning/phases/06-client-collab/06-CONTEXT.md` — D-50 through D-59 (collab foundation)
- `.planning/phases/06.5-collab-polish/06.5-CONTEXT.md` — D-60 through D-62 (cursor, owner disconnect, docs)
- `.planning/phases/07.5-yjs-migration/07.5-CONTEXT.md` — D-70 through D-83 (Yjs architecture)

### Existing Code (integration points)
- `src/lib/collab/yjsProvider.ts` — WebsocketProvider creation, needs reconnection config
- `src/lib/collab/store.ts` — `collabState`, `reconnectAttempt`, `pendingUpdatesCount` stores
- `src/lib/collab/GoLiveButton.svelte` — Already handles reconnection toasts, expects `reconnectAttempt` updates
- `src/lib/editor/StatusBar.svelte` — Already displays `collabState` with reconnection text

### y-websocket
- y-websocket GitHub: https://github.com/yjs/y-websocket
- WebsocketProvider options: `resyncInterval`, custom reconnection via `connect`/`disconnect`
- Note: y-websocket handles sync recovery automatically on reconnect — Yjs guarantees convergence

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `collabState`, `reconnectAttempt` stores already wired to UI
- StatusBar reconnection display: "Reconnecting (N/10)" pattern
- GoLiveButton toast effects for reconnection state changes
- `yjsProvider.ts` status/sync event handlers — extend these for attempt tracking

### Established Patterns
- y-websocket `status` event fires on connecting/connected/disconnected
- Provider `sync` event indicates successful sync with server
- Toast via `svelte-sonner` for user feedback

### Integration Points
- `yjsProvider.ts` `createYjsProvider()` — add reconnection config to WebsocketProvider options
- Status event handler — increment `reconnectAttempt` on disconnected state
- Sync event handler — reset `reconnectAttempt` to 0 on successful reconnect
- GoLiveButton already watches `collabState` and `reconnectAttempt` for toast triggers

</code_context>

<specifics>
## Specific Ideas

- y-websocket's built-in reconnection may already handle most of this — verify what configuration options exist
- GoLiveButton expects "Reconnecting (N/10)" format — ensure `reconnectAttempt` matches this expectation
- Yjs guarantees eventual convergence — no need for explicit "pending changes" recovery logic; sync happens automatically on reconnect

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

### Plan Invalidation (completed)
Original plans 07-01 through 07-05 referenced Socket.io architecture. User chose to delete and replan. Plans will be regenerated via `/gsd-plan-phase 7`.

</deferred>

---

*Phase: 07-connection-ux*
*Context gathered: 2026-04-18*
