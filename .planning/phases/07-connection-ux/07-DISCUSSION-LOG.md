# Phase 7: Connection UX - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-18
**Phase:** 07-connection-ux
**Mode:** discuss
**Areas discussed:** Reconnection behavior, Plan invalidation

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Reconnection behavior | How y-websocket reconnects, what feedback users see during attempts, max retries before giving up | ✓ |
| Pending changes tracking | How to track/display unsynced local changes during disconnection | |
| Status indicator polish | StatusBar already shows status — discuss any visual/UX refinements needed | |
| Plan invalidation | Existing 07-01 through 07-05 plans reference Socket.io — discuss whether to replan from scratch for Yjs | ✓ |

---

## Reconnection Behavior

### y-websocket reconnection configuration

| Option | Description | Selected |
|--------|-------------|----------|
| 10 attempts with toast feedback | Max 10 retries, exponential backoff (1s → 30s), toast on attempt 1 and on failure. Matches GoLiveButton's existing expectations. | ✓ |
| Unlimited retries, silent | Keep trying forever with exponential backoff. No toast spam — only StatusBar dot changes color. | |
| 5 attempts, aggressive | Fewer attempts but faster retry intervals. Fail fast if relay is truly down. | |

**User's choice:** 10 attempts with toast feedback (Recommended)
**Notes:** Aligns with GoLiveButton's existing effect that expects reconnectAttempt count.

### Failure handling

| Option | Description | Selected |
|--------|-------------|----------|
| Error state + manual Go Live required | Set collabState to 'error', show toast explaining reconnection failed. User must click Go Live again to retry. | ✓ |
| Auto-fallback to local-only mode | Silently switch to offline editing. Risky — user might not notice collab is broken. | |
| Keep retrying in background | Never give up — continue reconnection attempts indefinitely at 30s intervals. | |

**User's choice:** Error state + manual Go Live required (Recommended)
**Notes:** Clear failure state prevents user confusion about collab status.

---

## Plan Invalidation

| Option | Description | Selected |
|--------|-------------|----------|
| Delete and replan from scratch | Remove 07-01 through 07-05. Run /gsd-plan-phase 7 to generate Yjs-aware plans from this new CONTEXT.md. | ✓ |
| Keep plans, adapt during execution | Leave plan files as reference but adapt Socket.io instructions to y-websocket on the fly. Risk: executor may get confused. | |
| Manual rewrite now | Edit existing plan files by hand to reference yjsProvider.ts instead of socket.ts. More work upfront. | |

**User's choice:** Delete and replan from scratch (Recommended)
**Notes:** Original plans referenced Socket.io/OT architecture that no longer exists. Plans 07-01 through 07-05 deleted. Replanning required via /gsd-plan-phase 7.

---

## Claude's Discretion

- Exact exponential backoff formula
- Whether to show attempt count in StatusBar
- Whether pendingUpdatesCount is still useful with Yjs (may be obsolete)

## Deferred Ideas

None — discussion stayed within phase scope.
