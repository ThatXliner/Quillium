# Phase 9: Fix Live Collab Revision Editing Bugs - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-19
**Phase:** 09-fix-live-collab-revision-editing-bugs
**Areas discussed:** Test harness & strategy, Annotation dedup on join, Cmd-z post-connect baseline, Version switch + subtree lifecycle

---

## Test harness & strategy

### Where do new Phase 9 integration tests live?

| Option | Description | Selected |
|--------|-------------|----------|
| New file in `src/lib/collab/` (Recommended) | Next to `subtree-convergence.test.ts` using two-peer harness | ✓ |
| New harness wrapping NestedEditorController | Higher-level, mounts real controllers on both peers | |
| Both — layer tests | Low-level + high-level | |

**User's choice:** New file in `src/lib/collab/`
**Notes:** Matches existing pattern; landing-relay broadcast bugs explicitly out of scope.

### How to handle uncommitted wip patches on `omni` (commit 156f07c)?

| Option | Description | Selected |
|--------|-------------|----------|
| Revert, redo test-first (Recommended) | Stash wip; write failing tests first | |
| Keep as starting point, add tests around them | Commit checkpoint, test current state | ✓ |
| Cherry-pick good parts | Review each patch individually | |

**User's choice:** Keep as starting point, add tests around them
**Notes:** Faster path; wip patches embed real progress. Planner evaluates individual patches against D-100 architecture.

### Which invariants must the new test file(s) cover?

| Option | Description | Selected |
|--------|-------------|----------|
| Parent doc slice == versions[i].doc == subtree Y.Text (Recommended) | Covers bug #1 | (all) |
| Version switch preserves annotation | Covers bug #2 | (all) |
| Joiner cmd-z cannot revert past connect | Covers bug #3 | (all) |
| Remote inactive-version edits land in versions[i].doc | Covers bug #5 | (all) |

**User's choice:** "use your discretion. maybe everything"
**Notes:** Comprehensive coverage across all 5 ROADMAP success criteria.

---

## Annotation dedup on join

### Dedup policy for joiner initial sync (Yjs-seeded vs SQLite-seeded duplicates)?

| Option | Description | Selected |
|--------|-------------|----------|
| Yjs wins, clear local before sync (Recommended) | Authoritative Yjs seed | |
| Merge by ID, Yjs overrides on conflict | Insert-or-replace | |
| Skip seed if Yjs empty, else clear-and-seed | Hybrid | |

**User's choice:** Free-text — "this shouldn't be a problem at all: your local document should never be affected by the document you're joining (and then the state should be restored once you leave/get kicked..maybe snapshot before you join)"
**Notes:** Reframed the question architecturally. Dedup is dissolved by room-as-view (D-100) — joiner never merges with local state at all.

### Snapshot / restore model

| Option | Description | Selected |
|--------|-------------|----------|
| Snapshot to memory + SQLite on connect (Recommended) | Crash-safe restore | |
| In-memory snapshot only | Lost on crash | |
| Copy-on-join: live session uses a fresh doc | Local doc never touched | |

**User's choice:** Free-text — "wait there shouldn't be a concept of 'pre-collab state' to the user because joining a document should basically look like a new document. once you get kicked, you just go back to whatever you were editing before"
**Notes:** Further refined — joiner's collab session is a SEPARATE view entirely, not a snapshot-of-same-doc. Became D-100.

### Leave / restore triggers

| Option | Description | Selected |
|--------|-------------|----------|
| User clicks Leave / Stop sharing (Recommended) | Explicit | ✓ |
| Owner kicks joiner | Relay kick | ✓ |
| Connection lost & not recovered | Auto-restore after retries | ✓ |
| App close during live session | Restore on close | ✓ |

**User's choice:** All four
**Notes:** Became D-103.

### Joining UX confirmation

| Option | Description | Selected |
|--------|-------------|----------|
| Room = separate document view (Recommended) | Navigate to collab-only view | ✓ |
| Room opens as a new tab-like document | Transient doc ID in library | |

**User's choice:** Room = separate document view
**Notes:** Became D-100.

### Owner treatment

| Option | Description | Selected |
|--------|-------------|----------|
| Owner's local doc IS the room; persists on leave (Recommended) | Asymmetric with joiner | ✓ |
| Owner also gets a fresh-view treatment | Symmetric, snapshot-and-restore | |

**User's choice:** Owner's local doc IS the room
**Notes:** Became D-101. Keeps dogfoodable flow where owner just keeps writing.

---

## Cmd-z post-connect baseline

### Cmd-z semantics in joiner's collab view (given D-100)?

| Option | Description | Selected |
|--------|-------------|----------|
| Yjs UndoManager only; fresh stack per session (Recommended) | Can't undo past first keystroke | ✓ |
| Also undoes own edits from prior sessions in same room | Persistent stack | |

**User's choice:** "whatever is simpler" → option 1
**Notes:** Became D-104. Fresh empty stack tied to session.

---

## Version switch + subtree lifecycle

### Bug #2 root-cause hypothesis to test first?

| Option | Description | Selected |
|--------|-------------|----------|
| Subtree binding lifecycle (Recommended) | NestedEditorController teardown/rebuild | |
| annotationGeneration / rebuild signal | D-97 misfire | |
| Yjs observer race during `_syncInitialFromYjs` | queueMicrotask + observeDeep | |
| All three — write tests to bisect | Let tests point to real cause | ✓ |

**User's choice:** All three — write tests to bisect
**Notes:** Became D-109. Matches `feedback_convergence_debugging` rule.

### Remote edits to inactive versions — subscription strategy?

| Option | Description | Selected |
|--------|-------------|----------|
| Eager: subscribe to all version Y.Texts on load (Recommended) | All versions tracked in real-time | |
| Lazy: only bind active; snapshot others on switch | Snapshot on version change | ✓ |

**User's choice:** Lazy
**Notes:** Became D-110. Trade-off accepted: inactive-version `versions[i].doc` not mirrored in real-time.

---

## Claude's Discretion

Captured in CONTEXT.md `<decisions>` §Claude's Discretion:
- Test file naming
- Routing/navigation implementation for D-100
- Whether `_syncInitialFromYjs` collapses under D-100
- Which wip patches survive the D-100 architectural simplification
- Relay-side kick protocol design

## Deferred Ideas

Captured in CONTEXT.md `<deferred>`:
- Peer cursors in nested editors (still)
- Persistent per-room UndoManager across sessions
- Higher-level NestedEditorController harness
- Owner "merge-back" flow
- Relay-side broadcast test coverage
