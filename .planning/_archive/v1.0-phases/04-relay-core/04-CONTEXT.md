# Phase 4: Relay Core - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

WebSocket relay server that accepts connections with JWT auth, validates permissions via Supabase, assigns version numbers using rebaseUpdates, and broadcasts updates to all connected clients. Lives in the quillium-landing repo, deployed to Fly.io.

</domain>

<decisions>
## Implementation Decisions

### Runtime & Framework
- **D-30:** Socket.io for WebSocket library (built-in rooms, reconnection handling, fallback support)
- **D-31:** TypeScript for relay server code (type safety, matches Quillium client codebase)

### Authentication
- **D-32:** Supabase Admin SDK (@supabase/supabase-js with service_role key) for JWT validation and permission queries
- **D-33:** Invalid/expired JWTs rejected immediately — connection closed with error code, client must re-auth
- **D-34:** Permissions checked once on connect (room join) — revoked access takes effect on next reconnect

### Document Rooms (Google Docs-style)
- **D-35:** Full document + version kept in memory per room (Google Docs pattern) — enables fast OT transforms without DB round-trips. Reloaded from DB on room creation or server restart.
- **D-36:** Client-driven catchup — client tracks its version, requests missing updates on reconnect (standard @codemirror/collab pattern). Client buffers unsent operations locally during disconnects.
- **D-37:** Room kept alive briefly (30-60 seconds) after last client leaves before cleanup
- **D-38:** Relay sends retry-after hints in disconnect messages to prevent thundering herd on mass reconnects (exponential backoff coordination)

### Claude's Discretion
- Socket.io configuration (ping interval, transport options)
- Exact room cleanup timeout duration
- Error code values for auth failures
- Logging and monitoring approach
- rebaseUpdates implementation details (covered by RELY-03)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — RELY-01 through RELY-04 define relay requirements

### Prior Decisions
- `.planning/phases/01-data-model/01-CONTEXT.md` — D-07/D-08 (update storage model), D-09 (zero RLS)
- `.planning/phases/03-anonymous-auth/03-CONTEXT.md` — D-23 through D-25 (anonymous JWT sessions)

### Architecture Context
- `.planning/PROJECT.md` — Relay location (quillium-landing), @codemirror/collab choice
- `docs/omni-reference/OMNI-CONTEXT.md` — Full architecture diagram, data model

### Database Schema
- `supabase/migrations/20260416000004_create_collab_updates.sql` — collab_updates table with version index

### @codemirror/collab
- CodeMirror collab docs: https://codemirror.net/docs/ref/#collab
- Specifically: `rebaseUpdates`, `sendableUpdates`, `receiveUpdates`

### Industry Patterns (research)
- Google Docs architecture: https://sderay.com/google-docs-architecture-real-time-collaboration/
- OT vs CRDT best practices: https://www.tiny.cloud/blog/real-time-collaboration-ot-vs-crdt/
- System design reference: https://www.systemdesignhandbook.com/guides/google-docs-system-design/

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- quillium-landing is a SvelteKit project — relay will be a separate Node.js process or API route
- Supabase client patterns in Quillium app can inform relay's Supabase Admin SDK usage

### Established Patterns
- Supabase JWT structure (from Quillium auth implementation)
- TypeScript with strict mode (match Quillium conventions)

### Integration Points
- Relay connects to Supabase Postgres for collab_updates table
- Clients connect via WebSocket with JWT in connection handshake
- Fly.io deployment (separate from Vercel hosting of landing page)

</code_context>

<specifics>
## Specific Ideas

- Socket.io chosen over raw ws for built-in room management and reconnection support
- Room cleanup delay prevents thrashing during brief network hiccups
- Full document in memory (Google Docs pattern) enables fast OT transforms; relay reloads from DB on restart
- Retry-after hints prevent thundering herd when many clients reconnect simultaneously

</specifics>

<deferred>
## Deferred Ideas

- OT Ordering details (rebaseUpdates implementation) — skipped in discussion, covered by RELY-03 requirement
- Relay persistence (Phase 5) — storing updates to DB is separate phase
- Presence/cursors — out of scope for prototype

</deferred>

---

*Phase: 04-relay-core*
*Context gathered: 2026-04-17*
