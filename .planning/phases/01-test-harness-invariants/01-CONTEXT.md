# Phase 1: Test Harness & Invariants - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Land the deterministic two-peer test substrate and canonical-source invariants **before any sync-layer rewrite begins**. Every later phase (2–9) depends on this infrastructure to assert correctness. No sync behavior changes in Phase 1 — only tests, helpers, and invariant documentation.

Covers: HARNESS-01, HARNESS-02, SYNC-06.

</domain>

<decisions>
## Implementation Decisions

### Flush primitive
- **D-01:** `flushAll(...peers)` is variadic (accepts N peers, not hard-coded 2) and is the **only** flush primitive used by two-peer convergence tests.
- **D-02:** Convergence detection = **state-vector equality loop**: drain microtasks (e.g., `await Promise.resolve()`), then check `Y.encodeStateVector(a) === Y.encodeStateVector(b)` for every peer pair; repeat until stable. Include a max-iteration cap (e.g., 20) to surface real feedback bugs as a loud failure instead of an infinite loop.
- **D-03:** Rejected alternatives: fixed-N microtask ticks (hides amplification behind the tick budget), explicit update-queue drain (invasive instrumentation, counter itself is a correctness risk), single `await` (too fragile once nested observers land in Phase 6).

### Convergence property test (HARNESS-02)
- **D-04:** Assertion shape = **deep structural equality** of the annotation node tree produced by `yjsAnnotationToCodeMirror(yMap)` versus the live `annotationField` state, per peer, after `flushAll`.
- **D-05:** Test driver = **fast-check** property-based testing (already a dependency) with random local-effect sequences on both peers. Fixed-scenario tests are supplementary, not the primary assertion.

### Feedback-loop test (SYNC-06)
- **D-06:** Test probe = count `ydoc.on("update", ...)` events on peer A during test. Type N single-char dispatches into peer A's view, then `flushAll`, then assert `updateCount <= N`.
- **D-07:** Keystroke granularity = **single-char dispatches**, not batched bursts. Bursts hide amplification behind CodeMirror's transaction coalescing; single chars are the sensitive case.
- **D-08:** Framing: this test is a **regression harness for the Phase 3 rewrite** (`commands.ts` introduction), not a defense against a bug present today. Current code (`yjsAnnotations.ts:74`, `yjsBinding.ts:39`, `yjsAnnotations.ts:254`) already has the four-guard origin discipline and achieves 1 CM transaction = 1 Y update. The test exists so that when Phase 3 rewrites the write path, a forgotten origin guard fails loudly at CI time rather than silently in prod as O(N²) relay traffic.

### Invariant comments (SC 4)
- **D-09:** Expand the top-of-file comment block in `yjsAnnotations.ts` to declare: (a) Yjs is canonical, `annotationField` is the derived projection; (b) the four-guard origin discipline (the two `origin === "local"` skips + the two `yjsAnnotationSync` annotation checks), with file:line references to each guard site.
- **D-10:** No runtime assertions and no lint/grep CI rule in Phase 1. The property test from HARNESS-02 is the real enforcement mechanism; the comments are documentation, not a gate.

### Test location & CI strategy
- **D-11:** Convergence property test and feedback-loop test live alongside existing collab suites (`src/lib/collab/*.test.ts`, Vitest + jsdom), matching the current pattern.
- **D-12:** Fuzz tests (Phase 9's 10k-op convergence fuzz, and any exploratory property tests that run long) live in a **separate directory** (e.g., `tests/collab/convergence/` or `src/lib/collab/fuzz/`) and are `.skip`'d in CI until Phase 9 green-lights them. Phase 1's property test is *not* the fuzz test — it runs in CI.

### Baseline green requirement
- **D-13:** If the Phase 1 convergence property test fails against current code, mark the failing case `.skip` with a TODO comment referencing the fixing phase (most likely Phase 3 or 4). Do **not** fix current sync-layer bugs inside Phase 1 — that's scope creep into Phases 2–5. The baseline-green requirement applies to whatever subset passes; regressions are what matter going forward.

### Claude's Discretion
- Max-iteration cap value for `flushAll` (20 is a reasonable starting guess; adjust if legitimate nested-observer scenarios need more).
- Exact file layout within `src/lib/collab/test-helpers/` for the new `flushAll` export — extend `twoPeerHarness.ts` or new sibling file.
- Whether to also write a small helper `expectConverged(...peers)` that wraps `flushAll` + the structural equality assertion, for ergonomics across Phase 2–9 tests.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone requirements
- `.planning/REQUIREMENTS.md` §HARNESS, §SYNC — HARNESS-01/02, SYNC-06 are this phase's scope
- `.planning/ROADMAP.md` §"Phase 1: Test Harness & Invariants" — success criteria 1–4

### Research (v1.1 synthesis)
- `.planning/research/SUMMARY.md` — executive summary; the dual-source-of-truth root cause and the CRDT-as-root pattern rationale
- `.planning/research/ARCHITECTURE.md` — Pattern 1 (derived state), Pattern 4 (y-prosemirror `ySyncPlugin` blueprint), Pattern 7c (atomic dual-write)
- `.planning/research/PITFALLS.md` — amplification / feedback-loop failure modes, origin-discipline pitfalls
- `.planning/research/STACK.md` — why `y-codemirror.next` was rejected; library baseline

### Existing code to extend (not rewrite in Phase 1)
- `src/lib/collab/test-helpers/twoPeerHarness.ts` — existing `Peer`, `makePeer`, `makePeerWithAnnotationSync`, `connect`, `teardown`; `flushAll` extends this module
- `src/lib/collab/yjsAnnotations.ts` — invariant comments land here (top of file); already has partial comments and the four guard sites
- `src/lib/collab/yjsBinding.ts` — referenced by origin-discipline comment (one of the four guards)
- `src/lib/collab/annotationSchema.ts` — `yjsAnnotationToCodeMirror` is the projection function the property test inverts against

### Related existing tests (patterns to match)
- `src/lib/collab/yjsBinding.convergence.test.ts` — existing convergence style; reference for new property test shape
- `src/lib/collab/thread-append.test.ts` — two-peer merge assertion pattern
- `src/lib/collab/main-text-sync.test.ts` — peer-to-peer text sync pattern

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`twoPeerHarness.ts`** — Already provides `Peer` interface, `makePeer(clientId, initialText)`, `makePeerWithAnnotationSync(clientId, initialText)`, and `connect(a, b)` that synchronously pipes updates with `"remote"` origin. `flushAll` extends this file; **do not rewrite** `connect` or the peer factories.
- **`fast-check` 4.6.0** — Already a dependency. Use for the property test driver; no new library needed.
- **`Y.encodeStateVector`** — Yjs API already imported throughout; canonical convergence-detection primitive.
- **Existing convergence tests** (`yjsBinding.convergence.test.ts`, `thread-append.test.ts`) — reference pattern for `disconnect()` teardown in `afterEach`, `beforeEach` peer construction.

### Established Patterns
- **Origin discipline (already enforced in current code):** (1) `yjsBinding.ts:39` skips observer dispatch when `yTransaction.origin === "local"`; (2) `yjsAnnotations.ts:74` same for annotation observer; (3) `yjsAnnotations.ts:254` skips CM-side when transaction carries `yjsAnnotationSync` annotation; (4) `yjsBinding.ts:77` same pattern on Y.Text write side. The four-guard shape is what the invariant comments document.
- **Microtask deferral (current):** Observers in `yjsAnnotations.ts:195, 227` use `queueMicrotask` to dispatch CM transactions; this is why fixed-tick flushing is fragile and state-vector-equality flushing is necessary.
- **`"remote"` origin convention:** `connect()` in the harness applies updates with origin `"remote"`; any new piping must preserve this to keep observer skips correct.
- **Vitest + jsdom:** All collab tests run in jsdom via Vitest. `EditorView` constructs with `parent: document.body`. Phase 1 tests follow the same pattern.

### Integration Points
- **`flushAll` export:** Exported from `src/lib/collab/test-helpers/twoPeerHarness.ts` (extend existing file; avoid module proliferation).
- **Property test location:** New file `src/lib/collab/convergence-projection.test.ts` (or similar) — sibling of existing `.convergence.test.ts` files so CI picks it up automatically.
- **Feedback-loop test location:** New file `src/lib/collab/feedback-loop.test.ts` — same directory pattern.
- **Fuzz directory (empty until Phase 9):** Create `src/lib/collab/fuzz/` (or `tests/collab/fuzz/`) with a `.vitest-ignore`-style exclusion or `describe.skip` wrapper. Decision on exact CI exclusion mechanism deferred to planner.

</code_context>

<specifics>
## Specific Ideas

- Pattern reference for `flushAll`: y-prosemirror's test utilities and BlockSuite's sync test helpers — both use state-vector-equality loops with microtask drains. Not a library dependency; just the shape.
- The feedback-loop test should name-check "amplification" in its failure message so a future dev hitting the regression immediately knows what's meant.
- Invariant comments in `yjsAnnotations.ts` should reference the four guard sites by file:line so readers can jump directly; update the refs if line numbers drift during Phase 3.

</specifics>

<deferred>
## Deferred Ideas

- **10k-op convergence fuzz** — Phase 9 scope (HARNESS-03). Phase 1 only creates the fuzz directory structure and skip-pattern; the fuzz itself is Phase 9.
- **`Y.UndoManager` cross-peer validation** — Phase 9 (HARNESS-04).
- **Two-device dogfood checklist** — Phase 9 (HARNESS-05).
- **Runtime assertions / lint rules for origin discipline** — Not adopted in Phase 1. Revisit only if the property test proves insufficient during Phases 3–5.
- **Fixing baseline property-test failures on current code** — Out of scope. Failures get `.skip` + TODO pointing to the phase that will fix them (likely Phase 3 or 4).
- **`expectConverged(...peers)` ergonomic wrapper** — Optional; planner's call whether to include in Phase 1 or defer to Phase 2 when multiple call sites exist.

</deferred>

---

*Phase: 01-test-harness-invariants*
*Context gathered: 2026-04-19*
