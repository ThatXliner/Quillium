# Quillium Omni

## Current Milestone: v1.1 PRE-V2 FIX ANNOTATION SYNC

**Goal:** Make Quillium Omni's live annotation sync actually dogfoodable by re-architecting the `annotationField` ↔ Y.Map layer so document text, comment positions, and revision versions (infinitely nested) all sync reliably in real-time between peers.

**Target features:**
- Document text real-time sync (already working, verify preserved)
- Comment position sync on remote rebuilds (decorations render immediately, no collapsed ranges)
- Revision version text sync — character-by-character merge in active version
- Revision version switching — propagates, no annotation deletion, no corruption
- Infinitely nested revisions — revision-inside-revision syncs same as top-level
- Decorations render on joiner connect (no "switch once" workaround)
- Cmd-z on joiner right after connect does not revert past connect state
- Comment threads append concurrently without loss

**Key context:**
- Clean-slate approach: first phase deletes current tactical patches + effect-specific branches before rebuilding
- Architectural principle: single source of truth between CM annotationField and Y.Map; no effect-specific branches; no Phase 3 escape hatches
- This is v1.1 (pre-v2), not a product redesign — sync layer only

## What This Is

A dogfoodable prototype of Quillium Omni — the paid sync and real-time collaboration service for Quillium. Two Quillium instances can connect to a relay server and see each other's edits in real-time. Built on Supabase Auth + a Node.js WebSocket relay.

## Core Value

Two Quillium instances can connect and see each other's edits in real-time, including annotations and revision versions, without divergence or data loss.

## Requirements

### Validated

- ✓ Desktop writing app with local persistence — existing
- ✓ CodeMirror-based editor with annotation system — existing
- ✓ Event-sourced document model — existing
- ✓ Supabase Auth integration (email/password + anonymous) — v1.0
- ✓ WebSocket relay server (Yjs-based, in quillium-landing) — v1.0
- ✓ Client-side Yjs CRDT integration — v1.0
- ✓ Document-level sync (connect to shared document by ID) — v1.0
- ✓ Awareness-based cursor sync — v1.0
- ✓ Per-user undo via Y.UndoManager — v1.0

### Active

- [ ] Re-architect annotation sync layer (single source of truth)
- [ ] Comment position sync on remote rebuilds
- [ ] Revision version text sync (character-by-character)
- [ ] Revision version switching sync (no corruption, no deletion)
- [ ] Infinitely nested revision sync
- [ ] Decorations render immediately on joiner connect
- [ ] Cmd-z post-connect does not revert past connect state
- [ ] Concurrent thread append without loss

### Out of Scope

- Presence system (cursors, follow mode) — deferred to post-prototype (live cursors already shipped via Phase 6.5)
- Sharing UI + permissions — deferred to v2
- Version history sync — deferred to v2
- Omni Lite (sync-only tier with license keys) — future product tier
- Mobile/web clients — desktop only for now
- Production hardening — prototype quality acceptable
- Product/UX redesign — v1.1 is sync-layer only, not a redesign
- New collab features — milestone is bug fix + re-architecture only

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
| Clean-slate annotation sync re-architecture (v1.1) | Phases 9-13 spiral proved tactical patches compound; dual-source-of-truth between annotationField and Y.Map is the root cause | — Pending |

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
*Last updated: 2026-04-19 after v1.1 milestone start*
