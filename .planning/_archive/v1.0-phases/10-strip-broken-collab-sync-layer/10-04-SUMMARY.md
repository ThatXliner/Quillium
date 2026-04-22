---
phase: 10-strip-broken-collab-sync-layer
plan: 04
subsystem: collab
tags: [test-cleanup, sync-layer, phase-10]
dependency_graph:
  requires: [10-01, 10-02, 10-03]
  provides: [clean-test-suite]
  affects: [src/lib/collab/]
tech_stack:
  added: []
  patterns: []
key_files:
  deleted:
    - src/lib/collab/revision-lifecycle.test.ts
    - src/lib/collab/version-coordination.test.ts
    - src/lib/collab/go-live-mid-session.test.ts
    - src/lib/collab/nested-editor-sync.test.ts
    - src/lib/collab/version-switch-live.test.ts
    - src/lib/collab/subtree-binding.test.ts
    - src/lib/collab/subtree-convergence.test.ts
    - src/lib/collab/recursive-mount.test.ts
    - src/lib/collab/convergence-edgecases.test.ts
  modified:
    - src/lib/collab/test-helpers/twoPeerHarness.ts
decisions:
  - Keep ymap in Peer interface for Phase 11 rebuild
metrics:
  duration: 2min
  tasks_completed: 2
  files_deleted: 9
  files_modified: 1
  completed: 2026-04-19T17:03:35Z
---

# Phase 10 Plan 04: Delete Old Sync Tests Summary

Deleted 9 test files coupled to the old annotation sync plugin design and updated twoPeerHarness to no longer install the annotation sync plugin.

## What Was Done

### Task 1: Delete tests coupled to old sync-plugin design

Deleted all test files that were written against the broken sync layer:

| File | Purpose | Reason for Deletion |
|------|---------|---------------------|
| revision-lifecycle.test.ts | Phase 9 bug invariants | Tests subtree Y.Text sync flow |
| version-coordination.test.ts | Bug #2 bisection | Tests activeVersionIndex sync via Y.Map |
| go-live-mid-session.test.ts | Bug #1 detection | Tests needsCollabModeRebuild which is deleted |
| nested-editor-sync.test.ts | End-to-end subtree sync | Uses createAnnotationSyncPlugin |
| version-switch-live.test.ts | Version switch in collab | Uses createAnnotationSyncPlugin |
| subtree-binding.test.ts | Wave 0 scaffold | Empty scaffold for deleted feature |
| subtree-convergence.test.ts | Wave 0 scaffold | Empty scaffold for deleted feature |
| recursive-mount.test.ts | Wave 0 scaffold | Empty scaffold for deleted feature |
| convergence-edgecases.test.ts | Wave 0 scaffold | Empty scaffold for deleted feature |

**Commit:** a257004

### Task 2: Update twoPeerHarness to not use annotation sync plugin

Modified `src/lib/collab/test-helpers/twoPeerHarness.ts`:
- Removed `createAnnotationSyncPlugin` import
- Removed plugin from `makePeer()` extensions array (kept only `annotationField` and `createYjsBinding`)
- Updated module docstring to reflect Phase 10 changes
- Kept `ymap` in Peer interface for Phase 11 rebuild

**Commit:** 4078d6a

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

```
PASS: tests deleted
PASS: harness doesn't use annotation sync
```

## Success Criteria

- [x] 9 test files deleted (revision-lifecycle, version-coordination, go-live-mid-session, nested-editor-sync, version-switch-live, subtree-binding, subtree-convergence, recursive-mount, convergence-edgecases)
- [x] twoPeerHarness no longer imports createAnnotationSyncPlugin
- [x] twoPeerHarness no longer installs annotation sync plugin

## Self-Check: PASSED

**Deleted files verified as non-existent:**
- revision-lifecycle.test.ts: CONFIRMED DELETED
- version-coordination.test.ts: CONFIRMED DELETED
- go-live-mid-session.test.ts: CONFIRMED DELETED
- nested-editor-sync.test.ts: CONFIRMED DELETED
- version-switch-live.test.ts: CONFIRMED DELETED
- subtree-binding.test.ts: CONFIRMED DELETED
- subtree-convergence.test.ts: CONFIRMED DELETED
- recursive-mount.test.ts: CONFIRMED DELETED
- convergence-edgecases.test.ts: CONFIRMED DELETED

**Commits verified:**
- a257004: chore(10-04): delete tests coupled to old sync-plugin design
- 4078d6a: refactor(10-04): remove annotation sync plugin from twoPeerHarness
