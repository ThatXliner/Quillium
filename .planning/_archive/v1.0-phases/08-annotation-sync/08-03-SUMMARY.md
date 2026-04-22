---
phase: 08-annotation-sync
plan: "03"
subsystem: collab
tags: [yjs, codemirror, viewplugin, annotation-sync, bidirectional-sync, origin-tracking]

# Dependency graph
requires:
  - phase: 08-01
    provides: YjsAnnotation type, codeMirrorToYjsAnnotation, yjsAnnotationToCodeMirror, AnnotationIdMap
  - phase: 08-02
    provides: yjsUndo extension with optional ymap parameter
provides:
  - "createAnnotationSyncPlugin(ytext, ymap, clientId) ViewPlugin for bidirectional Y.Map <-> annotationField sync"
  - "yjsAnnotationSync Annotation.define<boolean>() for origin tracking"
  - "9 unit tests covering bidirectional sync and feedback loop prevention"
affects: [08-04, collab-integration, yjsProvider]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ViewPlugin pattern for bidirectional Yjs <-> CodeMirror sync (mirrors yjsBinding.ts)"
    - "Origin tracking: 'local' for CM-originated Y.Map changes, yjsAnnotationSync for Yjs-originated CM transactions"
    - "AnnotationIdMap for numeric (CM) <-> string (Yjs) ID bridging"

key-files:
  created:
    - src/lib/collab/yjsAnnotations.ts
    - src/lib/collab/yjsAnnotations.test.ts
  modified: []

key-decisions:
  - "Use 'local' origin string for CM-originated Y.Map transactions (matches yjsBinding.ts convention)"
  - "Derive yjsAnnotationSync Annotation to mark Yjs-originated CM transactions (parallel to yjsAnnotation in yjsBinding)"
  - "Store yjsId in AnnotationIdMap rather than regenerating from codeMirrorToYjsAnnotation to maintain stable IDs"
  - "updateThread handled via full ymap.set (replace entire entry) rather than nested mutation to avoid Yjs bug #642"

patterns-established:
  - "Annotation sync: Y.Map observer dispatches addAnnotation/removeAnnotation with yjsAnnotationSync marker"
  - "CM->Yjs: update() checks for yjsAnnotationSync on transactions before syncing to Y.Map"

requirements-completed: [SYNC-05]

# Metrics
duration: 3min
completed: 2026-04-18
---

# Phase 08 Plan 03: Annotation Sync ViewPlugin Summary

**Bidirectional Y.Map <-> annotationField ViewPlugin with origin tracking for feedback loop prevention, covering all three annotation types (comment, suggestion, revision)**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-18T14:52:52Z
- **Completed:** 2026-04-18T14:55:22Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments

- `createAnnotationSyncPlugin` ViewPlugin bridges Y.Map<YjsAnnotation> and CodeMirror annotationField
- Origin tracking prevents feedback loops: 'local' for CM-to-Yjs, `yjsAnnotationSync` for Yjs-to-CM
- All three annotation types (comment, suggestion, revision) sync correctly through the bidirectional bridge
- 9 unit tests verify CM->Y.Map propagation, Y.Map->CM propagation, and feedback loop prevention

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Create failing tests** - `a3716e1` (test)
2. **Task 2 (GREEN): Implement yjsAnnotations.ts + fix test type error** - `7cab4b7` (feat)

## Files Created/Modified

- `src/lib/collab/yjsAnnotations.ts` - Bidirectional sync ViewPlugin with origin tracking and AnnotationIdMap usage
- `src/lib/collab/yjsAnnotations.test.ts` - 9 unit tests for sync behavior and feedback loop prevention

## Decisions Made

- Used `vi.spyOn` instead of reassigning `view.dispatch` to avoid TypeScript overload signature incompatibility in tests
- `yjsAnnotationSync` Annotation mirrors `yjsAnnotation` in `yjsBinding.ts` — consistent pattern for all Yjs-originated CM transactions
- `updateThread` updates the Y.Map entry via full `ymap.set` (replacing the whole object) to avoid nested mutable Yjs structures (Yjs bug #642)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript overload incompatibility in test dispatch mock**
- **Found during:** Task 2 (GREEN phase, type check)
- **Issue:** `view.dispatch` has 3 overloaded signatures; reassigning with spread args caused TS error
- **Fix:** Replaced manual dispatch override with `vi.spyOn(view, "dispatch")` which properly handles overloads
- **Files modified:** `src/lib/collab/yjsAnnotations.test.ts`
- **Verification:** `bun run check` shows no errors in yjsAnnotations files; all 9 tests pass
- **Committed in:** `7cab4b7` (feat commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - TypeScript bug in test)
**Impact on plan:** Minor fix required for correct TypeScript behavior. No scope change.

## Issues Encountered

None beyond the TypeScript overload fix documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `createAnnotationSyncPlugin` and `yjsAnnotationSync` are ready for integration in Phase 08-04
- The plugin can be wired into `yjsProvider.ts` or the editor extension stack alongside `createYjsBinding`
- Remote Y.Map add (creating CM annotations from Yjs) requires valid RelativePosition encoding — tested via the existing annotationSchema converters

---
*Phase: 08-annotation-sync*
*Completed: 2026-04-18*

## Self-Check: PASSED

- FOUND: src/lib/collab/yjsAnnotations.ts
- FOUND: src/lib/collab/yjsAnnotations.test.ts
- FOUND: .planning/phases/08-annotation-sync/08-03-SUMMARY.md
- FOUND commit: a3716e1 (test: RED phase)
- FOUND commit: 7cab4b7 (feat: GREEN phase)
