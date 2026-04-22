---
status: complete
---

# Quick Task: Revision version live edit sync

## Problem

When editing a revision version's body text during live collab, the text synced at the Y.Text layer but did not update the revision version state in the parent document's CodeMirror annotation state. As a result:

1. The inline nested editor showed the new text being typed
2. The parent document's text at the revision's selection range stayed stale
3. `versions[i].doc` in the annotation field was never updated

## Root Cause

`NestedEditorController.onNestedUpdate()` intentionally skipped both `translateAndDispatch` and `flushAnnotationStateToParent` when collab owned the subtree, assuming the main annotation sync plugin's `observeDeep` would keep state in sync. But `observeDeep` explicitly skips events with `origin === "local"` (lines 61 of `yjsAnnotations.ts`) to prevent feedback loops, so local edits from the nested editor never produced a parent-side update.

Meanwhile Phase 3 of `annotationField.update()` is skipped for revisions with Yjs subtrees (`hasSubtreeForRevision`), so `versions[i].doc` never got synced from the parent doc either.

## Fix

1. Added `_updateRevisionVersionDoc` StateEffect in `annotationField.ts` that updates ONLY `versions[i].doc` without triggering parent document changes.
2. Updated `NestedEditorController.onNestedUpdate()` to:
   - When editing the ACTIVE version: call `translateAndDispatch` to push the same changes to the parent doc (keeping the visible text and decoration range in sync) AND dispatch `_updateRevisionVersionDoc` (keeping the annotation field in sync).
   - When editing an INACTIVE version: dispatch only `_updateRevisionVersionDoc`.

## Files Changed

- `src/lib/editor/plugins/annotations/annotationField.ts` — Added `_updateRevisionVersionDoc` effect + reducer case.
- `src/lib/editor/plugins/annotations/NestedEditorController.ts` — Dispatch the new effect + parent doc changes in collab path.
- `src/lib/collab/yjsAnnotations.convergence.test.ts` — Added convergence test for revision version text editing.

## Validation

- 11 convergence tests pass (including the new revision-version-text-edit test)
- 381 collab + annotation tests pass total
