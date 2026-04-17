# Phase 6: Client Collab - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Two Quillium instances can see each other's text edits in real-time. Text edits sync with ~100ms latency, concurrent edits auto-merge via OT, per-user undo works correctly (don't undo remote changes), document content converges identically on all clients. Implements SYNC-01 and SYNC-02.

</domain>

<decisions>
## Implementation Decisions

### Collab Extension Integration
- **D-50:** Per-user undo via author-tagged changes — each change tagged with author ID, undo inverts only your own changes (standard @codemirror/collab pattern)
- **D-51:** Static collab extension in stack, enabled/disabled via Compartment (consistent with existing patterns like `harperCompartment`)

### Socket.io Client Setup
- **D-52:** Per-document socket instance — socket lifecycle tied to collab session, created on session start, destroyed on session end
- **D-53:** JWT from `getSession().access_token` passed in socket.io handshake auth

### Local Persistence Coexistence
- **D-54:** Dual-write — local SQLite persistence continues during collab (crash-safe backup, positioned for offline queue in Phase 9)
- **D-55:** Owner's local SQLite is source of truth; relay is broadcast layer + crash recovery during active session

### Collab Activation
- **D-56:** "Go Live" toggle in top-right area (near AuthButton) — visible when authenticated and viewing your own document
- **D-57:** Live Room mode only — session ends when owner leaves, collaborators disconnected (Excalidraw/Zoom model)
- **D-58:** Snapshot before pulling remote state — safety net before merging any server state
- **D-59:** Auto-connect when joining someone else's doc (via share link/invite); manual toggle for owner's own documents

### Claude's Discretion
- Socket.io client configuration (reconnection attempts, timeouts)
- Exact UI for "Go Live" toggle (button, switch, icon)
- Error handling for socket disconnection during session
- Compartment naming and placement in extension stack

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — SYNC-01 (real-time text sync), SYNC-02 (OT auto-merge, per-user undo)

### Prior Phase Decisions
- `.planning/phases/04-relay-core/04-CONTEXT.md` — D-30 (Socket.io), D-35 (full doc in memory per room), D-36 (client-driven catchup)
- `.planning/phases/05-relay-persistence/05-CONTEXT.md` — D-40 (write-through persistence), D-41 (periodic snapshots)

### Architecture Context
- `.planning/PROJECT.md` — @codemirror/collab choice, local-first philosophy
- `ARCHITECTURE.md` § State Management Mental Model — CodeMirror ↔ Svelte sync patterns

### Existing Code (integration points)
- `src/lib/editor/extensions.ts` — Extension stack, `savedFields`, Compartment patterns
- `src/lib/editor/listeners.ts` — Local persistence (event log + snapshots), must coexist with collab
- `src/lib/auth/auth.svelte.ts` — `getSession()` for JWT retrieval
- `src/lib/stores.ts` — `editorView` store for imperative access

### @codemirror/collab
- CodeMirror collab docs: https://codemirror.net/docs/ref/#collab
- Key APIs: `collab()`, `sendableUpdates()`, `receiveUpdates()`, `getSyncedVersion()`

### STATE.md Blocker
- "Per-user undo required: Multi-user editing needs per-user undo stacks. Must tag operations with author in Phase 6." — addressed by D-50

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `harperCompartment` pattern in `extensions.ts` — model for collab compartment
- `supabase.ts` singleton pattern — reference for socket client module structure
- `getSession()` from `auth.svelte.ts` — JWT retrieval for socket auth

### Established Patterns
- Compartment for hot-swappable extensions (grammar checker)
- `listeners.ts` persistence via event log + snapshots — will dual-write during collab
- Top-right UI cluster for account/auth controls (D-10)

### Integration Points
- `extensions.ts` — add collab extension to stack
- `listeners.ts` — continue local persistence during collab (dual-write)
- `+page.svelte` top-right area — add "Go Live" toggle near AuthButton
- New `src/lib/collab/` module for socket client and collab state

</code_context>

<specifics>
## Specific Ideas

- Live Room mode is functionally equivalent to Shared Document mode if owner stays online — good enough for prototype/dogfooding
- Snapshot before sync provides safety net, matches existing local persistence pattern
- Per-document socket instance keeps lifecycle simple — no room management complexity on client side

</specifics>

<deferred>
## Deferred Ideas

- **Shared Document mode** — server as source of truth, owner-independent sessions (v2)
- **Connection status indicator** — Phase 7 (Connection UX)
- **Reconnection handling** — Phase 7
- **Presence/cursors** — out of scope for prototype
- **Annotation sync** — Phase 8

</deferred>

---

*Phase: 06-client-collab*
*Context gathered: 2026-04-17*
