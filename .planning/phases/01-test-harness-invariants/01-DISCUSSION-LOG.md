# Phase 1: Test Harness & Invariants - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-19
**Phase:** 01-test-harness-invariants
**Areas discussed:** flushAll design, property test shape, feedback-loop test, invariant comments, test location & CI, baseline green policy

---

## flushAll Primitive Design

| Option | Description | Selected |
|--------|-------------|----------|
| (a) State-vector equality loop | Drain microtasks, check `Y.encodeStateVector(a) === Y.encodeStateVector(b)`, repeat until stable with max-iteration cap | ✓ |
| (b) Fixed N microtask ticks | `for (i=0; i<5; i++) await Promise.resolve()` then assert | |
| (c) Explicit update-queue drain | Instrument update sites with a pending counter, flush until zero | |
| (d) Single `await Promise.resolve()` | Rely on synchronous `connect` + single microtask | |

**User's choice:** (a).
**Notes:** Variadic `...peers`, not hard-coded to 2. Fixed-tick hides amplification behind the budget; explicit drain is invasive; single-await breaks once nested observers land in Phase 6. State-vector-equality self-validates; max-iteration cap turns real feedback bugs into loud failures.

## Property Test Shape

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Deep structural equality of annotation node tree | Compare `yjsAnnotationToCodeMirror(yMap)` to live `annotationField` per peer | ✓ |
| (b) Canonical JSON round-trip | Serialize both sides, string-compare | |
| (c) ID-set + per-annotation field compare | Compare annotation IDs then field-by-field | |

**User's choice:** (a).
**Notes:** Driver is fast-check (already a dependency) with random local-effect sequences on both peers. Fixed scenarios supplement the property test; they do not replace it.

## Feedback-Loop Test (SYNC-06)

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Count `ydoc.on("update")` events | External counter, no instrumentation of code under test | ✓ |
| (b) Structural bound assertion | Assert one transaction per keystroke at the CM layer | |
| (c) Integration over batched typing | Batched burst, measure total updates | |

**User's choice:** (a), with single-char dispatches (not bursts).
**Notes:** Counter = test-only local variable wired via `peerA.ydoc.on("update", () => updateCount++)`. Single-char dispatches are the sensitive case; bursts hide amplification behind CM transaction coalescing. Framing shifted during discussion: the test is a **regression harness for Phase 3's rewrite**, not defense against a bug present today — current code already has the four-guard origin discipline and achieves 1 CM transaction = 1 Y update. The test catches regressions when `commands.ts` is introduced in Phase 3.

**User question:** "is this defensive programming? when will this ever happen? aren't we currently doing 1 codemirror transaction = 1 yjs event?"
**Resolution:** Current code is clean. SYNC-06 exists because Phase 3 rewrites the write path; the test is the safety net for that rewrite. Without it, a forgotten origin guard in new `commands.ts` code could cause silent O(N²) relay traffic in production.

## Invariant Comments

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Expand top-of-file comment block | Plain documentation, no enforcement | ✓ |
| (b) Runtime assertions in dev mode | Assert invariants via `if (dev) throw ...` checks | |
| (c) Greppable markers + CI lint rule | `// INVARIANT:` comments checked by custom script | |

**User's choice:** (a).
**Notes:** Comments document (i) Yjs is canonical, (ii) the four-guard origin discipline with file:line references to each guard site. Real enforcement is the property test from HARNESS-02; comments are documentation, not a gate.

## Test Location & CI Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| (a) In-module `src/lib/collab/*.test.ts` | Match existing Vitest + jsdom pattern | ✓ (for property + feedback-loop tests) |
| (b) New `tests/collab/convergence/` suite | Dedicated config | |
| (c) Mixed | Unit-style in-module, fuzz in top-level `tests/` | ✓ (fuzz in separate directory) |

**User's choice:** In-module for Phase 1 tests; **fuzz separate and `.skip`'d in CI until Phase 9**.

## Baseline Green Requirement

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Fix current code to make property test pass | Absorb any exposed bugs into Phase 1 | |
| (b) Document failures, `.skip` with TODO pointing to fixing phase | Preserve Phase 1 scope | ✓ |
| (c) Relax assertion for baseline, tighten later | Weaker signal | |

**User's choice:** (b).
**Notes:** Fixing current sync-layer bugs is scope creep into Phases 2–5. Phase 1 lands the infrastructure; `.skip` + TODO is the honest bookkeeping that doesn't hide regressions.

## Claude's Discretion

- Exact max-iteration cap value for `flushAll` (starting guess: 20).
- Whether `flushAll` lives in `twoPeerHarness.ts` (recommended: extend existing file) or a new sibling helper.
- Whether to ship an `expectConverged(...peers)` ergonomic wrapper in Phase 1 or defer to Phase 2.

## Deferred Ideas

- 10k-op fuzz (Phase 9, HARNESS-03)
- `Y.UndoManager` cross-peer validation (Phase 9, HARNESS-04)
- Two-device dogfood checklist (Phase 9, HARNESS-05)
- Runtime assertions / lint rules for origin discipline (revisit only if property test proves insufficient)
- Fixing baseline property-test failures (handled in Phase 3 or 4, not Phase 1)
