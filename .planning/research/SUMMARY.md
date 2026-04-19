# Research Summary: Quillium Omni

## Executive Summary

Quillium Omni adds real-time collaborative editing to an existing single-user desktop writing app. Research unanimously validates the architecture specified in PROJECT.md: use `@codemirror/collab` (OT with central authority) rather than Yjs (CRDT), backed by a thin Node.js WebSocket relay on Fly.io, with Supabase providing auth (JWT) and durable update storage (Postgres). This is the correct choice because Quillium's entire annotation system is built on CodeMirror StateEffects, which `@codemirror/collab` can sync natively via `sharedEffects` — a capability Yjs bindings do not provide for custom effects.

The biggest architectural risk is treating collaboration as a transparent layer added on top of existing systems. CKEditor spent four years and 42 person-years discovering this the hard way. Every existing Quillium subsystem — undo/redo, annotations, persistence, AutoAI — must have explicit, documented behavior under concurrent editing before a line of collab code is written.

The annotation system presents the hardest specific problem: OT guarantees document convergence but not position convergence, meaning comment and revision anchors can drift to different text ranges on different clients after concurrent edits. The CodeMirror docs explicitly warn about this.

## Key Stack Decisions

| Technology | Purpose | Why |
|------------|---------|-----|
| `@codemirror/collab` 6.1.1 | OT document sync | Native StateEffect integration; `sharedEffects` for annotations |
| `@supabase/supabase-js` 2.x | Auth client | PKCE for Tauri; JWT for relay auth |
| Node.js 20+ + `ws` 8.x | Relay server | Thin WebSocket hub; not a CRDT engine |
| Supabase Postgres | Durable update storage | Free tier covers prototype scale |
| Fly.io ~$7/mo | Relay hosting | First-class WebSocket + TLS |

**Not using:**
- Yjs — doesn't support syncing custom StateEffects
- Hocuspocus/y-websocket — Yjs-specific
- Supabase Realtime — payload size limits, WAL buildup risk

## Table Stakes for MVP

**Must have:**
- Real-time document sync (~100ms latency)
- User identity via Supabase Auth
- Connection status indicator
- Automatic conflict resolution via OT
- Reconnection handling for owner
- Basic document sharing by ID

**Deferred post-prototype:**
- Live cursors and presence
- Permission levels
- Annotation sync across peers (owner-only for prototype)
- Version history sync
- Follow mode

**Never build:**
- Collaborative AI editing (AutoAI stays per-user)
- Git-style branching
- Manual conflict resolution UI

## Critical Pitfalls

1. **Annotation position divergence** — OT guarantees document convergence, not position convergence. Comment/revision anchors will drift. Need explicit mitigation strategy before Phase 5.

2. **Bolt-on architecture** — Every existing feature must have documented concurrent-editing behavior before implementation. Cannot be a transparent layer.

3. **No rebasing on relay** — Demo server rejects stale versions. Production must implement `rebaseUpdates()` from day one.

4. **WebSocket reconnection desync** — Naive reconnection causes duplicated text or data loss. Persist pending changes; fetch all updates since last version on reconnect.

5. **Multi-user undo** — Per-user undo stacks required. Tag operations with author; skip remote operations on undo.

## Recommended Build Order

| Phase | Focus | Output |
|-------|-------|--------|
| 1 | Auth Foundation | Supabase Auth in client, PKCE OAuth, login/logout UI |
| 2 | Relay Server | WebSocket relay with rebaseUpdates, Postgres persistence |
| 3 | Client Collab | `collab()` wired in, send/receive loops, connection UI, per-user undo |
| 4 | Offline Queue | Owner-only offline editing, queue in SQLite, rebase on reconnect |
| 5 | Annotation Sync | `sharedEffects` wiring, position divergence mitigation |
| 6 | Hardening | Concurrency tests, chaos tests, monitoring |

## Open Questions for Planning

1. **Annotation divergence mitigation** — Canonical anchor text vs. stable IDs vs. periodic reconciliation? Needs spike in Phase 5.

2. **Revision version switches** — Local or shared `activeVersionIndex`? Product decision before Phase 5.

3. **Supabase write frequency** — Batching strategy for staying within free tier limits.

4. **Collaborator offline UX** — Error modal? Read-only mode? Silent queue?

## Confidence

| Area | Level | Notes |
|------|-------|-------|
| Stack | HIGH | All packages verified; official docs for every integration |
| Features | HIGH | Stable across collaborative editing literature |
| Architecture | HIGH | Official CodeMirror docs + established OT patterns |
| Pitfalls | HIGH | Position divergence explicitly warned in official docs |

---
*Research completed: 2025-04-16*
