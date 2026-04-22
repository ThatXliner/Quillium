---
phase: 11-unified-subtree-sync-rebuild
plan: 02
status: complete
duration: 5min
started: 2026-04-19T13:37:00Z
completed: 2026-04-19T13:39:00Z
---

## What was built

Diff-and-reconcile write path from CodeMirror annotationField to Yjs Y.Map:

1. **update()** — Detects annotation effects in transactions, skips when yjsAnnotationSync annotation is present (prevents infinite loops), calls diffAndReconcile.

2. **diffAndReconcile()** — Compares CM state to Yjs state:
   - Remove from Yjs: annotations in Yjs but not in CM
   - Add to Yjs: annotations in CM but not in Yjs
   - Update existing: sync mutable fields for annotations in both

3. **syncAnnotationFields()** — Syncs thread (append-only Y.Array) and revision-specific fields (activeVersionIndex, versions map).

4. **syncRevisionVersions()** — Add/delete/update revision versions, delegates text sync to syncVersionText.

5. **syncVersionText()** — Character-level diff using prefix/suffix matching for CRDT-friendly minimal edits.

## Key decisions

- All Yjs writes use `"local"` origin so observeDeep ignores them
- Skip early when no annotation effects present (optimization for pure text edits)
- Thread sync is append-only: if CM has more messages, push the new ones
- Version text uses character-level diff to preserve CRDT edit history

## Self-Check: PASSED

- [x] update() method has diff-and-reconcile logic (not empty return)
- [x] diffAndReconcile method compares CM state to Yjs state
- [x] Additions, deletions, and updates all write to Yjs Y.Map
- [x] Character-level syncVersionText preserves CRDT history
- [x] Type check passes (no errors in yjsAnnotations.ts)
- [x] Existing collab tests pass (156 passed)

## Commit

4cada14 :sparkles: feat(11-02): implement diff-and-reconcile CM→Yjs write path

## Key files

### Modified
- src/lib/collab/yjsAnnotations.ts (+222 lines)
  - Added clientId field
  - Replaced empty update() with full implementation
  - Added diffAndReconcile, syncAnnotationFields, syncRevisionVersions, syncVersionText methods
