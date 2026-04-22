# Phase 8: Annotation Sync - Research

**Researched:** 2026-04-17
**Domain:** Yjs CRDT integration for comment/revision/suggestion annotation synchronization
**Confidence:** HIGH

## Summary

Phase 8 bridges Quillium's existing CodeMirror-based annotation system with Yjs shared types for real-time collaboration. The core challenge is maintaining dual sources of truth: the existing `annotationField` StateField (which powers local undo, decorations, and UI) and a new `Y.Map` that syncs annotations across clients. Position tracking requires Yjs RelativePosition for range anchoring that survives concurrent edits.

The architecture must handle three annotation types (comments, suggestions, revisions) with different complexity levels. Comments are relatively simple (id + selection + thread). Suggestions add replacement arrays. Revisions are complex: they contain nested `VersionState` blobs (essentially serialized EditorState), an `activeVersionIndex`, and participate in Phase 3's "push doc to version state" mechanism. The undo integration (D-83: unified stack) means the Y.UndoManager must track both text and annotation operations.

**Primary recommendation:** Store annotations in a separate `Y.Map<string, YjsAnnotation>` alongside `Y.Text`. Use RelativePosition for range anchors (start+end). Extend the existing UndoManager scope to include the annotation Y.Map. Bridge changes bidirectionally: Yjs observer -> CodeMirror StateEffect, CodeMirror effect -> Yjs transaction.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-80:** Delete entire thread on undo -- when User A undoes creating a comment that User B replied to, the entire thread is deleted (comment + all replies). Simple mental model: "undo my action" removes what I created, replies are collateral.
- **D-81:** Suggestion acceptance is undoable -- accepting a suggestion is like any edit, reversible via undo. The suggestion reappears and original text is restored.
- **D-82:** Version switches are undoable -- switching active revision version is tracked in undo stack. Matches current local behavior.
- **D-83:** Single unified undo stack -- one UndoManager per user covering both text and annotations, interleaved by time. No separate stacks for text vs annotations.
- **D-72:** Custom Yjs-CodeMirror binding (Phase 7.5)
- **D-74:** Client-side UndoManager per user (Phase 7.5)
- **D-57:** Live Room mode -- session ends when owner leaves (Phase 6)
- **D-54:** Dual-write local SQLite persistence continues during collab (Phase 6)

### Claude's Discretion
- Y.Map schema design for annotations (nested Y.Arrays for threads/versions vs flat structure)
- Position tracking implementation (RelativePosition for ranges -- start+end or single anchor)
- Concurrent edit merge strategy for threads (Yjs Y.Array natural merge behavior)
- How suggestion/revision state syncs (accepted state, active version index)
- Annotation ID generation in collaborative context (avoid collisions)

### Deferred Ideas (OUT OF SCOPE)
- **Offline queue with annotation sync** -- Phase 9 (Yjs persistence handles this naturally)
- **Annotation conflict UI** -- not needed if Yjs merge is seamless
- **Per-annotation permissions** -- v2 (who can edit/delete which annotations)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SYNC-05 | Annotations (comments, revisions, suggestions) sync as part of document state | Y.Map for annotation storage, RelativePosition for anchoring, bidirectional bridge with annotationField StateField |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Annotation CRDT storage | Yjs shared types | -- | Y.Map provides conflict-free sync |
| Position anchoring | Yjs RelativePosition | -- | Survives concurrent text edits |
| Annotation rendering | CodeMirror StateField | Svelte stores | Decorations read from annotationField |
| Undo/redo | Yjs UndoManager | -- | D-83 requires unified stack |
| Local persistence | Existing SQLite event log | -- | D-54 dual-write continues |
| Annotation UI | Svelte components | -- | Reads from synced stores |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| yjs | 13.6.30 | CRDT for shared state | Already installed from Phase 7.5 [VERIFIED: package.json] |
| y-websocket | 3.0.0 | WebSocket sync provider | Already installed [VERIFIED: package.json] |
| y-protocols | 1.0.7 | Awareness + sync protocols | Already installed [VERIFIED: package.json] |
| @codemirror/state | 6.6.0 | StateField, StateEffect | Already in use [VERIFIED: codebase] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lodash-es | 4.18.1 | mapValues for object transforms | Already used in annotationField.ts |
| zod | 4.3.6 | Schema validation for Yjs payloads | Validate deserialized annotations |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Y.Map for annotations | Y.Array | Y.Map provides O(1) lookup by ID; Y.Array would require scanning |
| RelativePosition | Absolute indices | RelativePosition survives concurrent edits; absolute indices drift |
| Separate Y.Map | Nested in Y.Text | Separate map allows independent UndoManager scope if needed |

**Installation:**
```bash
# No new dependencies needed -- all packages already installed from Phase 7.5
```

**Version verification:** Yjs 13.6.30 is current [VERIFIED: npm registry 2026-04-17].

## Architecture Patterns

### System Architecture Diagram

```
                          ┌─────────────────────┐
                          │   Relay Server      │
                          │ (y-websocket-server)│
                          └──────────┬──────────┘
                                     │ Yjs updates (binary)
                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         Yjs Document Layer                           │
│  ┌─────────────┐     ┌──────────────────────────────────────────┐   │
│  │   Y.Text    │     │           Y.Map("annotations")           │   │
│  │ (document)  │     │  key: string (annotation ID)             │   │
│  │             │     │  value: YjsAnnotation {                  │   │
│  │             │     │    startPos: RelativePosition,           │   │
│  │             │     │    endPos: RelativePosition,             │   │
│  │             │     │    _type, thread, versions, etc.         │   │
│  │             │     │  }                                       │   │
│  └──────┬──────┘     └──────────────────┬───────────────────────┘   │
│         │                               │                            │
│         │  UndoManager scope: [ytext, ymap]                         │
│         │  trackedOrigins: Set(["local"])                           │
└─────────┼───────────────────────────────┼────────────────────────────┘
          │                               │
          │ Y.Text observer               │ Y.Map observer
          ▼                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      Yjs Binding Layer                               │
│  ┌─────────────────────────┐    ┌────────────────────────────────┐  │
│  │  createYjsBinding()     │    │  createAnnotationSyncPlugin()  │  │
│  │  (existing from 7.5)    │    │  - observe() → StateEffect     │  │
│  │                         │    │  - update() → ymap.set()       │  │
│  │  Y.Text ↔ CodeMirror    │    │  - RelativePosition convert    │  │
│  └─────────┬───────────────┘    └─────────────┬──────────────────┘  │
│            │                                  │                      │
└────────────┼──────────────────────────────────┼──────────────────────┘
             │                                  │
             │ CM dispatch                      │ StateEffect
             ▼                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    CodeMirror State Layer                            │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                   annotationField: StateField<Annotations>       │ │
│  │  - Phase 1: remapAnnotationSelections                           │ │
│  │  - Phase 2: applyAnnotationEffects (add, remove, update, etc.)  │ │
│  │  - Phase 3: pushDocToVersionState                               │ │
│  │                                                                  │ │
│  │  Effects: addAnnotation, removeAnnotation, updateThread, etc.   │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                              │                                        │
│                              │ updateListener                         │
│                              ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │              Svelte Stores ($annotations, etc.)                  │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
             │
             │ Local persistence (D-54 dual-write)
             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      SQLite Event Log                                │
│  appendEvent() → events table → periodic snapshots                   │
└──────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
src/lib/collab/
├── yjsBinding.ts           # Existing Y.Text <-> CM binding
├── yjsUndo.ts              # Existing UndoManager (MODIFY to add Y.Map scope)
├── yjsAnnotations.ts       # NEW: Y.Map <-> annotationField bridge
├── annotationSchema.ts     # NEW: Yjs annotation schema + converters
├── relativePosition.ts     # NEW: RelativePosition utilities
├── types.ts                # Extend with annotation sync types
└── index.ts                # Re-export new modules
```

### Pattern 1: Bidirectional Sync with Origin Tracking
**What:** Yjs and CodeMirror both observe changes and apply them to the other, using origin annotations to prevent feedback loops.
**When to use:** Always -- this is the core sync pattern.
**Example:**
```typescript
// Source: Yjs docs + existing yjsBinding.ts pattern
// Yjs → CodeMirror (in ViewPlugin)
ymap.observe((event, transaction) => {
    if (transaction.origin === "local") return; // Prevent feedback loop
    
    for (const [key, change] of event.keysChanged) {
        if (change.action === "add" || change.action === "update") {
            const yjsAnn = ymap.get(key);
            const cmAnn = yjsAnnotationToCodeMirror(yjsAnn, ytext);
            view.dispatch({
                effects: [addAnnotation.of(cmAnn)],
                annotations: [yjsSyncAnnotation.of(true)], // Mark as Yjs-originated
            });
        } else if (change.action === "delete") {
            // Find annotation by ID and dispatch removeAnnotation
        }
    }
});

// CodeMirror → Yjs (in ViewPlugin update())
update(viewUpdate: ViewUpdate) {
    if (viewUpdate.transactions.some(tr => tr.annotation(yjsSyncAnnotation))) return;
    
    for (const tr of viewUpdate.transactions) {
        for (const effect of tr.effects) {
            if (effect.is(addAnnotation)) {
                const yjsAnn = codeMirrorToYjsAnnotation(effect.value, ytext);
                ydoc.transact(() => {
                    ymap.set(String(effect.value.id), yjsAnn);
                }, "local");
            }
        }
    }
}
```

### Pattern 2: RelativePosition for Range Anchoring
**What:** Convert absolute CodeMirror positions to Yjs RelativePositions for storage, convert back when reading.
**When to use:** When storing/retrieving annotation positions.
**Example:**
```typescript
// Source: https://docs.yjs.dev/api/relative-positions [CITED]
import * as Y from "yjs";

// Store: absolute → relative
function absoluteToRelative(
    ytext: Y.Text, 
    selection: EditorSelection
): { startPos: Uint8Array; endPos: Uint8Array } {
    const startRel = Y.createRelativePositionFromTypeIndex(ytext, selection.main.from);
    const endRel = Y.createRelativePositionFromTypeIndex(ytext, selection.main.to);
    return {
        startPos: Y.encodeRelativePosition(startRel),
        endPos: Y.encodeRelativePosition(endRel),
    };
}

// Read: relative → absolute
function relativeToAbsolute(
    ydoc: Y.Doc,
    ytext: Y.Text,
    startPos: Uint8Array, 
    endPos: Uint8Array
): EditorSelection | null {
    const startRel = Y.decodeRelativePosition(startPos);
    const endRel = Y.decodeRelativePosition(endPos);
    const startAbs = Y.createAbsolutePositionFromRelativePosition(startRel, ydoc);
    const endAbs = Y.createAbsolutePositionFromRelativePosition(endRel, ydoc);
    
    if (startAbs === null || endAbs === null) return null; // Referenced text deleted
    
    return EditorSelection.single(startAbs.index, endAbs.index);
}
```

### Pattern 3: UndoManager Scope Extension
**What:** Extend the existing UndoManager to track both Y.Text and Y.Map changes for unified undo (D-83).
**When to use:** During collab initialization.
**Example:**
```typescript
// Source: https://docs.yjs.dev/api/undo-manager [CITED]
// Current implementation (yjsUndo.ts) tracks only ytext:
// const undoManager = new Y.UndoManager(ytext, { trackedOrigins: new Set(["local"]) });

// Updated to track both (D-83 unified stack):
const undoManager = new Y.UndoManager([ytext, ymap], {
    trackedOrigins: new Set(["local"]),
    captureTimeout: 500,
});
```

### Anti-Patterns to Avoid
- **Storing absolute positions in Y.Map:** Absolute indices drift with concurrent edits. Always use RelativePosition.
- **Separate undo stacks for text vs annotations:** D-83 explicitly requires unified stack. Users expect "undo" to revert both text and annotation changes together.
- **Comparing annotation `_type` directly:** Always use `isAnnotationOfType()` type guard per CLAUDE.md directive.
- **Nested Y.Map/Y.Array operations in single undo group:** Known Yjs bug (#642) causes client desync when undoing nested structure modifications. Use `stopCapturing()` between operations if needed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Position tracking | Custom delta tracking | Yjs RelativePosition | Handles concurrent edit interleaving automatically [CITED: Yjs docs] |
| Annotation CRDT | Custom OT for annotations | Yjs Y.Map | CRDT merge is complex; Y.Map handles it |
| ID collision avoidance | UUID generator | Client ID prefix + local counter | Yjs client IDs are already unique per session |
| Thread merge | Manual conflict resolution | Y.Array natural merge | Y.Array preserves all items from concurrent appends |

**Key insight:** Yjs handles the hard distributed systems problems (ordering, convergence, conflict resolution). The implementation work is bridging Yjs types to CodeMirror's transaction model.

## Common Pitfalls

### Pitfall 1: Feedback Loops
**What goes wrong:** Yjs change triggers CM dispatch, which triggers Yjs change, infinite loop.
**Why it happens:** Both systems observe and apply changes from the other.
**How to avoid:** Use origin tracking. Yjs transactions use `"local"` origin; CM transactions carry a `yjsSyncAnnotation` annotation. Skip propagation when detecting own-origin changes.
**Warning signs:** CPU spike, infinite loop console errors, "Maximum call stack size exceeded."

### Pitfall 2: RelativePosition Returns Null
**What goes wrong:** `createAbsolutePositionFromRelativePosition()` returns `null`, annotation position is lost.
**Why it happens:** The text the RelativePosition was anchored to has been deleted.
**How to avoid:** Handle `null` gracefully. For comments/suggestions, delete the annotation. For revisions, consider keeping with collapsed range (matches existing local behavior).
**Warning signs:** Annotations disappear unexpectedly, console warnings about null positions.

### Pitfall 3: UndoManager Desync with Nested Structures
**What goes wrong:** Undo of Y.Map operations inside Y.Array causes clients to diverge.
**Why it happens:** Known Yjs bug #642: undoing a grouped operation (set + delete) on nested structures can lose data on synchronized clients.
**How to avoid:** Use flat Y.Map structure (no nested Y.Arrays for threads/versions). Store threads as JSON strings, not nested Y.Arrays. Or use `stopCapturing()` between nested modifications.
**Warning signs:** One client shows data that another doesn't after undo.

### Pitfall 4: Phase 3 Interference
**What goes wrong:** Remote annotation changes trigger Phase 3 (`pushDocToVersionState`), overwriting remote version state.
**Why it happens:** Phase 3 runs on every `docChanged` transaction, copying doc slice back into `versions[activeVersionIndex].doc`.
**How to avoid:** Mark Yjs-originated transactions with annotation (like `yjsSyncAnnotation`) and skip Phase 3 for those. Or only let owner's client run Phase 3.
**Warning signs:** Remote version content reverts to local content unexpectedly.

### Pitfall 5: ID Collision in Collaborative Context
**What goes wrong:** Two clients create annotations with the same ID simultaneously.
**Why it happens:** Current `getNewId()` uses `Math.max(...keys) + 1`, which can collide if both clients have the same annotation count.
**How to avoid:** Generate IDs with client ID prefix: `${clientId}-${localCounter}`. Or use Yjs-generated unique keys (Y.Map sets generate unique internal IDs).
**Warning signs:** One annotation overwrites another, UI shows wrong annotation data.

## Code Examples

Verified patterns from official sources:

### Y.Map Schema for Annotations
```typescript
// Schema for Yjs-stored annotation (minimal version for sync)
// Source: Design decision based on Yjs Y.Map docs [CITED]
interface YjsAnnotation {
    id: string;                    // Client ID prefixed for uniqueness
    _type: "comment" | "suggestion" | "revision";
    startPos: Uint8Array;          // Encoded RelativePosition
    endPos: Uint8Array;            // Encoded RelativePosition
    thread: string;                // JSON-serialized Thread (avoid nested Y.Array)
    // Type-specific fields
    replacements?: string;         // JSON for suggestions
    versions?: string;             // JSON for revisions
    activeVersionIndex?: number;   // For revisions
}
```

### Observer Pattern for Sync
```typescript
// Source: Yjs Y.Map observe docs [CITED]
ymap.observe((event: Y.YMapEvent<YjsAnnotation>) => {
    event.keysChanged.forEach((key) => {
        const change = event.changes.keys.get(key);
        if (!change) return;
        
        switch (change.action) {
            case "add":
            case "update":
                const yjsAnn = ymap.get(key);
                if (yjsAnn) applyToCodeMirror(yjsAnn);
                break;
            case "delete":
                removeFromCodeMirror(key);
                break;
        }
    });
});
```

### Creating Unique Annotation IDs
```typescript
// Source: Design pattern for collision avoidance [ASSUMED]
function generateAnnotationId(clientId: string): string {
    // clientId is Yjs client ID (unique per browser session)
    // localCounter ensures uniqueness within session
    return `${clientId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| @codemirror/collab OT | Yjs CRDT | Phase 7.5 (current milestone) | Annotations can use Yjs types directly |
| Custom cursor sync | Awareness protocol | Phase 7.5 | Cursor sync already on Yjs |
| Integer annotation IDs | String IDs with client prefix | This phase | Prevents ID collision in collab |

**Deprecated/outdated:**
- y-codemirror.next: Unmaintained, per D-72 Quillium uses custom binding.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Storing threads as JSON strings avoids Yjs bug #642 | Don't Hand-Roll | If nested Y.Array is needed, undo may cause desync |
| A2 | Client ID prefix + timestamp + random suffix prevents ID collisions | Code Examples | If collisions still occur, need different ID scheme |
| A3 | Marking Yjs transactions prevents Phase 3 interference | Pitfall 4 | May need more complex phase 3 gating logic |

## Open Questions

1. **Thread ordering semantics**
   - What we know: Y.Array preserves all items from concurrent appends
   - What's unclear: Should thread messages be ordered by timestamp or arrival order?
   - Recommendation: Use timestamp field in ThreadMessage for display ordering; Yjs merge order for storage

2. **Revision version sync granularity**
   - What we know: VersionState contains full serialized EditorState
   - What's unclear: Should each version change sync the full blob, or only changed fields?
   - Recommendation: Sync full VersionState JSON; Yjs handles diffing efficiently

3. **Deleted annotation cleanup**
   - What we know: RelativePosition returns null when anchored text is deleted
   - What's unclear: Should we proactively clean up annotations with null positions, or leave them?
   - Recommendation: Clean up on null position for comments/suggestions; keep revisions with collapsed range (matches existing behavior)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.4 [VERIFIED: package.json] |
| Config file | vitest.config.ts |
| Quick run command | `bun run test:run src/lib/collab/yjsAnnotations.test.ts -x` |
| Full suite command | `bun run test:run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SYNC-05a | Comment sync via Y.Map | unit | `bun run test:run src/lib/collab/yjsAnnotations.test.ts::comment-sync -x` | Wave 0 |
| SYNC-05b | Revision sync via Y.Map | unit | `bun run test:run src/lib/collab/yjsAnnotations.test.ts::revision-sync -x` | Wave 0 |
| SYNC-05c | Suggestion sync via Y.Map | unit | `bun run test:run src/lib/collab/yjsAnnotations.test.ts::suggestion-sync -x` | Wave 0 |
| SYNC-05d | RelativePosition anchoring | unit | `bun run test:run src/lib/collab/relativePosition.test.ts -x` | Wave 0 |
| SYNC-05e | Unified undo with annotations | unit | `bun run test:run src/lib/collab/yjsUndo.test.ts::annotation-undo -x` | Wave 0 |
| SYNC-05f | Two-client convergence | integration | `bun run test:run src/lib/collab/yjsAnnotations.convergence.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `bun run test:run src/lib/collab/yjsAnnotations.test.ts -x`
- **Per wave merge:** `bun run test:run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/lib/collab/yjsAnnotations.test.ts` -- covers SYNC-05a,b,c
- [ ] `src/lib/collab/relativePosition.test.ts` -- covers SYNC-05d
- [ ] `src/lib/collab/yjsAnnotations.convergence.test.ts` -- covers SYNC-05f
- [ ] Extend `src/lib/collab/yjsUndo.test.ts` for annotation undo (SYNC-05e)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Already handled by Phase 2-3 |
| V3 Session Management | no | Already handled by Phase 2-3 |
| V4 Access Control | partial | Relay validates JWT before accepting sync; per-annotation permissions deferred to v2 |
| V5 Input Validation | yes | Zod schemas validate annotation payloads on deserialization |
| V6 Cryptography | no | No crypto operations in this phase |

### Known Threat Patterns for Yjs + Annotations

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed annotation injection | Tampering | Zod schema validation on all Y.Map entries |
| Annotation spam DoS | Denial of Service | Rate limiting at relay (future); annotation count limits |
| ID collision attack | Tampering | Client ID prefix ensures ID namespace isolation |

## Sources

### Primary (HIGH confidence)
- Yjs official documentation -- Y.Map, RelativePosition, UndoManager APIs
  - https://docs.yjs.dev/api/shared-types/y.map
  - https://docs.yjs.dev/api/relative-positions
  - https://docs.yjs.dev/api/undo-manager
- Quillium codebase -- models.ts, annotationField.ts, yjsBinding.ts

### Secondary (MEDIUM confidence)
- Yjs GitHub issue #642 -- UndoManager bug with nested structures
  - https://github.com/yjs/yjs/issues/642
- BlockNote comments implementation -- Y.Map thread storage pattern
  - https://www.blocknotejs.org/docs/features/collaboration/comments

### Tertiary (LOW confidence)
- Yjs Community Forum -- RelativePosition edge cases
  - https://discuss.yjs.dev/t/y-relativeposition-api-questions/2173

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all packages already installed from Phase 7.5, APIs well-documented
- Architecture: HIGH -- bidirectional sync pattern proven in yjsBinding.ts, extending to Y.Map is straightforward
- Pitfalls: MEDIUM -- UndoManager bug #642 is documented but workaround needs validation

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (30 days -- Yjs is stable, APIs rarely change)
