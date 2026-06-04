# Quillium Omni

## What This Is

A dogfoodable prototype of Quillium Omni — the paid sync and real-time collaboration service for Quillium. Two Quillium instances can connect to a relay server and see each other's edits in real-time. Built on Supabase Auth + a Node.js WebSocket relay.

## Core Value

Two Quillium instances can connect and see each other's edits in real-time.

## Requirements

### Validated

- ✓ Desktop writing app with local persistence — existing
- ✓ CodeMirror-based editor with annotation system — existing
- ✓ Event-sourced document model — existing

### Active

- [ ] Supabase Auth integration (email/password login)
- [ ] WebSocket relay server for real-time sync
- [ ] Client-side collab integration with @codemirror/collab
- [ ] Basic offline queue for owner (edits sync when reconnected)
- [ ] Document-level sync (connect to shared document by ID)

### Out of Scope

- Presence system (cursors, follow mode) — deferred to post-prototype
- Sharing UI + permissions — deferred to post-prototype
- Version history sync — deferred
- Omni Lite (sync-only tier with license keys) — future product tier
- Mobile/web clients — desktop only for now
- Production hardening — prototype quality acceptable

## Context

Quillium is a Tauri + SvelteKit desktop writing app focused on non-linear editing with AI assistance. The existing codebase has:
- Event-sourced persistence with snapshots
- Annotation system (comments, revisions) that syncs as CodeMirror state
- AutoAI for reader personas and feedback

The relay server will live in the `quillium-landing` repo alongside the marketing site. Supabase handles auth and Postgres storage; the relay is a thin WebSocket layer for ordering and broadcasting changes.

Architecture decision: Use `@codemirror/collab` for v1, with Yjs migration as a future option.

## Constraints

- **Auth**: Supabase Auth (email/password) — decided over license keys for collab identity
- **Relay location**: Lives in quillium-landing repo
- **Timeline**: A few weeks, no hard deadline
- **Quality bar**: Dogfoodable — stable enough to use for real writing across devices
- **Dependencies**: Supabase (Auth + Postgres), Fly.io for relay (~$7/mo)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Supabase Auth over license keys | Collab needs identity for "who's typing" UX; license keys are anonymous | — Pending |
| Relay in quillium-landing | Reuse existing infra; keeps repos manageable | — Pending |
| @codemirror/collab for v1 | Already using CodeMirror; Yjs migration can come later | — Pending |
| Owner-only offline editing | Collaborators are server-dependent; simpler conflict resolution | — Pending |
| Two-tier model (Omni + Omni Lite) | Privacy-conscious users get sync-only option later | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2025-04-16 after initialization*
