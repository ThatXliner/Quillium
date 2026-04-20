---
phase: 11-unified-subtree-sync-rebuild
plan: 01
status: complete
duration: 8min
started: 2026-04-19T13:34:00Z
completed: 2026-04-19T13:37:00Z
---

## What was built

Test infrastructure for Phase 11 annotation synchronization:

1. **AnnotationIdMap.getOrCreateYjsId** — Inverse mapping method that generates Yjs IDs for CM annotation IDs, completing the bidirectional ID mapping required for diff-and-reconcile.

2. **makePeerWithAnnotationSync** — Extended twoPeerHarness with a new peer factory that includes createAnnotationSyncPlugin, enabling annotation sync integration tests.

3. **annotation-sync.test.ts** — 12 it.todo scaffolds organized into 4 describe blocks matching Phase 11 success criteria:
   - Comment sync (3 tests): create, reverse create, deletion
   - Revision sync (5 tests): create, concurrent typing, version switch, add/delete version
   - Thread sync (2 tests): append, concurrent appends
   - Initial sync (2 tests): joiner sees owner, owner sees joiner

## Key decisions

- Used local helper functions `createComment()` and `createRevision()` in test file rather than importing from models.ts (which only exports `createNewAnnotation`)
- Cast `ymap` to `Y.Map<unknown>` in return to satisfy Peer interface while maintaining strong typing for createAnnotationSyncPlugin

## Self-Check: PASSED

- [x] AnnotationIdMap has getOrCreateYjsId(cmId, clientId) method
- [x] twoPeerHarness exports makePeerWithAnnotationSync
- [x] annotation-sync.test.ts has 12 it.todo scaffolds
- [x] All tests run without errors (todos are skipped)
- [x] Main text sync tests still pass (7/7)

## Commit

83ca71a :white_check_mark: test(11-01): scaffold annotation sync tests and extend harness

## Key files

### Created
- src/lib/collab/annotation-sync.test.ts

### Modified
- src/lib/collab/annotationSchema.ts (getOrCreateYjsId)
- src/lib/collab/test-helpers/twoPeerHarness.ts (makePeerWithAnnotationSync)
