# Phase 1: Data Model - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Supabase Postgres tables for users, documents, updates, and shares. This phase creates the database schema that all subsequent phases depend on — authentication, relay server, and client sync all read/write these tables.

</domain>

<decisions>
## Implementation Decisions

### User Profile
- **D-01:** `users` table stores display names only (no avatars stored)
- **D-02:** Avatars auto-generated from display name (client-side, e.g., initials or identicon)

### Share Token Design
- **D-03:** Google Docs style sharing — single persistent link per document
- **D-04:** Anyone with the link can join (no granular permission levels for v1)
- **D-05:** Owner can reset token (invalidates old link) or disable sharing entirely
- **D-06:** No expiry on share links for v1

### Update Storage
- **D-07:** One `collab_updates` row per WebSocket message (natural batching from @codemirror/collab)
- **D-08:** Each row = one version number assigned by relay

### Row-Level Security
- **D-09:** Zero RLS for prototype — all tables publicly accessible with valid Supabase auth

### Claude's Discretion
- Exact column types and nullable fields
- Index strategy beyond required foreign keys
- Migration file organization

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — DATA-01 through DATA-04 define table requirements

### Architecture Context
- `.planning/PROJECT.md` — Supabase Auth decision, relay location, @codemirror/collab choice
- `.planning/codebase/INTEGRATIONS.md` — Existing SQLite schema pattern (local DB, not Supabase but shows naming conventions)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None directly applicable — this is Supabase schema work, separate from local SQLite

### Established Patterns
- Local SQLite uses: `documents`, `drafts`, `events`, `snapshots` tables
- Naming convention: snake_case table and column names
- UUID primary keys (existing `uuid` crate in Rust backend)

### Integration Points
- Supabase project: Will need connection from relay server (quillium-landing repo)
- Client auth: Supabase JS client will connect in Phase 2

</code_context>

<specifics>
## Specific Ideas

- Share links work like Google Docs — simple, familiar UX
- Avatars from display names keeps the `users` table minimal (no file storage needed)

</specifics>

<deferred>
## Deferred Ideas

- Granular share permissions (view/comment/edit) — v2 feature (SHAR-01)
- Share link expiry — not needed for dogfooding
- Row-level security — **CRITICAL: Must add before any production use**

</deferred>

---

*Phase: 01-data-model*
*Context gathered: 2026-04-16*
