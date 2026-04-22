---
phase: 11-unified-subtree-sync-rebuild
plan: 03
status: complete
duration: 3min
started: 2026-04-19T13:39:00Z
completed: 2026-04-19T13:41:00Z
---

## What was built

Basic annotation sync integration tests proving the diff-and-reconcile write path works:

1. **Comment sync tests** (3 tests):
   - Owner creates comment, joiner sees it
   - Joiner creates comment, owner sees it
   - Comment deletion syncs between peers

2. **Revision creation test** (1 test):
   - Owner creates revision, joiner sees version text

3. **Initial sync tests** (2 tests):
   - Joiner sees owner pre-existing annotations on connect
   - Owner sees joiner pre-existing annotations on connect

## Key patterns

- Tests use `await queueMicrotask` for Yjs sync propagation
- Helper functions `createComment()` and `createRevision()` build test fixtures
- Tests verify both selection positions and annotation type via `isAnnotationOfType`

## Self-Check: PASSED

- [x] Comment sync tests pass (3 tests)
- [x] Revision creation test passes (1 test)
- [x] Initial sync tests pass (2 tests)
- [x] Total: 6 passing tests

## Commit

4bb8623 :white_check_mark: test(11-03): implement basic annotation sync tests

## Key files

### Modified
- src/lib/collab/annotation-sync.test.ts (+163 lines)
