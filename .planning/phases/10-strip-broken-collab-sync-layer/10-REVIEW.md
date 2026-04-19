---
phase: 10-strip-broken-collab-sync-layer
reviewed: 2026-04-19T10:15:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - src/lib/collab/yjsAnnotations.ts
  - src/lib/collab/index.ts
  - src/lib/editor/plugins/annotations/annotationField.ts
  - src/lib/editor/plugins/annotations/nestedEditor.ts
  - src/lib/editor/plugins/annotations/NestedEditorController.ts
  - src/lib/editor/plugins/annotations/Revision.svelte
  - src/lib/editor/plugins/annotations/RevisionModal.svelte
  - src/lib/collab/test-helpers/twoPeerHarness.ts
  - src/lib/collab/main-text-sync.test.ts
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-04-19T10:15:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Phase 10 stripped the broken collab sync layer, primarily removing nested editor subtree bindings and disabling the CM-to-Yjs annotation write path. The code removal appears complete and correct. Most files have appropriate "Phase 10" or "Plan 8.5c" comments documenting the intentional removal and deferral to Phase 11.

Key observations:
- The write path in `yjsAnnotations.ts` is properly disabled (empty `update()` method)
- Nested editor creation no longer attempts collab subtree binding
- Test files correctly skip write-path-dependent tests with `it.skip()`
- `_updateRevisionVersionDoc` StateEffect is defined but no longer used (dead code from collab mode)

One unused import was found, and there is dead code that should be cleaned up.

## Warnings

### WR-01: Unused import `annotationsChanged` in Revision.svelte

**File:** `src/lib/editor/plugins/annotations/Revision.svelte:30`
**Issue:** The `annotationsChanged` function is imported but never used in the component. This appears to be leftover from a removed $effect that may have used it for collab mode rebuild detection.
**Fix:**
```diff
import {
    annotationField,
-   annotationsChanged,
    createNewRevision,
    deleteRevisionVersion,
    isAnnotationOfType,
```

## Info

### IN-01: Dead code - `_updateRevisionVersionDoc` StateEffect

**File:** `src/lib/editor/plugins/annotations/annotationField.ts:212-216`
**Issue:** The `_updateRevisionVersionDoc` StateEffect is defined and handled in the annotationField reducer (lines 684-700), but no code dispatches this effect. It was designed for collab mode where nested editors update version docs without parent doc changes. With collab subtree bindings removed in Phase 10, this effect is currently unused.
**Fix:** This can be left for now if Phase 11 will reuse it. Otherwise, remove the effect definition and reducer case. Consider adding a TODO comment:
```typescript
/**
 * Collab-mode effect: updates ONLY versions[i].doc without triggering parent
 * doc changes. Used by NestedEditorController when collab owns the subtree
 * Y.Text -- the nested editor's content is authoritative, and we just need to
 * keep the parent's annotation state in sync for UI rendering.
 *
 * TODO(Phase 11): This effect is currently unused after Phase 10 removed
 * collab subtree bindings. Re-enable or remove based on Phase 11 design.
 */
```

### IN-02: "Plan 8.5c" comments reference future work

**File:** Multiple files
**Issue:** Several files contain "Plan 8.5c-01" and "Plan 8.5c-02" comments referencing collab subtree sync features that are now disabled. These are informational and do not affect correctness, but should be updated in Phase 11 when the sync path is rebuilt.

Files with these comments:
- `src/lib/collab/store.ts:14`
- `src/lib/collab/index.ts:204,210`
- `src/lib/collab/yjsAnnotations.ts:5`
- `src/lib/collab/types.ts:56-57`
- `src/lib/collab/annotationSchema.ts:13`
- `src/lib/editor/plugins/annotations/Revision.svelte:343,373`

**Fix:** No action required for Phase 10. Phase 11 should update or remove these comments as the sync path is rebuilt.

---

_Reviewed: 2026-04-19T10:15:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
