# Phase 8: Annotation Sync - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-17
**Phase:** 08-annotation-sync
**Areas discussed:** Undo Integration

---

## Undo Integration

### Question 1: Thread deletion on undo

| Option | Description | Selected |
|--------|-------------|----------|
| Delete entire thread | Undo removes the comment + all replies. Simple mental model. | ✓ |
| Orphan the replies | Comment deleted, but replies remain as orphans. | |
| Block the undo | Can't undo once someone else interacted with annotation. | |

**User's choice:** Delete entire thread
**Notes:** Simple mental model wins — "undo my action" means the thing I created is gone.

---

### Question 2: Suggestion acceptance undoable

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, undoable | Accepting a suggestion is reversible, suggestion reappears. | ✓ |
| No, acceptance is final | Once accepted, suggestion is consumed and gone. | |

**User's choice:** Yes, undoable
**Notes:** None

---

### Question 3: Version switches undoable

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, undoable | Switching active version tracked in undo stack. | ✓ |
| No, navigation only | Version switch is like scrolling, not an edit. | |

**User's choice:** Yes, undoable
**Notes:** Matches current local behavior.

---

### Question 4: Undo stack scope

| Option | Description | Selected |
|--------|-------------|----------|
| Single unified stack | One stack for text + annotations interleaved by time. | ✓ |
| Separate stacks | Independent undo for text vs annotations. | |

**User's choice:** Single unified stack
**Notes:** Simpler mental model, matches current local behavior.

---

## Claude's Discretion

- Yjs data structure design (Y.Map schema, nesting strategy)
- Position tracking implementation details
- Conflict resolution strategy (Yjs natural merge)
- Annotation ID collision avoidance

## Deferred Ideas

- Offline queue with annotation sync — Phase 9
- Per-annotation permissions — v2
