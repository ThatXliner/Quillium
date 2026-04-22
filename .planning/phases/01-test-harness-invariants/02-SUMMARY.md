---
phase: 1
plan: 2
status: complete
---

# What was built

Added `src/lib/collab/convergence-projection.test.ts`, a fast-check property
test enforcing the HARNESS-02 / Phase 1 SC-2 canonical-source contract:

  `yjsAnnotationToCodeMirror(peer.ymap) === peer.view.state.field(annotationField)`

after every `flushAll(peerA, peerB)`.

Key choices:
- Uses `flushAll` and `makePeerWithAnnotationSync` from Plan 01's harness primitive.
- Maps Yjs string IDs back to CodeMirror numeric IDs via `peer.idMap` so the
  projection from Yjs and the live `annotationField` snapshot are keyed
  identically before deep-equality.
- Normalizes both sides (sorted keys, recursive) so deep-equal does not flake
  on insertion order.
- Phase 1 effect surface intentionally small: text-type and delete only. Phase
  9 fuzz expands this to annotation create/remove. Per D-13, real sync-layer
  bugs that surface here would be `.skip`'d with `TODO(phase-N):` rather than
  fixed in this plan; no skips were required against the current code.

# Verification

- `bun run test:run src/lib/collab/convergence-projection.test.ts` -> 1 passed.
- `bun run check` -> 71 errors, identical to pre-existing baseline; zero new
  errors in `src/lib/collab/convergence-projection.test.ts`.
- `bunx @biomejs/biome lint src/lib/collab/convergence-projection.test.ts` -> clean.
- Existing collab convergence tests still pass:
  `yjsBinding.convergence.test.ts`, `annotation-sync.test.ts`,
  `thread-append.test.ts` -> 20 passed, 3 skipped (pre-existing).

# Acceptance criteria

- [x] File `src/lib/collab/convergence-projection.test.ts` exists.
- [x] Imports `* as fc from "fast-check"`.
- [x] Imports `flushAll` (and other helpers) from `./test-helpers/twoPeerHarness`;
      `flushAll` appears in import + call sites (>= 2 matches).
- [x] `yjsAnnotationToCodeMirror` referenced in import + call inside `projectFromYjs`.
- [x] `annotationField` referenced in import + state-field read.
- [x] `fc.assert` + `fc.asyncProperty` both present.
- [x] `bun run check` exits with no new errors in modified files.
- [x] `bun run test:run src/lib/collab/convergence-projection.test.ts` exits 0
      (passes; no skips needed against current code).
