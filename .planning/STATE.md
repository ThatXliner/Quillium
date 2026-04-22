---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: PRE-V2 FIX ANNOTATION SYNC
status: Ready for Phase 3
stopped_at: context exhaustion at 93% (2026-04-20)
last_updated: "2026-04-22T23:36:45Z"
last_activity: 2026-04-22 — Phase 2 complete plus dogfood sync regressions fixed (joiner blank doc, revision range sync, first-render decorations, inline nested decoration version switches)
progress:
  total_phases: 9
  completed_phases: 2
  total_plans: 8
  completed_plans: 8
  percent: 22
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-19)

**Core value:** Two Quillium instances can connect and see each other's edits in real-time, including annotations and revision versions, without divergence or data loss
**Current focus:** v1.1 milestone — re-architect annotation sync (CM annotationField ↔ Y.Map) as a single source of truth (Yjs canonical, annotationField derived projection)

## Current Position

Branch: omni-fixes
Phase: Phase 2: Joiner View Hardening — COMPLETE
Plan: 5/5 plans complete
Status: Ready for Phase 3
Last activity: 2026-04-22 — Phase 2 complete plus dogfood sync regressions fixed (joiner blank doc, revision range sync, first-render decorations, inline nested decoration version switches)

Progress: [██░░░░░░░░] 22% (2/9 phases)

## Performance Metrics

**Velocity:**

- Total plans completed: 20
- Average duration: -
- Total execution time: 0 hours

**Plan Metrics:**

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 08.5a | 01 | 8min  | 2 | 9 |
| 08.5a | 02 | 11min | 2 | 3 |
| 08.5b | 01 | 5min  | 2 | 4 |
| 08.5b | 02 | 3min  | 2 | 3 |

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 3 | - | - |
| 02 | 2 | - | - |
| 03 | 1 | - | - |
| 04 | 3 | - | - |
| 05 | 3 | - | - |
| 06 | 3 | - | - |

**Recent Trend:**

- Last 5 plans: none
- Trend: N/A

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- v1.1 phase numbering reset to 1 (v1.0 phases archived under `milestones/v1.0-ROADMAP.md`).
- v1.1 phase ordering follows research SUMMARY.md "Proposed Phase Ordering" — invariants/harness first, single SOT before Phase 3 deletion, nested rewire after Phase 3 deletion, fuzz/dogfood last.
- 08.5a-01: Use `it.todo` (not `it.skip`) for Wave 0 scaffolds so Vitest reports TODO count distinctly and the suite stays green.
- 08.5a-01: Keep harness `Peer.ymap` typed as `Y.Map<unknown>` with a `Y.Map<never>` cast at the plugin boundary so the harness survives the shape rewrite in 08.5a-02.
- 08.5a-01: Wave 0 scaffolds do NOT import the harness yet; downstream plans add imports when they rewrite a todo into a real test.
- 08.5a-02: Recursive Y.Map node shape replaces flat JSON blob — `YjsAnnotationNode = Y.Map<unknown>` with runtime `instanceof` guards; Yjs does not support discriminated-union typing of child types (D-90/D-92).
- 08.5a-02: Converter wraps all child Y type creation in a single `ydoc.transact(..., "init")` so remote peers see atomic node insertion; must call `ymap.set(key, node)` before reading back (detached Y.Maps log "Invalid access" and return undefined).
- 08.5a-02: annotation-tree `version propagation` test cannot use `twoPeerHarness.makePeer` yet — `createAnnotationSyncPlugin` still expects the legacy flat shape (owned by Plan 8.5b-01). Standalone two-Y.Doc setup used for this test only.
- 08.5b-01: observeDeep handles all nested Y.Map/Y.Array/Y.Text events with a single subscription; event routing: shallow Y.Map -> add/remove/rebuild, thread Y.Array -> updateThread, all others -> full annotation rebuild.
- 08.5b-01: Y.Array.push is used for thread append (D-93 happy path), with atomic replace fallback for shrink; syncRevisionChanges deleted entirely (D-94).
- 08.5b-02: Cast Y.Text to AbstractType<unknown> in addSubtreeToUndoScope to satisfy TypeScript; Yjs internal event handler types are more specific but addToScope accepts any AbstractType.
- 08.5b-02: breakUndoCapture is a thin wrapper exposing stopCapturing as a caller-friendly boundary primitive for yjs#642 mitigation.

### Pending Todos

None yet.

### Roadmap Evolution

- 2026-04-19: v1.1 roadmap created — 9 phases, 32/32 requirements mapped, phase numbering reset to 1, v1.0 phases archived under milestones/v1.0-ROADMAP.md.
- 2026-04-22: Phase 1 and Phase 2 completed; dogfood fixes landed for PR #200 sync regressions without adding a new phase.
- Phase 7.5 inserted: Yjs Migration - Replace OT with Yjs CRDT (moved from Phase 10)
- Phases 8/9 updated: Now build on Yjs instead of OT assumptions
- Phase 9 added: Fix Live Collab Revision Editing Bugs (post-8.5c dogfooding regressions)
- Phase 9 reopened 2026-04-19: plans landed but inline-editor and active-version bugs persist in dogfooding; continuation split into phases 10–13 on the `omni-fixes` branch
- Phase 10 added: Strip Broken Collab Sync Layer
- Phase 11 added: Unified Subtree Sync Rebuild
- Phase 12 added: Nested Editor Reunification
- Phase 13 added: Dogfooding Regression Suite

### Blockers/Concerns

Research identified key risks to track for v1.1:

- **Pattern 7c prototype unproven**: Atomic parent-slice ↔ version Y.Text dual-write inside one `ydoc.transact` has not been prototyped end-to-end. Build a minimal two-peer test in Phase 1 or early Phase 5 before committing to the design.
- **observeDeep event ordering (yjs#591)**: Phase 4 must preserve and test the read-all-then-rebuild-once pattern; ordering quirk may surprise multi-mutation transactions.
- **Persistence migration for RelativePositions (yjs#340)**: Phase 7 must audit current snapshot format; if RelativePositions are JSON-encoded today, a small binary migration is required.
- **`activeVersionIndex` semantics under concurrent version add**: Decision pending — numeric index vs stable string ID. Cheap to make safe (string ID); deferred only if version add stays owner-only.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260419 | Annotations not synced initially in room | 2026-04-19 | a11b742 | [260419-annotation-sync-initial](./quick/260419-annotation-sync-initial/) |
| 220426 | PR #200 dogfood sync regression fixes | 2026-04-22 | uncommitted | Phase 2 follow-up |

## Deferred Items

Items acknowledged and deferred at v1.0 milestone close on 2026-04-19:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| phase | Phase 12: Nested Editor Reunification — tactical patches, architecture debt | absorbed into v1.1 Phase 6 | 2026-04-19 |
| phase | Phase 13: Dogfooding Regression Suite — never planned | absorbed into v1.1 Phase 1 + Phase 9 | 2026-04-19 |
| quick_task | 260419-annotation-sync-initial | addressed in v1.1 Phase 4 (JOINER-04) | 2026-04-19 |
| quick_task | 260419-revision-version-live-edit-sync | addressed in v1.1 Phase 5 (REVISION-01) | 2026-04-19 |
| architecture | Dual-source-of-truth: annotationField ↔ Y.Map causes recurring sync bugs | addressed by v1.1 milestone | 2026-04-19 |

## Session Continuity

Last session: 2026-04-20T01:25:24.097Z
Stopped at: context exhaustion at 93% (2026-04-20)
Resume file: None

**Planned Phase:** 2 (Joiner View Hardening) — 5 plans — 2026-04-20T01:25:37.323Z
