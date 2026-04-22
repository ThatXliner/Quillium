---
phase: 08-annotation-sync
plan: "05"
subsystem: collab
tags: [yjs, annotations, sync, wiring, integration]
dependency_graph:
  requires: [08-01, 08-02, 08-03, 08-04]
  provides: [annotation-sync-wired, ymap-in-provider, unified-undo]
  affects: [src/lib/collab/index.ts, src/lib/collab/yjsProvider.ts, src/lib/collab/yjsUndo.ts]
tech_stack:
  added: []
  patterns: [barrel-reexport, generic-type-parameter]
key_files:
  created: []
  modified:
    - src/lib/collab/yjsProvider.ts
    - src/lib/collab/index.ts
    - src/lib/collab/yjsUndo.ts
decisions:
  - "Made createYjsUndoExtension generic (<T>) to allow Y.Map<YjsAnnotation> assignment without widening to unknown"
metrics:
  duration: "149s"
  completed: "2026-04-18"
  tasks_completed: 3
  files_modified: 3
---

# Phase 08 Plan 05: Collab Wiring Summary

**One-liner:** Wired Y.Map annotation sync and unified undo into enableCollab by integrating yjsProvider ymap, createAnnotationSyncPlugin, and updated createYjsUndoExtension.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add Y.Map to yjsProvider.ts | 2a910b4 | src/lib/collab/yjsProvider.ts |
| 2 | Wire annotation sync into index.ts enableCollab | 1d4f14d | src/lib/collab/index.ts |
| 3 | Update barrel exports in index.ts | dfa7c4e | src/lib/collab/index.ts, src/lib/collab/yjsUndo.ts |

## What Was Built

- `yjsProvider.ts`: Added `ymap: Y.Map<YjsAnnotation>` to `YjsProviderResult` interface and `createYjsProvider` return. The map is created via `ydoc.getMap<YjsAnnotation>("annotations")` using the same `ydoc` instance as `ytext`, ensuring both share the same Yjs document and UndoManager scope.

- `index.ts` (`enableCollab`): Destructures `ymap` from `createYjsProvider`, passes it to `createYjsUndoExtension(ytext, ymap)` (D-83 unified undo), creates `annotationSync = createAnnotationSyncPlugin(ytext, ymap, clientID)`, and includes it in `collabCompartment.reconfigure([binding, undoExt, awarenessExt, annotationSync])`.

- `index.ts` (barrel exports): Added re-exports for `YjsAnnotation` type, `yjsAnnotationSync`/`createAnnotationSyncPlugin`, `absoluteToRelative`/`relativeToAbsolute`, and `codeMirrorToYjsAnnotation`/`yjsAnnotationToCodeMirror`/`AnnotationIdMap`/`generateAnnotationId`.

- `yjsUndo.ts`: Made `createYjsUndoExtension` generic (`<T = unknown>`) so `Y.Map<YjsAnnotation>` is assignable without TypeScript invariance error.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript invariance error in createYjsUndoExtension**
- **Found during:** Task 3 type check
- **Issue:** `Y.Map<YjsAnnotation>` was not assignable to `Y.Map<unknown>` due to TypeScript's invariant treatment of generic type parameters on Y.Map. This caused a type error when passing `ymap` to `createYjsUndoExtension(ytext, ymap)`.
- **Fix:** Made `createYjsUndoExtension` generic (`<T = unknown>`) with parameter `ymap?: Y.Map<T>`. The internal `trackedTypes` array uses `(Y.Text | Y.Map<T>)[]`. Callers passing `Y.Map<YjsAnnotation>` now infer `T = YjsAnnotation` automatically.
- **Files modified:** `src/lib/collab/yjsUndo.ts`
- **Commit:** dfa7c4e

## Verification

- `bun run check`: No new errors introduced (pre-existing errors in unrelated files remain)
- `bun run test:run src/lib/collab/`: 144/144 tests pass across 13 test files

## Known Stubs

None.

## Threat Flags

None — this plan introduces no new trust boundaries, only wires existing components together.

## Self-Check: PASSED

- [x] src/lib/collab/yjsProvider.ts modified with ymap
- [x] src/lib/collab/index.ts modified with annotation sync
- [x] src/lib/collab/yjsUndo.ts modified with generic
- [x] Commits 2a910b4, 1d4f14d, dfa7c4e exist in git log
- [x] 144 collab tests pass
