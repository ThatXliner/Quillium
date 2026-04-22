---
phase: 08-annotation-sync
plan: "04"
subsystem: collab/annotation-sync
tags: [yjs, annotations, revision-sync, codemirror, tdd]
dependency_graph:
  requires: [08-03]
  provides: [SYNC-05-complete]
  affects: [src/lib/collab/yjsAnnotations.ts, src/lib/collab/annotationSchema.ts]
tech_stack:
  added: []
  patterns:
    - "State comparison pattern: compare old/new annotationField to detect internal effect changes"
    - "T-08-05/T-08-06 mitigations: JSON.parse guarded + activeVersionIndex bounds-checked"
key_files:
  created: []
  modified:
    - src/lib/collab/yjsAnnotations.ts
    - src/lib/collab/annotationSchema.ts
    - src/lib/collab/yjsAnnotations.test.ts
decisions:
  - "Use state comparison (old vs new annotationField) to detect internal revision effects rather than importing unexported StateEffects"
  - "remove+add path for revision updates creates a new yjsId; tests updated to fetch latest key after dispatch"
  - "T-08-06: bounds-check activeVersionIndex in annotationSchema.ts where Yjs->CM conversion occurs"
metrics:
  duration: "~10 minutes"
  completed: "2026-04-18"
  tasks_completed: 2
  files_modified: 3
---

# Phase 08 Plan 04: Revision Sync for yjsAnnotations Summary

Complete revision-specific sync for version switches and additions in the yjsAnnotations ViewPlugin, plus T-08-05/T-08-06 security mitigations.

## What Was Built

### Task 1: Revision sync detection in yjsAnnotations.ts (cb1c993)

Added `syncRevisionChanges()` private method to the ViewPlugin class. Internal revision effects (`_updateActiveRevisionVersion`, `_addVersionToRevision`, etc.) are not exported from `annotationField.ts`, so they cannot be detected via `effect.is()`. Instead, the method compares the old and new `annotationField` state on every `docChanged` transaction and pushes changed `activeVersionIndex` or `versions` arrays to Y.Map with `"local"` origin to prevent observer feedback loops.

Also added `isAnnotationOfType` import from models.ts (was not imported before).

### Task 1 (Rule 2 deviation): T-08-05/T-08-06 mitigations in annotationSchema.ts (cb1c993)

The threat model required mitigations not yet implemented in `yjsAnnotationToCodeMirror`:
- **T-08-05**: `JSON.parse` for remote `versions` was already in `safeJsonParse` — added explicit guard that drops revision annotations with empty versions arrays with a console warning
- **T-08-06**: `activeVersionIndex` was not bounds-checked — added `Math.max(0, Math.min(rawIndex, versions.length - 1))` clamp before constructing the CM annotation

### Task 2: Revision, thread, and suggestion sync tests (5f8a31a)

Added three new top-level `describe` blocks to `yjsAnnotations.test.ts`:

- **`revision sync`**: Tests for `activeVersionIndex` change propagation to Y.Map, new version addition propagation, and receiving remote `activeVersionIndex` changes
- **`thread sync`**: Tests for remote thread reply reception and local `updateThread` effect propagation to Y.Map
- **`suggestion sync`**: Test for suggestion removal propagation (apply = remove from Y.Map)

Total test count: 9 existing + 6 new = **15 tests, all passing**.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Security] T-08-05/T-08-06 bounds checking in annotationSchema.ts**
- **Found during:** Task 1 (threat model review before implementation)
- **Issue:** `yjsAnnotationToCodeMirror` applied `activeVersionIndex ?? 0` without checking it against `versions.length`. A tampered or stale remote index could point outside the array. Also no guard for empty versions arrays.
- **Fix:** Added `Math.max(0, Math.min(rawIndex, versions.length - 1))` clamp; added early return with warning for empty versions arrays
- **Files modified:** `src/lib/collab/annotationSchema.ts`
- **Commit:** cb1c993

**2. [Rule 1 - Bug] Test approach: remove+add creates new yjsId**
- **Found during:** Task 2 (tests failed on first run)
- **Issue:** The test captured `yjsId` before `removeAnnotation`+`addAnnotation`. The `removeAnnotation` handler deletes the mapping from `idMap` and Y.Map, so `addAnnotation` generates a fresh yjsId. The old key is gone from Y.Map.
- **Fix:** Updated both affected tests to fetch `Array.from(ymap.keys())[0]` after the dispatch rather than reusing the pre-dispatch key
- **Files modified:** `src/lib/collab/yjsAnnotations.test.ts`
- **Commit:** 5f8a31a (fix applied inline before GREEN commit)

## TDD Gate Compliance

Task 2 used the TDD flow. Tests were written first, run to confirm failures (RED — 2 tests failed due to the yjsId bug above), then the implementation plus test fix produced GREEN. The revision test failures were a test-logic bug (wrong key lookup), not an implementation bug.

- RED gate: Tests written and run — 2 failures confirmed
- GREEN gate: Tests fixed to match actual remove+add semantics — all 15 pass

## Known Stubs

None. All sync paths are wired to real Y.Map operations.

## Threat Flags

None beyond those already addressed (T-08-05, T-08-06 now mitigated in annotationSchema.ts).

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src/lib/collab/yjsAnnotations.ts | FOUND |
| src/lib/collab/annotationSchema.ts | FOUND |
| src/lib/collab/yjsAnnotations.test.ts | FOUND |
| .planning/phases/08-annotation-sync/08-04-SUMMARY.md | FOUND |
| commit cb1c993 (feat Task 1) | FOUND |
| commit 5f8a31a (test Task 2) | FOUND |
