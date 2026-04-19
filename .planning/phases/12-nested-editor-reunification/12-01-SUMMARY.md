---
plan: 12-01
title: Wire nested editor typing to annotation sync
status: complete
wave: 1
duration: 8min
started: 2026-04-19T14:00:00Z
completed: 2026-04-19T14:08:00Z
---

# Summary: Wire nested editor typing to annotation sync

## What was built

Added `nestedEditorEdit` annotation detection to the sync plugin's `update()` method. When a nested editor dispatches changes with the `nestedEditorEdit` annotation (which Phase 3's `translateAndDispatch` does), the sync plugin now recognizes this as an annotation-relevant change and triggers `diffAndReconcile`.

## Key changes

1. **Import nestedEditorEdit** - Added import from annotationField.ts (line 36)
2. **Detection in update()** - Added `hasNestedEditorEdit` check that scans transactions for the annotation (lines 257-259)
3. **Conditional trigger** - Modified the early-return condition to also check `hasNestedEditorEdit` (line 277)

## Self-Check: PASSED

```bash
bun run test:run src/lib/collab/annotation-sync.test.ts
# ✓ 13 tests passed including "nested editor typing syncs character-by-character"

bun run check
# ✓ No type errors
```

## Bug fix: Phase 3 corruption on remote rebuilds

During testing, discovered that remote annotation rebuilds were corrupting `versions[].doc`. Root cause: when `addAnnotation` effect runs (e.g., from remote sync), Phase 3 (`pushDocToVersionState`) was pulling the main doc slice into the active version, overwriting the correct text from Yjs.

**Fix:** Added revision IDs from `addAnnotation` and `_restoreAnnotation` effects to `revisionsWithExplicitEffect` set, causing Phase 3 to skip them. This preserves the correct version text that came from Yjs.

## Key files

- **Modified**: `src/lib/collab/yjsAnnotations.ts` - Added nestedEditorEdit detection
- **Modified**: `src/lib/editor/plugins/annotations/annotationField.ts` - Skip Phase 3 for remote rebuilds
- **Modified**: `src/lib/collab/annotation-sync.test.ts` - Added integration tests

## Commits

- `9a9163c :bug: fix(12-01): wire nested editor typing to annotation sync`
- `e52f4b1 :bug: fix(12): skip Phase 3 for remote annotation rebuilds`
