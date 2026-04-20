# Phase 11: Unified Subtree Sync Rebuild - Pattern Map

**Mapped:** 2026-04-19
**Files analyzed:** 3 (new/modified files)
**Analogs found:** 3 / 3

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/collab/yjsAnnotations.ts` | service | event-driven (CRDT sync) | `src/lib/collab/yjsBinding.ts` | exact |
| `src/lib/collab/annotation-sync.test.ts` | test | request-response | `src/lib/collab/main-text-sync.test.ts` | exact |
| `src/lib/collab/test-helpers/twoPeerHarness.ts` | utility | CRDT sync | (self - extend existing) | exact |

## Pattern Assignments

### `src/lib/collab/yjsAnnotations.ts` (service, event-driven CRDT sync)

**Analog:** `src/lib/collab/yjsBinding.ts`

**Purpose:** Modify the `update()` method to implement a diff-and-reconcile write path from CodeMirror annotationField to Yjs Y.Map, using character-level Y.Text operations for revision version text.

**Imports pattern** (lines 1-16):
```typescript
/**
 * yjsBinding.ts -- Custom Y.Text <-> CodeMirror 6 binding.
 *
 * Per D-72: Build custom binding since y-codemirror.next is unmaintained.
 * Bidirectional sync between Y.Text shared type and CodeMirror EditorState.
 *
 * Key patterns:
 * - Y.Text -> CodeMirror: observe() callback dispatches changes
 * - CodeMirror -> Y.Text: update() handler applies changes in transact()
 * - yjsAnnotation marks remote changes to prevent feedback loops
 * - 'local' origin for UndoManager tracking (per D-74)
 */
import { ViewPlugin, type ViewUpdate, type EditorView } from "@codemirror/view";
import { Annotation } from "@codemirror/state";
import type * as Y from "yjs";
```

**Origin-tagged Yjs transaction pattern** (lines 86-100):
```typescript
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

**Feedback loop prevention pattern** (lines 72-78):
```typescript
update(update: ViewUpdate) {
    // CodeMirror -> Y.Text
    // Skip if this transaction came from Y.Text (has yjsAnnotation)
    if (
        update.docChanged &&
        !update.transactions.some((tr) => tr.annotation(yjsAnnotation))
    ) {
```

**Additional Analog:** `src/lib/collab/annotationSchema.ts` for converters

**Converter usage pattern** (lines 49-102):
```typescript
export function codeMirrorToYjsAnnotation(
    annotation: GenericAnnotation,
    ytext: Y.Text,
    clientId: string,
    ydoc: Y.Doc,
): YjsAnnotationNode {
    const { startPos, endPos } = absoluteToRelative(ytext, annotation.selection);
    const node: YjsAnnotationNode = new Y.Map<unknown>();

    ydoc.transact(() => {
        node.set("id", generateAnnotationId(clientId));
        node.set("_type", annotation._type);
        node.set("startPos", startPos);
        node.set("endPos", endPos);
        // ... remaining fields
    }, "init");

    return node;
}
```

**Character-level Y.Text diff pattern** (from RESEARCH.md Pattern 2):
```typescript
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
```

---

### `src/lib/collab/annotation-sync.test.ts` (test, two-peer integration)

**Analog:** `src/lib/collab/main-text-sync.test.ts`

**Purpose:** New integration test file for Phase 11 annotation sync success criteria.

**Imports pattern** (lines 1-11):
```typescript
/**
 * main-text-sync.test.ts -- Phase 10 integration test proving main text sync works.
 *
 * Success criterion #8: "two peers connected via the twoPeerHarness, main text
 * edits on peer A character-wise appear on peer B"
 *
 * This test uses the stripped twoPeerHarness (no annotation sync) to verify
 * that Yjs text binding still works after Phase 10's cleanup.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makePeer, connect, teardown, type Peer } from "./test-helpers/twoPeerHarness";
```

**Test setup/teardown pattern** (lines 13-28):
```typescript
describe("main text sync (Phase 10 verification)", () => {
    let peerA: Peer;
    let peerB: Peer;
    let disconnect: () => void;

    beforeEach(() => {
        peerA = makePeer("peer-a", "initial");
        peerB = makePeer("peer-b");
        disconnect = connect(peerA, peerB);
    });

    afterEach(() => {
        disconnect();
        teardown(peerA);
        teardown(peerB);
    });
```

**Two-peer sync assertion pattern** (lines 30-36):
```typescript
it("peer B receives peer A initial content on connect", () => {
    // After connect(), initial sync should have propagated
    expect(peerA.view.state.doc.toString()).toBe("initial");
    expect(peerB.view.state.doc.toString()).toBe("initial");
    expect(peerA.ytext.toString()).toBe("initial");
    expect(peerB.ytext.toString()).toBe("initial");
});
```

**Character-level edit verification pattern** (lines 38-45):
```typescript
it("character-wise insert on peer A appears on peer B", () => {
    // Type "X" at position 0 on peer A
    peerA.view.dispatch({ changes: { from: 0, insert: "X" } });

    // Should appear on peer B
    expect(peerA.view.state.doc.toString()).toBe("Xinitial");
    expect(peerB.view.state.doc.toString()).toBe("Xinitial");
});
```

**Additional Analog:** `src/lib/collab/annotation-tree.test.ts` for annotation-specific patterns

**Annotation creation helper pattern** (lines 42-52):
```typescript
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

**Annotation field access pattern** (from yjsAnnotations.test.ts lines 170-174):
```typescript
// The pre-existing annotation should now be in CodeMirror
const annotations = view2.state.field(annotationField);
expect(Object.keys(annotations).length).toBe(1);
const ann = Object.values(annotations)[0];
expect(isAnnotationOfType(ann, "comment")).toBe(true);
```

---

### `src/lib/collab/test-helpers/twoPeerHarness.ts` (utility, CRDT sync harness)

**Analog:** Self (extend existing file)

**Purpose:** Add annotation sync plugin to the existing harness for Phase 11 tests.

**Current Peer interface** (lines 24-33):
```typescript
export interface Peer {
    ydoc: Y.Doc;
    ytext: Y.Text;
    // NOTE: ymap value type intentionally `unknown` — Plan 8.5a-02 rewrites the
    // annotation shape from YjsAnnotation (flat) to Y.Map (recursive).
    // Using `unknown` here keeps this harness compatible across both.
    ymap: Y.Map<unknown>;
    view: EditorView;
    clientId: string;
}
```

**Current makePeer implementation** (lines 35-52):
```typescript
export function makePeer(clientId: string, initialText = ""): Peer {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("document");
    const ymap = ydoc.getMap<unknown>("annotations");
    if (initialText) {
        ydoc.transact(() => ytext.insert(0, initialText), "init");
    }
    const state = EditorState.create({
        doc: initialText,
        extensions: [
            annotationField,
            createYjsBinding(ytext),
            // Phase 10: Annotation sync plugin removed. Main text sync only.
        ],
    });
    const view = new EditorView({ state, parent: document.body });
    return { ydoc, ytext, ymap, view, clientId };
}
```

**Extension pattern for annotation sync** (add to makePeer):
```typescript
// Phase 11: Re-add annotation sync plugin
const idMap = new AnnotationIdMap();
const state = EditorState.create({
    doc: initialText,
    extensions: [
        annotationField,
        createYjsBinding(ytext),
        createAnnotationSyncPlugin(ytext, ymap as Y.Map<YjsAnnotationNode>, clientId, idMap),
    ],
});
```

**Connect function pattern** (lines 54-72):
```typescript
export function connect(a: Peer, b: Peer): () => void {
    const aToB = (update: Uint8Array, origin: unknown) => {
        if (origin === "remote") return;
        Y.applyUpdate(b.ydoc, update, "remote");
    };
    const bToA = (update: Uint8Array, origin: unknown) => {
        if (origin === "remote") return;
        Y.applyUpdate(a.ydoc, update, "remote");
    };
    a.ydoc.on("update", aToB);
    b.ydoc.on("update", bToA);
    // Initial two-way state sync.
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc), "remote");
    Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc), "remote");
    return () => {
        a.ydoc.off("update", aToB);
        b.ydoc.off("update", bToA);
    };
}
```

---

## Shared Patterns

### Feedback Loop Prevention
**Source:** `src/lib/collab/yjsAnnotations.ts` lines 38, 61, 119-129
**Apply to:** All sync plugin update() methods

```typescript
// CM annotation to mark dispatches originating from Yjs (skip in update())
export const yjsAnnotationSync = Annotation.define<boolean>();

// In observeDeep handler, skip local origin
if (this.destroyed || tr.origin === "local") return;

// In update(), skip Yjs-originated transactions
if (update.transactions.some(tr => tr.annotation(yjsAnnotationSync))) return;
```

### Origin-Tagged Yjs Transactions
**Source:** `src/lib/collab/yjsBinding.ts` lines 86-100
**Apply to:** All CM -> Yjs write paths

```typescript
ydoc.transact(() => {
    // mutations here
}, "local"); // Origin for UndoManager tracking and loop prevention
```

### Deferred Dispatch Pattern
**Source:** `src/lib/collab/yjsAnnotations.ts` lines 214-236
**Apply to:** All remote change application paths

```typescript
// CodeMirror doesn't allow dispatch() during plugin construction or update().
// queueMicrotask defers to the next event loop tick.
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

### Annotation Type Guard Usage
**Source:** `src/lib/editor/plugins/annotations/models.ts` (project convention)
**Apply to:** All annotation type checks

```typescript
// NEVER: annotation._type === "revision"
// ALWAYS: isAnnotationOfType(annotation, "revision")
import { isAnnotationOfType } from "$lib/editor/plugins/annotations/models";

if (isAnnotationOfType(annotation, "revision")) {
    // TypeScript narrows to Annotation<"revision">
}
```

### Test Assertion Patterns
**Source:** `src/lib/collab/main-text-sync.test.ts`, `src/lib/collab/annotation-tree.test.ts`
**Apply to:** `annotation-sync.test.ts`

```typescript
// For two-peer sync tests, always check both peers + both layers
expect(peerA.view.state.doc.toString()).toBe(expected);
expect(peerB.view.state.doc.toString()).toBe(expected);
expect(peerA.ytext.toString()).toBe(expected);
expect(peerB.ytext.toString()).toBe(expected);

// For annotation sync, check annotationField on both peers
const annA = peerA.view.state.field(annotationField);
const annB = peerB.view.state.field(annotationField);
expect(Object.keys(annA).length).toBe(1);
expect(Object.keys(annB).length).toBe(1);
```

---

## No Analog Found

No files without analogs. All files have exact or role-match analogs in the existing codebase.

---

## Metadata

**Analog search scope:** `src/lib/collab/`
**Files scanned:** 15
**Pattern extraction date:** 2026-04-19

### Key Implementation Notes

1. **Write path in update():** The current `update()` method at line 239-243 is intentionally empty (`return;`). Phase 11 fills this with the diff-and-reconcile logic from RESEARCH.md Pattern 1.

2. **AnnotationIdMap extension:** May need `getOrCreateYjsId(cmId)` method to generate Yjs keys for new CM annotations (inverse of existing `getOrCreateCmId`).

3. **Y.Text character sync:** Use the prefix/suffix diff pattern from `yjsBinding.ts` adapted for revision version Y.Text subtrees.

4. **Test structure:** Follow `main-text-sync.test.ts` structure but add annotation-specific assertions per RESEARCH.md requirements (SYNC-05-1 through SYNC-05-7).
