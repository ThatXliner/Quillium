# Phase 9: Fix Live Collab Revision Editing Bugs - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix cascading bugs discovered while dogfooding live-collab revision editing so the feature is dogfoodable.

In scope:
- Nested-editor typing on the active version keeps parent doc slice, `versions[i].doc`, and subtree Y.Text in sync
- Switching active version (including the first switch after initial join) preserves the annotation
- Cmd-z on joiner right after connect does NOT revert to pre-connect local doc
- Remote peer edits to inactive-version Y.Text land in `versions[i].doc` (on switch)
- No duplicate annotations after joiner initial sync
- Integration test harness exercising the full nested-editor + subtree + parent-doc flow across two peers
- Architectural fix: joiner's collab session is a SEPARATE document view — local doc is never touched

Out of scope:
- Peer cursor rendering inside nested editors (deferred per 08.5c D-98)
- Landing-relay-side broadcast bug classes (covered by tests in `../quillium-landing/relay/`)
- Any new feature work; this is a bug-fix phase

</domain>

<decisions>
## Implementation Decisions

### Room-as-View Architecture
- **D-100:** Joiner's collab session is a **separate ephemeral document view**, not a mutation of any local doc. Clicking "Join room" navigates to a collab-only view backed by the room's Y.Doc; the user's existing local documents are never read from or written to. On leave/kick/disconnect, navigate back to whatever was open before (library or prior doc).
- **D-101:** **Owner's local doc IS the room.** Owner's current doc becomes the room's initial state. Owner's edits save locally as normal during the session. When owner stops sharing, they keep the doc including any edits peers made while live.
- **D-102:** Dedup bug (#6) is dissolved by D-100: joiner has no pre-existing local annotations to collide with Yjs-seeded ones. Annotation hydration on joiner comes exclusively from Yjs. Owner's annotations were always local and just become the room's seed.

### Leave / Restore Triggers
- **D-103:** Restore-to-prior-view happens on ALL of: (a) user clicks "Leave room" / "Stop sharing", (b) owner kicks joiner (relay sends kick), (c) connection lost and reconnect retries exhausted, (d) app close during live session. Next launch after app-close-during-session must not resume in a zombie live state.

### Cmd-z Baseline
- **D-104:** Joiner's Cmd-z uses Yjs UndoManager only, with a fresh empty stack tied to this room's Yjs session. Cannot undo past the joiner's first keystroke in the room. No pre-connect history exists in the collab view (per D-100, the collab view has no prior local history). This is the simpler of the two options offered.
- **D-105:** Owner's Cmd-z continues to work via the existing Y.UndoManager setup (per 08.5c D-95). Owner's pre-"Go Live" edits remain in their stack; going live does not clear or snapshot the UndoManager.

### Test Strategy
- **D-106:** Integration tests live in `src/lib/collab/` next to existing convergence tests (e.g. `subtree-convergence.test.ts`, `version-coordination.test.ts`). New file(s) use the existing two-peer harness in `src/lib/collab/test-helpers/twoPeerHarness.ts`. No new higher-level NestedEditorController-level harness in this phase.
- **D-107:** **Test-around-wip approach.** Keep the uncommitted wip patches on `omni` branch (checkpoint commit `156f07c`) as the starting point. Write failing/passing tests that codify the desired invariants; iterate on the wip patches from there. Do NOT revert the wip and restart.
- **D-108:** Tests cover ALL invariants (user: "use your discretion. maybe everything"):
  - Parent doc slice == `versions[i].doc` == subtree Y.Text after local and remote edits on both peers (bug #1)
  - Version switch preserves annotation: decoration present, range valid, selection inside visible range (bug #2, including first-switch-after-join)
  - Joiner Cmd-z post-connect cannot revert to pre-connect state (bug #3) — validated via D-100 architecture + Yjs UndoManager behavior
  - Remote edits to inactive version land in `versions[i].doc` on switch (bug #5, lazy-snapshot per D-110)
  - No duplicate annotations after joiner initial sync (bug #6) — follows from D-100/D-102
- **D-109:** **Root-cause bisection via tests** for bug #2 (first-version-switch destroys annotation). Write failing tests targeting each suspect layer:
  1. Subtree binding lifecycle during NestedEditorController teardown/rebuild
  2. `annotationGeneration` / rebuild-signal misfiring
  3. Yjs observer race during `_syncInitialFromYjs` (queueMicrotask + observeDeep)
  Let tests point to the real cause before applying fixes. Reference: `feedback_convergence_debugging` — convergence bugs need tests at the right layer BEFORE proposing fixes.

### Subtree Subscription Strategy
- **D-110:** **Lazy** subscription to inactive version Y.Texts. Only the currently active version has a live CM observer dispatching edits into `versions[i].doc`. On version switch, read the target Y.Text's current value into `versions[targetIdx].doc` (snapshot) and attach the observer to the new active version. Trade-off: remote edits to non-active versions are not mirrored into `versions[i].doc` in real-time, but decoration is always correct on the active one. Matches the pattern of "active version is what renders inline" (08.5c D-99).

### Claude's Discretion
- Exact naming of the new test file(s) in `src/lib/collab/` — suggested: `revision-lifecycle.test.ts`, but planner may split by bug if helpful
- How D-100 is implemented at the routing/navigation layer (new route vs in-place view swap in `+page.svelte`) — planner decides based on existing navigation patterns
- Whether `_syncInitialFromYjs` is still needed under D-100, or collapses into the normal Yjs observer setup once there's no local state to merge with
- Whether any of the wip patches become obsolete after D-100 (e.g. dedup-related patches) — planner evaluates each against the new architecture
- Relay-side kick protocol design for D-103(b) — may already exist; if not, planner scopes it

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Current Implementation (direct bug sites)
- `src/lib/collab/yjsAnnotations.ts` — annotation hydration, `_syncInitialFromYjs`, observer setup
- `src/lib/collab/yjsBinding.ts` — Y.Text ↔ CodeMirror binding; used by subtrees
- `src/lib/collab/yjsUndo.ts` — Y.UndoManager construction; owner-side stack (D-105)
- `src/lib/collab/yjsProvider.ts` — ydoc setup, provider wiring
- `src/lib/collab/index.ts` — `enableCollab` orchestration; where D-100 owner-path is anchored
- `src/lib/collab/GoLiveButton.svelte` — owner entry point to the live flow
- `src/lib/collab/annotationSchema.ts` — YjsAnnotation converters; affects dedup surface
- `src/lib/editor/plugins/annotations/NestedEditorController.ts` — version switch lifecycle (bug #2 suspect #1)
- `src/lib/editor/plugins/annotations/annotationField.ts` — Phase 3 doc-text push, `_updateRevisionVersionDoc` wip effect

### Test Infrastructure
- `src/lib/collab/test-helpers/twoPeerHarness.ts` — two-peer harness this phase extends (D-106)
- `src/lib/collab/subtree-convergence.test.ts` — reference pattern for new tests
- `src/lib/collab/version-coordination.test.ts` — reference for version-switch assertions
- `src/lib/collab/recursive-mount.test.ts` — reference for nested-editor mount/unmount coverage

### Upstream Phase Context (load-bearing)
- `.planning/phases/07.5-yjs-migration/07.5-CONTEXT.md` — D-70/D-72/D-74 Yjs custom binding + per-user undo
- `.planning/phases/08-annotation-sync/08-CONTEXT.md` — D-83 unified UndoManager stack
- `.planning/phases/08.5c-crdt-nested-wiring/08.5c-CONTEXT.md` — D-90..D-99 subtree Y.Text shape, D-95 global UndoManager, D-99 activeVersionIndex is cosmetic

### Project Context
- `.planning/PROJECT.md` — Live Room model (D-55, D-57); D-100 here extends the room-as-view semantics
- `CLAUDE.md` — dogfoodable quality bar; "no backwards-compat shims" preference
- `ARCHITECTURE.md` § State Management, § The Annotation System, § Nested Editors, § Persistence — mental model for the systems being fixed

### External
- Yjs docs (https://docs.yjs.dev/) via Context7 — `Y.UndoManager` session lifecycle, observer ordering on initial sync, Y.Map delete-then-add semantics

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `twoPeerHarness.ts` — in-memory two-peer relay fixture; all Phase 9 integration tests plug in here
- `createYjsBinding(ytext)` — Y.Text ↔ CM delta binding; unchanged by this phase
- Existing convergence test patterns in `subtree-convergence.test.ts`, `convergence-edgecases.test.ts` show how to assert both-views-and-both-ytexts agreement
- `fast-check` property-based testing already in use (see `annotations.fuzz.test.ts`) — candidate for randomized edit sequences around version switches

### Established Patterns
- Origin-based loop prevention: `ydoc.transact(..., "local")` + CM `yjsAnnotationSync` annotation
- `addToHistory.of(false)` suppresses CM history capture on Yjs-originated dispatches (applied in wip patches)
- `Prec.highest` on undo keymap ensures Yjs UndoManager wins over CM historyField (applied in wip patches)
- `observeDeep` with `origin === "local"` skip — prevents self-echo on subtree observers

### Integration Points
- `enableCollab` in `src/lib/collab/index.ts` — current entry for both owner and joiner paths; D-100 likely forks here (owner stays in-place, joiner opens a new view)
- `NestedEditorController.create/destroy` — subtree binding mount/unmount; bug #2 suspect
- `annotationField` Phase 3 (doc-text push) — currently skipped for collab revisions via `hasSubtreeForRevision`; wip adds `_updateRevisionVersionDoc` effect
- Routing/navigation: `src/lib/navigation.ts` — where the joiner's separate-view trip begins/ends (D-100, D-103)

### Constraints from prior work
- Subtree Y.Text ≠ main Y.Text — distinct instances; observer wiring must be explicit per-subtree
- Yjs UndoManager `trackedOrigins: new Set(["local"])` — per-user undo (08.5c D-95); preserved
- No backwards-compat with Phase 8 wire format (08.5c D-94) — free to change shapes

</code_context>

<specifics>
## Specific Ideas

- **Room-as-view is the key insight.** User stated: "your local document should never be affected by the document you're joining (and then the state should be restored once you leave/get kicked)" — clarified further to "joining a document should basically look like a new document; once you get kicked, you just go back to whatever you were editing before." This dissolves bug #3 (cmd-z pre-connect) and bug #6 (dedup) architecturally rather than patching them.
- **Test-first bisection.** Per `feedback_convergence_debugging` memory: for bug #2, don't guess — write failing tests at each of the three suspect layers (binding lifecycle, annotationGeneration, observer race) and let the tests point to the real cause.
- **"Maybe everything"** on test coverage — aim for comprehensive invariant assertions across all 5 ROADMAP success criteria, not a minimal subset.
- **Keep wip patches.** The `omni` checkpoint (`156f07c`) contains partial fixes (`_updateRevisionVersionDoc` effect, bundled parent+version updates in onNestedUpdate, `syncFromParent` early-return in collab mode, `addToHistory.of(false)` on sync paths, `Prec.highest` undo keymap). Tests codify intent around these; refactor/remove only if proven redundant by D-100 simplification.

</specifics>

<deferred>
## Deferred Ideas

- Peer cursor rendering inside nested editors (still deferred from 08.5c D-98)
- Persistent per-room UndoManager state across sessions (D-104 keeps it session-scoped; cross-session stack is more complex and not needed for dogfoodable quality)
- Higher-level NestedEditorController-driven test harness (D-106 stays at the src/lib/collab/ level this phase)
- Merge-back flow where owner could "integrate" joiner edits into a non-live doc after session ends — out of scope; D-101 says the live session IS the doc for the owner
- Relay-side broadcast test coverage lives in `../quillium-landing/relay/` and is not extended by this phase

</deferred>

---

*Phase: 09-fix-live-collab-revision-editing-bugs*
*Context gathered: 2026-04-19*
