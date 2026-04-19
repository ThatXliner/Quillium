# Phase 11: Unified Subtree Sync Rebuild - Research

**Researched:** 2026-04-19
**Domain:** Yjs CRDT sync, CodeMirror state reconciliation, annotation state management
**Confidence:** HIGH

## Summary

Phase 11 rebuilds the annotation sync layer from Phase 10's clean slate. The goal is a single source of truth for annotations in Yjs with bidirectional sync to CodeMirror's `annotationField`. The key insight is avoiding the per-effect branching that made Phase 8/9's sync layer brittle: instead, use a unified diff-and-reconcile approach where every CM transaction triggers a full annotation map comparison, and every remote Yjs change triggers a full rebuild of the CM annotation state.

The existing codebase provides strong foundations: `codeMirrorToYjsAnnotation` and `yjsAnnotationToCodeMirror` converters already handle the recursive Y.Map shape (verified in `annotation-tree.test.ts`), the `AnnotationIdMap` provides bidirectional CM ID to Yjs ID resolution, and `observeDeep` is already wired (but currently only handling the read path).

**Primary recommendation:** Implement a diff-and-reconcile write path in `createAnnotationSyncPlugin.update()` that compares CM annotationField state to Yjs Y.Map state on every transaction, writing only the delta. For revisions, write character-level changes to version Y.Text subtrees rather than replacing entire version strings. Use `observeDeep` for the read path with a single full-rebuild strategy (no partial updates).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SYNC-05 | Annotations (comments, revisions, suggestions) sync as part of document state | Full coverage: converters exist, observeDeep read path exists, write path is the gap to fill |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Annotation state storage | Yjs (Y.Map) | CodeMirror (annotationField) | Yjs is source of truth; CM is projection for rendering |
| Revision version text | Yjs (Y.Text per version) | CM annotationField versions[i].doc | Y.Text enables character-level CRDT merge |
| Position tracking | Yjs RelativePosition | CM EditorSelection | RelativePosition survives concurrent edits; EditorSelection is computed on read |
| Thread messages | Yjs (Y.Array) | CM annotation.thread | Y.Array is append-only CRDT; sorted on read |
| Active version index | Yjs (Y.Map field) | CM annotation.activeVersionIndex | Yjs field propagates switch to all peers |
| CM state effects | CodeMirror | -- | Effects are local mutations; sync layer observes and writes to Yjs |
| Remote change application | Yjs observeDeep | CodeMirror dispatch | observeDeep fires for any nested change; dispatch effects to CM |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| yjs | ^13.6.30 | CRDT shared types (Y.Map, Y.Text, Y.Array) | [VERIFIED: npm registry] Already installed; industry standard for CRDT collab |
| @codemirror/state | ^6.6.0 | StateField, StateEffect, Transaction | [VERIFIED: npm registry] Already installed; required for CM integration |
| @codemirror/view | ^6.41.0 | ViewPlugin, EditorView | [VERIFIED: npm registry] Already installed; sync plugin host |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| y-protocols | (via y-websocket) | Awareness protocol | Already installed; used by awareness.ts |
| lodash-es | 4.18.1 | mapValues utility | Already used in annotationField.ts |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Full rebuild on remote change | Incremental patch | Full rebuild is simpler, safer, and fast enough for reasonable annotation counts (<1000); incremental adds complexity for marginal perf gain |
| Diff-and-write on every tx | Batch writes with debounce | Debounce risks stale state on rapid edits; per-tx diff is cheap and guarantees consistency |

**Installation:**
No new packages needed. All dependencies already installed.

## Architecture Patterns

### System Architecture Diagram

```
+------------------+    dispatch effects     +--------------------+
|   User Action    | ----------------------> | CM annotationField |
| (type, click,    |                         |  (StateField)      |
|  keyboard)       |                         +----------+---------+
+------------------+                                    |
                                                        | update()
                                                        v
+------------------+    diff-and-reconcile   +--------------------+
| Yjs Y.Map        | <---------------------- | AnnotationSyncPlugin|
| (annotations)    |    (local origin)       |  ViewPlugin        |
+------------------+                         +--------------------+
        |                                              ^
        | observeDeep                                  |
        | (remote origin)                              |
        v                                              |
+------------------+    dispatch effects     +--------------------+
| Rebuild CM state | ----------------------> | CM annotationField |
| (remove+add)     |                         |  (via dispatch)    |
+------------------+                         +--------------------+
        |
        | Y.Text observe (per-version)
        v
+------------------+
| Revision version |
| Y.Text subtrees  |
| (character CRDT) |
+------------------+
```

### Recommended Project Structure
```
src/lib/collab/
  yjsAnnotations.ts        # Main sync plugin (modify update() write path)
  annotationSchema.ts      # Converters (no changes needed)
  types.ts                 # Types (no changes needed)
  relativePosition.ts      # Position utilities (no changes needed)
  yjsUndo.ts               # UndoManager (may need subtree scope for versions)
  test-helpers/
    twoPeerHarness.ts      # Extend with annotation sync plugin
  annotation-sync.test.ts  # New integration tests for Phase 11
```

### Pattern 1: Diff-and-Reconcile Write Path
**What:** On every CM transaction, compare `annotationField` state to Yjs Y.Map state and write only the differences.
**When to use:** Every transaction in `update()` when not a remote sync dispatch.
**Example:**
```typescript
// Source: Pattern derived from existing codebase analysis
update(update: ViewUpdate) {
    // Skip if this dispatch came from our own observeDeep (yjsAnnotationSync annotation)
    if (update.transactions.some(tr => tr.annotation(yjsAnnotationSync))) return;
    
    const cmAnns = update.state.field(annotationField);
    const ydoc = scopeYtext.doc;
    if (!ydoc) return;
    
    ydoc.transact(() => {
        // Diff: find annotations in CM not in Yjs (add), in Yjs not in CM (remove)
        const cmIds = new Set(Object.keys(cmAnns).map(Number));
        const yjsIds = new Set<number>();
        
        scopeAnnotations.forEach((node, yjsKey) => {
            const cmId = this.idMap.getCmId(yjsKey);
            if (cmId !== undefined) yjsIds.add(cmId);
        });
        
        // Remove from Yjs: in Yjs but not in CM
        for (const cmId of yjsIds) {
            if (!cmIds.has(cmId)) {
                const yjsKey = this.idMap.getYjsId(cmId);
                if (yjsKey) scopeAnnotations.delete(yjsKey);
            }
        }
        
        // Add to Yjs: in CM but not in Yjs
        for (const cmId of cmIds) {
            if (!yjsIds.has(cmId)) {
                const ann = cmAnns[cmId];
                const node = codeMirrorToYjsAnnotation(ann, scopeYtext, clientId, ydoc);
                const yjsKey = this.idMap.getOrCreateYjsId(cmId); // Need new method
                scopeAnnotations.set(yjsKey, node);
            }
        }
        
        // Update existing: check for field changes
        for (const cmId of cmIds) {
            if (yjsIds.has(cmId)) {
                const ann = cmAnns[cmId];
                const yjsKey = this.idMap.getYjsId(cmId);
                if (!yjsKey) continue;
                const node = scopeAnnotations.get(yjsKey);
                if (!node) continue;
                
                // Sync specific fields (thread, activeVersionIndex, version text)
                this.syncAnnotationFields(ann, node);
            }
        }
    }, "local");
}
```

### Pattern 2: Per-Version Y.Text Character Sync
**What:** For revision annotations, sync version text character-by-character using Y.Text operations rather than full replacement.
**When to use:** When the active version's doc text changes in CM.
**Example:**
```typescript
// Source: Pattern derived from yjsBinding.ts and existing converters
private syncVersionText(ann: Annotation<"revision">, node: YjsAnnotationNode) {
    const versionsMap = node.get("versions") as Y.Map<Y.Map<unknown>>;
    if (!versionsMap) return;
    
    const vIdx = ann.activeVersionIndex;
    const vNode = versionsMap.get(String(vIdx));
    if (!vNode) return;
    
    const ytext = vNode.get("text") as Y.Text;
    if (!ytext) return;
    
    const cmText = ann.versions[vIdx].doc;
    const yjsText = ytext.toString();
    
    if (cmText === yjsText) return;
    
    // Compute minimal diff (same as yjsBinding.ts pattern)
    const minLen = Math.min(cmText.length, yjsText.length);
    let prefix = 0;
    while (prefix < minLen && cmText[prefix] === yjsText[prefix]) prefix++;
    
    let suffix = 0;
    while (
        suffix < minLen - prefix &&
        cmText[cmText.length - 1 - suffix] === yjsText[yjsText.length - 1 - suffix]
    ) suffix++;
    
    const deleteFrom = prefix;
    const deleteTo = yjsText.length - suffix;
    const insertText = cmText.slice(prefix, cmText.length - suffix);
    
    if (deleteTo > deleteFrom) ytext.delete(deleteFrom, deleteTo - deleteFrom);
    if (insertText) ytext.insert(deleteFrom, insertText);
}
```

### Pattern 3: Full Rebuild on Remote Change
**What:** When `observeDeep` fires for a remote change, rebuild the entire CM annotation from the Yjs node rather than patching incrementally.
**When to use:** All remote changes (origin !== "local").
**Example:**
```typescript
// Source: Existing observeDeep handler in yjsAnnotations.ts
// The current implementation already does this for most cases.
// Phase 11 ensures consistency by removing all partial-update paths.
const rebuildCmIds = new Set<number>();

for (const ev of events) {
    // Any change to scopeAnnotations or nested types -> full rebuild
    if (ev.path.length >= 1) {
        const yjsKey = ev.path[0] as string;
        const cmId = this.idMap.getCmId(yjsKey);
        if (cmId !== undefined) rebuildCmIds.add(cmId);
    }
}

// Apply rebuilds (remove + add) as atomic effect batch
const effects: StateEffect<unknown>[] = [];
for (const cmId of rebuildCmIds) {
    const yjsKey = this.idMap.getYjsId(cmId);
    if (!yjsKey) continue;
    const node = scopeAnnotations.get(yjsKey);
    if (!node) continue;
    const rebuilt = yjsAnnotationToCodeMirror(node, ydoc, scopeYtext, cmId);
    if (!rebuilt) continue;
    const existing = this.view.state.field(annotationField)[cmId];
    if (existing) effects.push(removeAnnotation.of(existing));
    effects.push(addAnnotation.of(rebuilt));
}
```

### Pattern 4: ActiveVersionIndex as Y.Map Field
**What:** Store `activeVersionIndex` as a primitive field on the annotation Y.Map, synced bidirectionally.
**When to use:** Version switches.
**Example:**
```typescript
// Write path (CM -> Yjs)
const cmIndex = ann.activeVersionIndex;
const yjsIndex = node.get("activeVersionIndex") as number | undefined;
if (cmIndex !== yjsIndex) {
    node.set("activeVersionIndex", cmIndex);
}

// Read path (Yjs -> CM) - already in yjsAnnotationToCodeMirror
const rawIndex = node.get("activeVersionIndex") as number | undefined;
const activeVersionIndex = Math.max(0, Math.min(rawIndex ?? 0, versions.length - 1));
```

### Anti-Patterns to Avoid
- **Per-effect branching:** Phase 8/9 had separate handlers for addAnnotation, removeAnnotation, updateThread, _addVersionToRevision, etc. This created edge cases where effects were missed or double-processed. Use a single diff-and-reconcile loop instead.
- **Partial updates on remote changes:** Attempting to patch specific fields on remote changes creates race conditions and state drift. Full rebuild is safer.
- **Y.Text full replacement:** Using `ytext.delete(0, len); ytext.insert(0, newText)` loses CRDT history and causes merge conflicts. Use character-level diff.
- **Synchronous dispatch during observeDeep:** CodeMirror does not allow `dispatch()` during plugin construction or `update()`. Use `queueMicrotask()` for remote change application (already done in existing code).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CRDT conflict resolution | Custom merge logic | Yjs Y.Text/Y.Map operations | Yjs handles concurrent edit merging automatically |
| Position tracking through edits | Manual offset adjustment | Yjs RelativePosition | RelativePosition survives concurrent edits by referencing Y.Items |
| Undo stack management | Custom undo effects | Yjs UndoManager with trackedOrigins | UndoManager tracks local changes only, handles undo grouping |
| Character-level text diff | Custom diff algorithm | lodash isEqual + prefix/suffix matching | Simple prefix/suffix matching is sufficient for CM-like changes |

**Key insight:** The Yjs primitives (Y.Text, Y.Map, Y.Array, RelativePosition, UndoManager) are battle-tested for collaborative editing. The complexity is in the sync layer, not the CRDT operations themselves.

## Common Pitfalls

### Pitfall 1: Feedback Loop Between CM and Yjs
**What goes wrong:** CM dispatch triggers Yjs write, Yjs observeDeep fires, dispatches back to CM, infinite loop.
**Why it happens:** Missing origin tagging or annotation checks.
**How to avoid:** 
- Tag all local Yjs writes with `"local"` origin
- Check `tr.origin === "local"` in observeDeep and skip
- Tag all remote CM dispatches with `yjsAnnotationSync.of(true)`
- Check `yjsAnnotationSync` annotation in `update()` and skip
**Warning signs:** Console spam, browser freeze, stack overflow.

### Pitfall 2: Dispatch During Plugin Construction
**What goes wrong:** `dispatch()` called during ViewPlugin constructor or update(), CodeMirror throws.
**Why it happens:** observeDeep can fire synchronously during plugin setup.
**How to avoid:** Use `queueMicrotask()` to defer dispatch to next tick.
**Warning signs:** "Cannot dispatch during update" error.

### Pitfall 3: Detached Y.Map Access
**What goes wrong:** `ymap.get(key)` returns undefined even though the node was just created.
**Why it happens:** Y.Map children must be integrated into the doc tree before reads.
**How to avoid:** Always `ydoc.transact(() => { ymap.set(key, node); })` before reading.
**Warning signs:** "Invalid access" console warning, undefined values.

### Pitfall 4: Y.Text Observation Scope
**What goes wrong:** Subtree Y.Text changes not captured by observeDeep on the annotations Y.Map.
**Why it happens:** observeDeep on Y.Map catches child Y.Map and Y.Array changes, but Y.Text events may need explicit observation.
**How to avoid:** Test with `annotation-tree.test.ts` patterns; verify Y.Text changes under versions map trigger observeDeep.
**Warning signs:** Version text changes on one peer not propagating to another.

### Pitfall 5: ID Map Desync
**What goes wrong:** CM annotation IDs and Yjs annotation keys get out of sync after reconnect.
**Why it happens:** AnnotationIdMap not persisted or reconstructed incorrectly on reconnect.
**How to avoid:** Initialize idMap from CM state in constructor (existing `_syncIdMapFromCM`), persist idMap state if needed for reconnect.
**Warning signs:** Duplicate annotations, missing annotations after reconnect.

## Code Examples

Verified patterns from the existing codebase:

### Converter Usage (from annotation-tree.test.ts)
```typescript
// Source: src/lib/collab/annotation-tree.test.ts lines 42-52
function buildAndIntegrate(
    annotation: GenericAnnotation,
    host: { ydoc: Y.Doc; ytext: Y.Text; ymap: Y.Map<YjsAnnotationNode> },
    key: string,
): YjsAnnotationNode {
    const node = codeMirrorToYjsAnnotation(annotation, host.ytext, CLIENT_ID, host.ydoc);
    host.ydoc.transact(() => {
        host.ymap.set(key, node);
    });
    return host.ymap.get(key) as YjsAnnotationNode;
}
```

### Origin-Tagged Yjs Transaction (from yjsBinding.ts)
```typescript
// Source: src/lib/collab/yjsBinding.ts lines 86-100
ydoc.transact(() => {
    let delta = 0;
    update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        const from = fromA + delta;
        const len = toA - fromA;
        if (len > 0) ytext.delete(from, len);
        const insText = inserted.toString();
        if (insText.length > 0) ytext.insert(from, insText);
        delta += insText.length - len;
    });
}, "local"); // Origin for UndoManager tracking
```

### Deferred Dispatch Pattern (from yjsAnnotations.ts)
```typescript
// Source: src/lib/collab/yjsAnnotations.ts lines 214-236
queueMicrotask(() => {
    if (this.destroyed) return;
    const effects: ReturnType<typeof addAnnotation.of>[] = [];
    // ... build effects ...
    if (effects.length > 0) {
        this.view.dispatch({
            effects,
            annotations: [
                yjsAnnotationSync.of(true),
                Transaction.addToHistory.of(false),
            ],
        });
    }
});
```

### Two-Peer Test Pattern (from main-text-sync.test.ts)
```typescript
// Source: src/lib/collab/main-text-sync.test.ts lines 30-36
it("peer B receives peer A initial content on connect", () => {
    expect(peerA.view.state.doc.toString()).toBe("initial");
    expect(peerB.view.state.doc.toString()).toBe("initial");
    expect(peerA.ytext.toString()).toBe("initial");
    expect(peerB.ytext.toString()).toBe("initial");
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-effect sync handlers | Diff-and-reconcile | Phase 11 | Eliminates edge cases where effects are missed |
| JSON blob version sync | Y.Text per-version | Phase 8.5a (shape) | Enables character-level merge |
| Effect-by-effect write | Single write path | Phase 11 | Simpler, more maintainable |
| Partial remote updates | Full rebuild | Phase 11 | Consistent state, no drift |

**Deprecated/outdated:**
- `syncRevisionChanges` JSON-diff path: Deleted in Phase 8.5b
- Effect-by-effect handlers: Deleted in Phase 10
- `hasSubtreeForRevision` short-circuit: Deleted in Phase 10
- `_hasCollabSubtree` branching: Deleted in Phase 10

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | observeDeep on Y.Map catches Y.Text changes in nested version maps | Architecture Patterns | May need explicit Y.Text observation per version |
| A2 | Full rebuild is fast enough for <1000 annotations | Standard Stack Alternatives | May need incremental patch for large docs |
| A3 | Character-level diff on Y.Text is sufficient (no need for operational transform) | Pattern 2 | Concurrent edits may not merge as expected |

## Open Questions

1. **Y.Text Observation Scope**
   - What we know: observeDeep on Y.Map fires for child Y.Map and Y.Array changes
   - What's unclear: Whether Y.Text changes nested inside versions map trigger observeDeep
   - Recommendation: Add explicit test in annotation-tree.test.ts to verify; if not, add per-version Y.Text observers

2. **Reconnection ID Map State**
   - What we know: AnnotationIdMap tracks CM ID <-> Yjs ID mappings
   - What's unclear: Whether idMap state persists correctly across reconnect scenarios
   - Recommendation: Test reconnect scenario explicitly; may need to persist idMap to Yjs or reconstruct from Y.Map keys

3. **Nested Editor Sync (Phase 12 concern)**
   - What we know: Phase 10 removed subtree bindings from NestedEditorController
   - What's unclear: Whether Phase 11's unified sync handles nested editor scenarios or if Phase 12 needs additional work
   - Recommendation: Phase 11 tests should verify revision version text syncs even when nested editor is open; nested editor unification is Phase 12's scope

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.4 |
| Config file | vitest.config.ts |
| Quick run command | `bun run test:run src/lib/collab/annotation-sync.test.ts` |
| Full suite command | `bun run test:run src/lib/collab/` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SYNC-05-1 | Annotations Y.Map mirrors GenericAnnotation shape | unit | `bun run test:run src/lib/collab/annotation-tree.test.ts` | Exists |
| SYNC-05-2 | Single diff-and-write function on every transaction | integration | `bun run test:run src/lib/collab/annotation-sync.test.ts` | Wave 0 |
| SYNC-05-3 | observeDeep drives single rebuild path | integration | `bun run test:run src/lib/collab/annotation-sync.test.ts` | Wave 0 |
| SYNC-05-4 | Revision version text merges character-by-character | integration | `bun run test:run src/lib/collab/annotation-sync.test.ts` | Wave 0 |
| SYNC-05-5 | activeVersionIndex syncs between peers | integration | `bun run test:run src/lib/collab/annotation-sync.test.ts` | Wave 0 |
| SYNC-05-6 | Add/delete version, thread append round-trip | integration | `bun run test:run src/lib/collab/annotation-sync.test.ts` | Wave 0 |
| SYNC-05-7 | Joiner sees owner's pre-existing annotations | integration | `bun run test:run src/lib/collab/annotation-sync.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `bun run test:run src/lib/collab/annotation-sync.test.ts -x`
- **Per wave merge:** `bun run test:run src/lib/collab/`
- **Phase gate:** Full collab suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/lib/collab/annotation-sync.test.ts` -- new integration test file for Phase 11 success criteria
- [ ] Extend `twoPeerHarness.ts` to include annotation sync plugin

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Auth handled by Supabase in separate layer |
| V3 Session Management | no | Session handled by yjsProvider |
| V4 Access Control | no | Document access controlled by relay server |
| V5 Input Validation | yes | yjsAnnotationToCodeMirror validates shape before use |
| V6 Cryptography | no | No crypto in sync layer |

### Known Threat Patterns for Yjs Sync

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed Yjs node injection | Tampering | yjsAnnotationToCodeMirror returns null on malformed data (T-08.5-03-02) |
| Remote cursor XSS | Tampering | textContent not innerHTML for cursor labels (T-07.5-02) |
| Infinite loop via origin confusion | Denial | Origin tagging with "local" + yjsAnnotationSync annotation (T-08.5-03-01) |

## Sources

### Primary (HIGH confidence)
- [VERIFIED: src/lib/collab/yjsAnnotations.ts] - Current stripped plugin implementation
- [VERIFIED: src/lib/collab/annotationSchema.ts] - Converter implementation
- [VERIFIED: src/lib/collab/annotation-tree.test.ts] - Shape integrity tests
- [VERIFIED: src/lib/collab/yjsBinding.ts] - Y.Text <-> CM sync pattern
- [VERIFIED: src/lib/collab/main-text-sync.test.ts] - Two-peer test pattern

### Secondary (MEDIUM confidence)
- [CITED: Context7 /yjs/yjs] - observeDeep documentation
- [CITED: Context7 /yjs/yjs] - Transaction origin tracking

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all packages already installed and verified
- Architecture: HIGH - patterns derived from working codebase
- Pitfalls: HIGH - pitfalls observed in Phase 8/9/10 debugging

**Research date:** 2026-04-19
**Valid until:** 2026-05-19 (30 days - stable patterns)
