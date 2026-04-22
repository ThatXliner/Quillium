---
phase: 1
plan: 3
status: complete
---

# Plan 03 Summary — Feedback-loop test + fuzz dir scaffold

## What was built

- **`src/lib/collab/feedback-loop.test.ts`** — SYNC-06 regression harness. Types N=20 single-char dispatches into peer A's view (with a microtask yield per keystroke to let any synchronous observer chain run), then uses `flushAll(peerA, peerB)` to reach convergence, and asserts peer A's `ydoc` emitted `<= N` Yjs `update` events. The assertion message contains the literal word `amplification` so a future regression announces its own failure mode. Connect-time initial sync is drained with an upfront `flushAll` before the update listener is attached, so only user-driven updates are counted.

- **`src/lib/collab/fuzz/`** — New directory scaffolded with `.gitkeep` and a `README.md` describing Phase 9 residency (HARNESS-03 10k-op fuzz, HARNESS-04 cross-peer undo, HARNESS-05 two-device dogfood), the `*.fuzz.test.ts` / `describe.skip(...)` CI-exclusion conventions, and the delineation from the Phase 1 property test in `convergence-projection.test.ts`. No `*.ts` files added.

## Verification

- `bun run test:run src/lib/collab/feedback-loop.test.ts` — 1 passed (expected per D-08; current code already enforces the four-guard origin discipline).
- `bun run test:run src/lib/collab/feedback-loop.test.ts src/lib/collab/convergence-projection.test.ts` — 2 passed (Phase 1 suite green together).
- `bunx @biomejs/biome lint` on the new test file and README — no lint errors in new files.
- `bun run check` and `bun run lint` pre-existing errors (71 check, many lint) are unchanged by this plan — no new errors introduced in `feedback-loop.test.ts` or the fuzz scaffold.

## Acceptance criteria

- [x] `src/lib/collab/feedback-loop.test.ts` exists.
- [x] Failure message contains `amplification regression`.
- [x] `flushAll` imported and called (used for initial drain + post-typing drain).
- [x] `peerA.ydoc.on("update", ...)` listener attached after initial drain.
- [x] `toBeLessThanOrEqual(N)` assertion present.
- [x] `src/lib/collab/fuzz/` directory exists with `.gitkeep` + `README.md`.
- [x] README mentions `HARNESS-03`, `Phase 9`, and the `*.fuzz.test.ts` convention.
- [x] Zero `*.ts` files in `src/lib/collab/fuzz/`.
- [x] Feedback-loop test passes on current code (expected per D-08).
