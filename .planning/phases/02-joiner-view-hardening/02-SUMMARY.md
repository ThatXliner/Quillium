---
phase: 02
slug: joiner-view-hardening
status: complete
completed: 2026-04-22
plans_completed: 5
---

# Phase 02 Summary — Joiner View Hardening

Completed 2026-04-22.

## Outcome

Freshly-connected joiners now enter collab with a clean editor state:

- Joiner views do not install CodeMirror `history()`.
- Joiner initial annotation state starts empty before Yjs observer hydration.
- Owner initial annotation seeding is re-entrance guarded.
- Post-connect undo does not revert pre-connect state.
- Owner annotations hydrate once on join, without duplicate annotations.

## Plans Completed

- `02-01` — Wave 0 probes and joiner/owner harness factories.
- `02-02` — `historyCompartment` and joiner `enableCollab` branch.
- `02-03` — selection restore for Yjs undo/redo.
- `02-04` — remote text history exclusion, initial sync guard, observer catch-up, thread shrink sync.
- `02-05` — end-to-end joiner hardening test suite.

## Dogfood Fixes Landed After Phase Plans

While validating PR #200 behavior on `omni-fixes`, additional sync regressions were fixed:

- Joiners no longer see a blank document after connecting to an owner document.
- Revision annotation ranges are refreshed in Yjs after local document/range changes.
- Annotation decorations render on first join/first render instead of waiting for an interaction.
- Inline nested editor decorations survive parent revision version switches and version creation.
- Nested editor state handles annotation-only version blobs without repeated missing-selection warnings.
- Version transition paths flush nested annotation state before switching versions, avoiding stale nested decoration blobs.

## Verification

- `bun run test:e2e tests/e2e/inlineNestedDecorations.pw.ts` passed.
- `bun run test:run src/lib/collab/annotation-sync.test.ts tests/integration/nestedEditor.nestedAnnotations.test.ts tests/integration/nestedAnnotations.test.ts tests/integration/nestedEditor.undoRedo.test.ts` passed: 105 tests.
- `bun run check` passed with 0 errors and the existing 14 warnings.
- `bunx biome lint ...` passed on touched files.
- `git diff --check` passed.
