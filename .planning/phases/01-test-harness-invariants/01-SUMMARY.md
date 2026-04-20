---
phase: 1
plan: 1
title: flushAll helper + canonical-source invariant comments
status: complete
completed_at: 2026-04-19
---

# Plan 01 Summary

## What was built

- Added `flushAll(...peers)` and `FLUSH_ALL_MAX_ITERATIONS = 20` to `src/lib/collab/test-helpers/twoPeerHarness.ts`. State-vector-equality based, variadic, throws a loud named error on cap exceedance.
- Replaced the top-of-file comment block in `src/lib/collab/yjsAnnotations.ts` with a CANONICAL-SOURCE INVARIANT section + FOUR-GUARD ORIGIN DISCIPLINE section, with `file:line` references for all four guard sites (yjsBinding.ts:39, yjsAnnotations.ts:74, yjsAnnotations.ts:254, yjsBinding.ts:77). Preserved prior role/dependency notes.

## Verification

- `bun run check`: pre-existing 71 errors, none introduced by these edits (modified files are clean).
- `bunx biome lint` on the two modified files: clean (0 errors).
- `bun run test:run src/lib/collab/yjsBinding.convergence.test.ts src/lib/collab/annotation-sync.test.ts`: 19 passed.

## Acceptance criteria

All grep checks from PLAN.md pass:
- `flushAll` exported (1 match)
- `FLUSH_ALL_MAX_ITERATIONS = 20` (1 match)
- `Y.encodeStateVector` (2 matches)
- `amplification or feedback loop` (1 match)
- All five existing exports intact
- `CANONICAL-SOURCE INVARIANT`, `FOUR-GUARD ORIGIN DISCIPLINE`, `Yjs is canonical`, derived projection text, all four `Guard N --` lines all present
- `yjsAnnotationSync = Annotation.define` unchanged
