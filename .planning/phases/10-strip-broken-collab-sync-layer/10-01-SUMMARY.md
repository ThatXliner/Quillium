---
phase: 10-strip-broken-collab-sync-layer
plan: 01
subsystem: collab
tags: [refactor, cleanup, sync]
dependency_graph:
  requires: []
  provides:
    - Stripped annotation sync plugin (no write path)
    - annotationField without hasSubtreeForRevision check
  affects:
    - src/lib/collab/yjsAnnotations.ts
    - src/lib/collab/index.ts
    - src/lib/editor/plugins/annotations/annotationField.ts
tech_stack:
  added: []
  patterns:
    - Phase 10 comment markers for disabled code
key_files:
  created: []
  modified:
    - src/lib/collab/yjsAnnotations.ts
    - src/lib/collab/index.ts
    - src/lib/editor/plugins/annotations/annotationField.ts
decisions:
  - Keep deepObserver intact for read-back from Yjs
  - Keep _syncInitialToYjs and _syncInitialFromYjs for initial state exchange
  - Phase 3 now runs unconditionally for all revisions (local-only behavior restored)
metrics:
  duration: 2min
  completed: 2026-04-19T16:57:07Z
---

# Phase 10 Plan 01: Strip annotation sync write path Summary

Stripped the broken annotation sync write path from `createAnnotationSyncPlugin` and removed the `hasSubtreeForRevision` short-circuit from `annotationField` Phase 3.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Gut the createAnnotationSyncPlugin write path | a6aee53 | src/lib/collab/yjsAnnotations.ts |
| 2 | Delete hasSubtreeForRevision and remove Phase 3 short-circuit | c5e970b | src/lib/collab/index.ts, src/lib/editor/plugins/annotations/annotationField.ts |

## What Changed

### yjsAnnotations.ts

The `update()` method in `createAnnotationSyncPlugin` was completely gutted. All effect-by-effect handlers for:
- `addAnnotation`
- `removeAnnotation`
- `updateThread`
- `_updateActiveRevisionVersion`
- `_addVersionToRevision`
- `_deleteVersionFromRevision`

...were removed and replaced with an early return and a Phase 10 comment marker. This removes 165 lines of broken synchronization logic that was the source of inconsistency bugs in live collab editing.

The observer (`deepObserver`) remains intact for read-back from Yjs. Initial sync methods (`_syncInitialToYjs`, `_syncInitialFromYjs`) also remain for initial state exchange.

### index.ts

The `hasSubtreeForRevision` function was deleted entirely (13 lines). This function was used by annotationField Phase 3 to short-circuit doc-pulling for revisions managed by Yjs, but the short-circuit itself was causing bugs.

### annotationField.ts

- Removed import: `import { hasSubtreeForRevision } from "$lib/collab";`
- Removed the Phase 3 short-circuit check in `pushDocToVersionState`:
  ```typescript
  // DELETED: if (hasSubtreeForRevision(x.id)) return x;
  ```

Phase 3 now runs unconditionally for all revisions, which is the correct behavior for local-only mode and the clean starting point for Phase 11's unified sync.

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

```
PASS: effect.is(addAnnotation) appears 0 times in yjsAnnotations.ts
PASS: hasSubtreeForRevision deleted from all src/ (production code)
PASS: No import from $lib/collab in annotationField.ts
PASS: update() method body is `return;` with Phase 10 comment
```

## Self-Check: PASSED

- [x] src/lib/collab/yjsAnnotations.ts exists and contains Phase 10 comment
- [x] Commit a6aee53 exists in git log
- [x] Commit c5e970b exists in git log
- [x] No hasSubtreeForRevision in production files
