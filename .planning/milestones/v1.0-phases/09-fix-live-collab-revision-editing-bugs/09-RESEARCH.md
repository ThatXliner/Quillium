# Phase 9: Fix Live Collab Revision Editing Bugs - Research

**Researched:** 2026-04-19
**Domain:** Yjs CRDT synchronization, CodeMirror nested editors, collaborative annotation state
**Confidence:** HIGH

## Summary

Phase 9 addresses cascading bugs discovered while dogfooding live-collab revision editing. The bugs span three interrelated systems: (1) nested-editor Y.Text subtree bindings, (2) parent CM annotation state synchronization, and (3) Yjs UndoManager stack isolation. The key architectural insight from D-100 (Room-as-View) dissolves bugs #3 and #6 architecturally rather than patching them: a joiner's collab session is a **separate ephemeral document view** that never touches their local documents.

The primary technical challenges are: ensuring the parent doc slice, `versions[i].doc`, and subtree Y.Text remain in sync during nested-editor typing; preventing annotation "destruction" during version switches (especially the first switch after join); and isolating the Yjs UndoManager stack so cmd-z on joiner cannot revert to pre-connect state.

**Primary recommendation:** Implement D-100 (Room-as-View) first to dissolve bugs #3/#6, then write integration tests targeting each remaining bug's suspect layer (per `feedback_convergence_debugging` guidance), and fix bugs in test-failure order.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-100:** Joiner's collab session is a **separate ephemeral document view**, not a mutation of any local doc. Clicking "Join room" navigates to a collab-only view backed by the room's Y.Doc; the user's existing local documents are never read from or written to. On leave/kick/disconnect, navigate back to whatever was open before (library or prior doc).
- **D-101:** **Owner's local doc IS the room.** Owner's current doc becomes the room's initial state. Owner's edits save locally as normal during the session. When owner stops sharing, they keep the doc including any edits peers made while live.
- **D-102:** Dedup bug (#6) is dissolved by D-100: joiner has no pre-existing local annotations to collide with Yjs-seeded ones. Annotation hydration on joiner comes exclusively from Yjs. Owner's annotations were always local and just become the room's seed.
- **D-103:** Restore-to-prior-view happens on ALL of: (a) user clicks "Leave room" / "Stop sharing", (b) owner kicks joiner (relay sends kick), (c) connection lost and reconnect retries exhausted, (d) app close during live session.
- **D-104:** Joiner's Cmd-z uses Yjs UndoManager only, with a fresh empty stack tied to this room's Yjs session. Cannot undo past the joiner's first keystroke in the room.
- **D-105:** Owner's Cmd-z continues to work via the existing Y.UndoManager setup (per 08.5c D-95).
- **D-106:** Integration tests live in `src/lib/collab/` next to existing convergence tests. Use the existing two-peer harness in `twoPeerHarness.ts`.
- **D-107:** Test-around-wip approach. Keep uncommitted wip patches on `omni` branch as starting point.
- **D-108:** Tests cover ALL invariants (all 5 ROADMAP success criteria).
- **D-109:** Root-cause bisection via tests for bug #2 (first-version-switch destroys annotation).
- **D-110:** Lazy subscription to inactive version Y.Texts. Only active version has live CM observer.

### Claude's Discretion
- Exact naming of new test file(s) in `src/lib/collab/`
- How D-100 is implemented at the routing/navigation layer (new route vs in-place view swap)
- Whether `_syncInitialFromYjs` is still needed under D-100
- Whether any wip patches become obsolete after D-100
- Relay-side kick protocol design for D-103(b)

### Deferred Ideas (OUT OF SCOPE)
- Peer cursor rendering inside nested editors (still deferred from 08.5c D-98)
- Persistent per-room UndoManager state across sessions
- Higher-level NestedEditorController-driven test harness
- Merge-back flow for integrating joiner edits after session ends
- Relay-side broadcast test coverage (lives in `../quillium-landing/relay/`)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SYNC-05 | Annotations (comments, revisions, suggestions) sync as part of document state | All bugs relate to annotation sync stability; D-100 architecture ensures clean annotation hydration |
| Dogfoodable | Feature stable enough to use for real writing across devices | All 6 success criteria target dogfoodable quality bar |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Annotation state sync | Client (Yjs) | Relay (broadcast) | Y.Map<YjsAnnotationNode> is client-side CRDT; relay is dumb broadcast |
| Nested-editor text sync | Client (yjsBinding) | -- | Subtree Y.Text binding is purely client-side |
| UndoManager isolation | Client (yjsUndo) | -- | Per-user undo stacks are client-local; relay never sees undo |
| Room-as-View navigation | Client (navigation.ts) | -- | View swap is purely frontend routing |
| Joiner state isolation | Client (stores) | -- | `isCollabJoiner` flag gates persistence; no backend involvement |
| Version switch coordination | Client (annotationField) | -- | `activeVersionIndex` is local-only metadata (D-99) |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| yjs | ^13.6.30 | CRDT synchronization | [VERIFIED: package.json] Project already uses Yjs for all collab sync |
| y-websocket | ^3.0.0 | WebSocket provider | [VERIFIED: package.json] Already in use; relay compatibility |
| @codemirror/state | ^6.6.0 | Editor state management | [VERIFIED: package.json] Core editor engine |
| @codemirror/view | ^6.41.0 | Editor view layer | [VERIFIED: package.json] Core editor engine |
| vitest | ^4.1.4 | Test framework | [VERIFIED: package.json] Project standard |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| fast-check | ^4.6.0 | Property-based testing | [VERIFIED: package.json] For randomized edit sequences around version switches |
| svelte/store | (bundled) | Reactive state | [VERIFIED: codebase] `isCollabJoiner`, `collabSession` stores |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-place view swap | New SvelteKit route | Route adds URL change visibility but requires more plumbing; in-place swap matches existing navigation patterns |

**Installation:**
No new dependencies required. All needed packages already installed.

## Architecture Patterns

### System Architecture Diagram

```
                                    ┌─────────────────────────────────────┐
                                    │         Collab Session Flow          │
                                    └─────────────────────────────────────┘
                                                      │
                    ┌─────────────────────────────────┼─────────────────────────────────┐
                    │                                 │                                 │
                    ▼                                 ▼                                 ▼
        ┌───────────────────┐           ┌───────────────────┐           ┌───────────────────┐
        │  Owner Clicks     │           │  Joiner Clicks    │           │  Disconnect/Kick  │
        │  "Go Live"        │           │  "Join by ID"     │           │  (any trigger)    │
        └─────────┬─────────┘           └─────────┬─────────┘           └─────────┬─────────┘
                  │                               │                               │
                  ▼                               ▼                               ▼
        ┌───────────────────┐           ┌───────────────────┐           ┌───────────────────┐
        │ enableCollab()    │           │ enableCollab()    │           │ disableCollab()   │
        │ asOwner=true      │           │ asOwner=false     │           │ + restore view    │
        └─────────┬─────────┘           └─────────┬─────────┘           └─────────┬─────────┘
                  │                               │                               │
                  ▼                               ▼                               ▼
        ┌───────────────────┐           ┌───────────────────┐           ┌───────────────────┐
        │ Local doc seeds   │           │ D-100: Create     │           │ Navigate to prior │
        │ Y.Text + Y.Map    │           │ ephemeral view    │           │ view (library or  │
        │ Persist continues │           │ No local doc I/O  │           │ previous doc)     │
        └─────────┬─────────┘           └─────────┬─────────┘           └───────────────────┘
                  │                               │
                  ▼                               ▼
        ┌───────────────────────────────────────────────────────────────┐
        │                      Live Session                              │
        │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │
        │  │ Main Y.Text │◄──►│   Relay     │◄──►│ Main Y.Text │        │
        │  │ (owner)     │    │ (broadcast) │    │ (joiner)    │        │
        │  └──────┬──────┘    └─────────────┘    └──────┬──────┘        │
        │         │                                      │              │
        │         ▼                                      ▼              │
        │  ┌─────────────┐                        ┌─────────────┐       │
        │  │ Y.Map<ann>  │────── observeDeep ─────│ Y.Map<ann>  │       │
        │  └──────┬──────┘                        └──────┬──────┘       │
        │         │                                      │              │
        │         ▼                                      ▼              │
        │  ┌─────────────┐                        ┌─────────────┐       │
        │  │ Subtree     │                        │ Subtree     │       │
        │  │ Y.Text per  │                        │ Y.Text per  │       │
        │  │ version     │                        │ version     │       │
        │  └─────────────┘                        └─────────────┘       │
        └───────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
src/lib/collab/
├── index.ts                      # enableCollab, disableCollab (D-100 changes here)
├── yjsAnnotations.ts             # Y.Map sync plugin
├── yjsBinding.ts                 # Y.Text ↔ CM binding
├── yjsUndo.ts                    # UndoManager + subtree helpers
├── store.ts                      # collabSession, isCollabJoiner
├── test-helpers/
│   └── twoPeerHarness.ts         # Existing two-peer fixture
├── revision-lifecycle.test.ts    # NEW: Integration tests for Phase 9
└── ...existing files...
```

### Pattern 1: Room-as-View (D-100)
**What:** Joiner's collab session creates a separate ephemeral document view backed entirely by the room's Y.Doc. No local document I/O occurs.
**When to use:** Every joiner connection.
**Example:**
```typescript
// Source: D-100 decision + existing GoLiveButton.svelte pattern
async function joinById(roomId: string) {
    // Store prior view state for restore on disconnect
    const priorView = get(currentDraftId);
    priorViewStack.push(priorView);
    
    // Clear local draft ID — joiner is NOT editing a local doc
    currentDraftId.set(null); // Or a sentinel like `collab:${roomId}`
    isCollabJoiner.set(true);
    
    // Create ephemeral EditorView backed by room's Y.Doc
    await enableCollab(view, roomId, userId, false /* asOwner */);
}
```

### Pattern 2: Lazy Version Subscription (D-110)
**What:** Only the active version has a live CM observer. On version switch, snapshot target Y.Text into `versions[targetIdx].doc` before attaching observer.
**When to use:** Version switch operations in NestedEditorController.
**Example:**
```typescript
// Source: D-110 decision
function switchVersion(targetIdx: number) {
    // 1. Detach observer from current version's subtree
    currentBinding?.destroy();
    
    // 2. Snapshot target version's Y.Text into CM state
    const targetYtext = versionsMap.get(String(targetIdx))?.get("text");
    const snapshotDoc = targetYtext?.toString() ?? "";
    
    // 3. Update versions[targetIdx].doc in CM annotationField
    dispatch(_updateRevisionVersionDoc.of({
        annotationId,
        versionIndex: targetIdx,
        doc: snapshotDoc,
    }));
    
    // 4. Attach observer to new active version
    currentBinding = createYjsBinding(targetYtext);
}
```

### Pattern 3: Test-First Bisection (D-109)
**What:** Write failing tests at each suspect layer before proposing fixes.
**When to use:** Bug #2 (first-version-switch destroys annotation).
**Example:**
```typescript
// Source: feedback_convergence_debugging memory
describe("bug #2 bisection", () => {
    it("Layer 1: subtree binding survives NestedEditorController destroy/rebuild", () => {
        // Test that binding teardown doesn't corrupt Y.Map entry
    });
    
    it("Layer 2: annotationGeneration doesn't misfire on version switch", () => {
        // Test that rebuild signal doesn't incorrectly trigger
    });
    
    it("Layer 3: Yjs observer race during _syncInitialFromYjs", () => {
        // Test queueMicrotask + observeDeep interaction
    });
});
```

### Anti-Patterns to Avoid
- **Guessing at bug layers:** Don't read code and propose fixes without failing tests. Write tests at each suspect layer first. [CITED: feedback_convergence_debugging]
- **Mixing joiner state with local docs:** D-100 explicitly forbids joiner's session from touching any local document. Never write to SQLite during a joiner session.
- **Assuming CM history is safe in collab:** The `Prec.highest` undo keymap MUST always claim Mod-z, even when Yjs stack is empty, to prevent CM historyField from reverting to pre-connect state.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Two-peer sync simulation | Custom Y.Doc piping | `twoPeerHarness.ts` | Already handles update routing with correct "remote" origin tagging [VERIFIED: codebase] |
| Subtree undo scope | Manual stack management | `addSubtreeToUndoScope()` | Already implemented in `yjsUndo.ts`, handles `addToScope` correctly [VERIFIED: codebase] |
| Position anchoring | Manual offset tracking | `RelativePosition` | Yjs provides stable positions that survive concurrent edits [CITED: yjs/docs] |
| Origin-based loop prevention | Custom dedup | `ydoc.transact(..., "local")` | Standard Yjs pattern for preventing self-echo [VERIFIED: codebase] |

**Key insight:** The two-peer harness and subtree undo infrastructure already exist from Phase 8.5. Phase 9 tests should extend these patterns, not reinvent them.

## Common Pitfalls

### Pitfall 1: Observer Race During Initial Sync
**What goes wrong:** `_syncInitialFromYjs` uses `queueMicrotask` to dispatch annotations. If `observeDeep` fires during the same microtask queue, annotations can be double-added.
**Why it happens:** Yjs observer callbacks fire synchronously during `applyUpdate`, but CM dispatch must be deferred.
**How to avoid:** Ensure `_syncInitialFromYjs` checks `idMap.getCmId(yjsKey) !== undefined` before adding (already implemented). Add integration test that verifies no duplicate annotations after joiner sync.
**Warning signs:** Annotation IDs collide, decorations stack, or `removeAnnotation` effects appear without prior `addAnnotation`.

### Pitfall 2: Version Switch Timing with Active Binding
**What goes wrong:** Switching `activeVersionIndex` while a nested editor's subtree binding is still attached can corrupt the wrong version's Y.Text.
**Why it happens:** The binding dispatches to whichever Y.Text it holds a reference to, regardless of CM state.
**How to avoid:** Always destroy the binding BEFORE dispatching `_updateActiveRevisionVersion`. Rebuild the binding AFTER the switch completes.
**Warning signs:** Version content gets scrambled, or edits appear in wrong version.

### Pitfall 3: CM History Leaking Into Collab Mode
**What goes wrong:** Cmd-z reverts to pre-connect local doc state instead of undoing the last Yjs operation.
**Why it happens:** CM historyField accumulated entries before collab started. If Yjs keymap doesn't claim the keystroke, CM history runs.
**How to avoid:** Yjs undo keymap at `Prec.highest` MUST return `true` unconditionally for Mod-z, even when `!canUndo()`. [VERIFIED: already implemented in wip patches]
**Warning signs:** Joiner's doc reverts to their pre-join local content; annotations disappear wholesale.

### Pitfall 4: Local Persistence Contaminating Joiner Session
**What goes wrong:** Joiner's edits get written to their local SQLite event log, creating ghost documents.
**Why it happens:** Persistence listener doesn't check `isCollabJoiner` flag.
**How to avoid:** D-100 architecture: joiner session never touches local docs. `isCollabJoiner.set(true)` must happen BEFORE `enableCollab` call. Persistence listener must early-return when flag is true.
**Warning signs:** Joiner's library shows ghost documents after leaving sessions.

### Pitfall 5: Annotation Destruction on First Version Switch
**What goes wrong:** The first version switch after joiner connects "destroys" the annotation (decoration disappears).
**Why it happens:** Root cause TBD via D-109 bisection. Suspect layers: (1) binding lifecycle during rebuild, (2) annotationGeneration misfire, (3) observer race.
**How to avoid:** Write failing tests per D-109 before fixing. The fix will emerge from which test fails.
**Warning signs:** Annotation card disappears, decoration gone, but Y.Map entry still exists.

## Code Examples

### Example 1: Integration Test Structure (D-108)
```typescript
// Source: Existing convergence tests + D-106/D-108 decisions
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makePeer, connect, teardown, type Peer } from "./test-helpers/twoPeerHarness";
import { annotationField, addAnnotation } from "$lib/editor/plugins/annotations/annotationField";
import { EditorSelection } from "@codemirror/state";
import type { GenericAnnotation } from "$lib/editor/plugins/annotations/models";

describe("revision lifecycle (Phase 9)", () => {
    let owner: Peer;
    let joiner: Peer;
    let disconnect: () => void;
    
    beforeEach(() => {
        owner = makePeer("owner", "hello world");
        joiner = makePeer("joiner");
        disconnect = connect(owner, joiner);
    });
    
    afterEach(() => {
        disconnect();
        teardown(owner);
        teardown(joiner);
    });
    
    it("bug #1: parent doc slice == versions[i].doc == subtree Y.Text after edit", () => {
        // Create revision on owner
        const revision: GenericAnnotation = {
            id: 0,
            _type: "revision",
            selection: EditorSelection.single(0, 5),
            thread: [],
            versions: [{ doc: "hello" }],
            activeVersionIndex: 0,
        };
        owner.view.dispatch({ effects: [addAnnotation.of(revision)] });
        
        // Simulate nested edit: update subtree Y.Text + parent CM state
        // ... (subtree manipulation)
        
        // Assert all three sources agree
        const ownerAnns = owner.view.state.field(annotationField);
        const joinerAnns = joiner.view.state.field(annotationField);
        // ... assertions
    });
});
```

### Example 2: D-100 Joiner View Isolation
```typescript
// Source: D-100 decision + GoLiveButton.svelte pattern
// In src/lib/collab/index.ts or GoLiveButton.svelte

// Track prior view for restore
let joinerPriorView: { draftId: string | null; view: "editor" | "library" } | null = null;

export async function joinCollabSession(
    view: EditorView,
    roomId: string,
    userId: string,
) {
    // D-100: Store prior view state
    joinerPriorView = {
        draftId: get(currentDraftId),
        view: "editor", // Or check current route
    };
    
    // D-100: Clear local doc association — joiner is ephemeral
    currentDraftId.set(null);
    isCollabJoiner.set(true);
    
    // D-104: Create fresh UndoManager scope (per enableCollab)
    await enableCollab(view, roomId, userId, false);
}

export function restoreJoinerPriorView() {
    // D-103: Restore prior view on any disconnect trigger
    if (!joinerPriorView) {
        goToLibrary();
        return;
    }
    
    if (joinerPriorView.draftId) {
        currentDraftId.set(joinerPriorView.draftId);
        goToEditor();
    } else {
        goToLibrary();
    }
    
    joinerPriorView = null;
    isCollabJoiner.set(false);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| y-codemirror.next | Custom binding | Phase 7.5 (D-72) | y-codemirror.next unmaintained; custom binding gives full control |
| JSON blob version sync | Y.Text subtrees | Phase 8.5 (D-90) | Character-level CRDT merge instead of last-writer-wins |
| Joiner mutates local doc | Room-as-View (D-100) | Phase 9 | Dissolves dedup and undo bugs architecturally |

**Deprecated/outdated:**
- `syncRevisionChanges` JSON-diff path: deleted in Phase 8.5b (D-94)
- `@codemirror/collab` OT: removed in Phase 7.5 (D-70)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | D-100 implementation can use in-place view swap without new route | Architecture Patterns | Medium — may need route if state isolation requires full remount |
| A2 | `_syncInitialFromYjs` may collapse into normal observer setup under D-100 | User Constraints (Discretion) | Low — worst case is unused code path |
| A3 | Relay kick protocol for D-103(b) may already exist | User Constraints (Discretion) | Medium — may need relay-side work if not present |

## Open Questions

1. **Relay kick protocol status**
   - What we know: D-103(b) requires owner kick to trigger joiner restore
   - What's unclear: Whether relay already sends a distinguishable kick event
   - Recommendation: Check `yjsProvider.ts` for existing `connection-close` reason handling; extend if needed

2. **Prior view persistence across app restart**
   - What we know: D-103(d) requires "next launch after app-close-during-session must not resume in zombie live state"
   - What's unclear: How to persist prior-view state across Tauri app restart
   - Recommendation: Use localStorage for `joinerPriorView`; clear on app launch if `isCollabJoiner` was true

## Environment Availability

No external dependencies beyond what's already installed. Phase 9 is purely client-side code + tests.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Yjs | All collab sync | YES | ^13.6.30 | -- |
| Vitest | Integration tests | YES | ^4.1.4 | -- |
| fast-check | Property-based tests | YES | ^4.6.0 | -- |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.4 |
| Config file | `vitest.config.ts` |
| Quick run command | `bun run test:run src/lib/collab/revision-lifecycle.test.ts` |
| Full suite command | `bun run test:run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SYNC-05-1 | Parent doc == versions[i].doc == subtree Y.Text | integration | `bun run test:run src/lib/collab/revision-lifecycle.test.ts` | NO (Wave 0) |
| SYNC-05-2 | Version switch preserves annotation | integration | same | NO (Wave 0) |
| SYNC-05-3 | Joiner cmd-z cannot revert pre-connect | integration | same | NO (Wave 0) |
| SYNC-05-4 | Remote inactive edits land on switch | integration | same | NO (Wave 0) |
| SYNC-05-5 | No duplicate annotations after joiner sync | integration | same | NO (Wave 0) |
| Bug-2-bisect | Layer isolation for first-switch bug | unit | per-layer test files | NO (Wave 0) |

### Sampling Rate
- **Per task commit:** `bun run test:run src/lib/collab/revision-lifecycle.test.ts`
- **Per wave merge:** `bun run test:run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/lib/collab/revision-lifecycle.test.ts` -- covers SYNC-05 success criteria
- [ ] Bug #2 bisection test file(s) -- per D-109

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Supabase Auth (existing) |
| V3 Session Management | no | Session already managed |
| V4 Access Control | no | Room ownership checked by relay |
| V5 Input Validation | yes | Zod schemas for annotation shapes |
| V6 Cryptography | no | No crypto in this phase |

### Known Threat Patterns for Yjs/Collab

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed Y.Map entry | Tampering | `yjsAnnotationToCodeMirror` returns null on malformed data (T-08.5-03-02) |
| UndoManager stack corruption | Tampering | Origin-based filtering (`trackedOrigins: new Set(["local"])`) |
| Self-echo loop | Denial of Service | Origin check in observer (`tr.origin === "local"` skip) |

## Sources

### Primary (HIGH confidence)
- [VERIFIED: codebase] `src/lib/collab/*.ts` — current implementation, test patterns
- [VERIFIED: package.json] Dependency versions
- [CITED: Context7 /yjs/docs] Y.UndoManager trackedOrigins, addToScope API

### Secondary (MEDIUM confidence)
- [VERIFIED: 09-CONTEXT.md] D-100 through D-110 decisions
- [VERIFIED: project memory] `project_collab_revision_version_bugs.md`, `feedback_convergence_debugging.md`

### Tertiary (LOW confidence)
None — all claims verified against codebase or CONTEXT.md.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all packages already in use, versions verified
- Architecture: HIGH - D-100 architecture is user-decided, implementation patterns derived from existing code
- Pitfalls: HIGH - derived from documented bugs and codebase analysis

**Research date:** 2026-04-19
**Valid until:** 2026-05-19 (stable Yjs APIs, local codebase patterns)
