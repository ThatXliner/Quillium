---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: PRE-V2 FIX ANNOTATION SYNC
status: in_progress
stopped_at: 
last_updated: "2026-04-19T21:50:00.000Z"
last_activity: 2026-04-19 -- v1.1 milestone started
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-19)

**Core value:** Two Quillium instances can connect and see each other's edits in real-time, including annotations and revision versions, without divergence or data loss
**Current focus:** v1.1 milestone — re-architect annotation sync (CM annotationField ↔ Y.Map) to fix the recurring bug class that plagued v1.0 Phases 9-13

## Current Position

Branch: omni-fixes
Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-04-19 — v1.1 milestone started

Progress: [░░░░░░░░░░] 0%

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

- Phase 7.5 inserted: Yjs Migration - Replace OT with Yjs CRDT (moved from Phase 10)
- Phases 8/9 updated: Now build on Yjs instead of OT assumptions
- Phase 9 added: Fix Live Collab Revision Editing Bugs (post-8.5c dogfooding regressions)
- Phase 9 reopened 2026-04-19: plans landed but inline-editor and active-version bugs persist in dogfooding; continuation split into phases 10–13 on the `omni-fixes` branch
- Phase 10 added: Strip Broken Collab Sync Layer — remove effect-by-effect handlers, per-version subtree bindings, `hasSubtreeForRevision` short-circuit, `_hasCollabSubtree` fork; keep main-text sync working with an integration test
- Phase 11 added: Unified Subtree Sync Rebuild — single diff-and-write path, per-character merge inside revision versions, observeDeep-driven rebuild, no per-effect handlers
- Phase 12 added: Nested Editor Reunification — drop the local/collab fork in `NestedEditorController`; one code path regardless of collab state
- Phase 13 added: Dogfooding Regression Suite — integration tests in vitest covering the scenarios phase 9 missed (concurrent typing inside a version, version switch propagation, joiner pre-existing annotations, Cmd-z post-connect, concurrent thread appends)

### Blockers/Concerns

Research identified key risks to track:

- **Annotation divergence**: OT guarantees document convergence but not position convergence. Comment/revision anchors may drift. Mitigation strategy needed before Phase 8.
- **Relay must use rebaseUpdates**: Demo server rejects stale versions. Production relay must implement rebaseUpdates from day one (Phase 4).
- **Per-user undo required**: Multi-user editing needs per-user undo stacks. Must tag operations with author in Phase 6.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260419 | Annotations not synced initially in room | 2026-04-19 | a11b742 | [260419-annotation-sync-initial](./quick/260419-annotation-sync-initial/) |

## Deferred Items

Items acknowledged and deferred at milestone close on 2026-04-19:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| phase | Phase 12: Nested Editor Reunification — tactical patches, architecture debt | deferred | 2026-04-19 |
| phase | Phase 13: Dogfooding Regression Suite — never planned | deferred | 2026-04-19 |
| quick_task | 260419-annotation-sync-initial | missing | 2026-04-19 |
| quick_task | 260419-revision-version-live-edit-sync | missing | 2026-04-19 |
| architecture | Dual-source-of-truth: annotationField ↔ Y.Map causes recurring sync bugs | deferred | 2026-04-19 |

## Session Continuity

Last session: 2026-04-19T15:36:40.082Z
Stopped at: context exhaustion at 90% (2026-04-19)
Resume file: None
