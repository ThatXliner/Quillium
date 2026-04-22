---
phase: 02
slug: joiner-view-hardening
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-19
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `02-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.4 + jsdom 28.1.0 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `bun run test:run src/lib/collab/joiner-view.test.ts` |
| **Full suite command** | `bun run test:run` |
| **Estimated runtime** | ~30s quick, ~3min full |

---

## Sampling Rate

- **After every task commit:** Run `bun run test:run src/lib/collab/joiner-view.test.ts`
- **After every plan wave:** Run `bun run test:run src/lib/collab/`
- **Before `/gsd-verify-work`:** Full `bun run test:run` must be green
- **Max feedback latency:** 30s

---

## Per-Task Verification Map

> Populated by planner. Each plan task gets a row.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 02-01 | 1 | JOINER-03 | — | N/A | probe | `bun run test:run src/lib/collab/probes/undoManagerEventNames.probe.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-02 | 02-01 | 1 | JOINER-01 | — | N/A | probe | `bun run test:run src/lib/collab/probes/compartmentRemoval.probe.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-03 | 02-01 | 1 | JOINER-01, JOINER-03, JOINER-05 | — | N/A | harness | `bun run test:run src/lib/collab/` | ✅ | ⬜ pending |
| 02-02-01 | 02-02 | 2 | JOINER-01 | — | N/A | unit | `bun run test:run src/lib/collab/probes/compartmentRemoval.probe.test.ts` | ✅ | ⬜ pending |
| 02-02-02 | 02-02 | 2 | JOINER-01 | — | N/A | unit | `bun run test:run src/lib/collab/` | ✅ | ⬜ pending |
| 02-03-01 | 02-03 | 2 | JOINER-03 | — | N/A | unit | `bun run test:run src/lib/collab/yjsUndo.test.ts src/lib/collab/undo-manager.test.ts` | ✅ | ⬜ pending |
| 02-04-01 | 02-04 | 2 | JOINER-02, JOINER-05 | — | N/A | unit | `bun run test:run src/lib/collab/yjsBinding.test.ts src/lib/collab/yjsBinding.convergence.test.ts` | ✅ | ⬜ pending |
| 02-04-02 | 02-04 | 2 | JOINER-02, JOINER-05 | — | N/A | unit | `bun run test:run src/lib/collab/yjsAnnotations.test.ts src/lib/collab/annotation-sync.test.ts` | ✅ | ⬜ pending |
| 02-04-03 | 02-04 | 2 | JOINER-02 | — | N/A | unit | `bun run test:run src/lib/collab/yjsAnnotations.test.ts -t "re-entrance guard"` | ✅ | ⬜ pending |
| 02-05-01 | 02-05 | 3 | JOINER-01, JOINER-02, JOINER-03, JOINER-05 | — | N/A | harness | `bun run test:run src/lib/collab/joiner-view.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/collab/joiner-view.test.ts` — new file covering JOINER-01, JOINER-03, JOINER-05 + criteria #6–#8
- [ ] `src/lib/collab/test-helpers/twoPeerHarness.ts` — add `makeJoinerPeer(clientId)` factory (mirrors `makePeerWithAnnotationSync`, installs `createYjsUndoExtension`, omits `history()`) AND `makeOwnerPeer(clientId)` factory (mirrors `makePeerWithAnnotationSync` plus `history()` for criterion #7 testing)
- [ ] `src/lib/collab/yjsAnnotations.test.ts` — extend existing file with re-entrance guard test for JOINER-02
- [ ] **Probe A1**: confirm `Y.UndoManager` event name spelling (`stack-item-added` vs `stackItemAdded`) before writing selection-restore code
- [ ] **Probe A2**: confirm `compartment.reconfigure([])` actually removes the StateField (asserts `state.field(historyField, false) === undefined`); if false, fall back to full state rebuild

No framework install needed — Vitest already wired.

---

## Requirements → Test Coverage

| Req ID | Behavior | Test Type | Command |
|--------|----------|-----------|---------|
| JOINER-01 | `state.field(historyField, false) === undefined` after joiner connect | unit | `... -t "no history field"` |
| JOINER-02 | `_syncInitialToYjs` is no-op on second call | unit (extend existing) | `bun run test:run src/lib/collab/yjsAnnotations.test.ts -t "re-entrance guard"` |
| JOINER-03 | Cmd-z immediately after joiner connect leaves doc + annotations unchanged | unit | `... -t "cmd-z post-connect"` |
| JOINER-05 | Owner has N annotations + joiner connects → joiner annotation count = N | unit (two-peer) | `... -t "no annotation duplication"` |
| Criterion #5 | `createYjsUndoExtension` is the ONLY undo mechanism on joiner (undoManager defined AND historyField undefined) | unit | `... -t "yjs undo extension wired"` |
| Criterion #6 | Joiner Cmd-z affects only joiner's edits | unit (two-peer) | `... -t "undo own edits only"` |
| Criterion #7 | Owner can undo own edits but not joiner's incoming text | unit (two-peer, owner peer w/ history) | `... -t "owner history excludes remote text"` |
| Criterion #8 | Selection restored on undo/redo | unit | `... -t "selection restored"` |

(Quick-run prefix: `bun run test:run src/lib/collab/joiner-view.test.ts`)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| (none) | | | |

*All phase behaviors have automated verification.*

---

## Property-Test Dimensions (Deferred to Phase 9)

Per RESEARCH.md, Phase 2 is scoped to surgical fixes; fuzz/property tests for
the dimensions below are deferred to Phase 9 (HARNESS-04):

- Undo determinism under random local + remote interleaving
- No-history invariant under N-operation random walk on joiner
- No-duplication invariant under random connect/disconnect cycles
- Selection-restore round-trip identity (undo then redo)

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (joiner-view.test.ts, makeJoinerPeer, makeOwnerPeer, A1/A2 probes)
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter (planner sets this)

**Approval:** pending
