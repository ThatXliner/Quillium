# Phase 8: Annotation Sync - Pattern Map

**Mapped:** 2026-04-17
**Files analyzed:** 6 (new/modified)
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/collab/yjsAnnotations.ts` | service | bidirectional-sync | `src/lib/collab/yjsBinding.ts` | exact |
| `src/lib/collab/annotationSchema.ts` | model | transform | `src/lib/editor/plugins/annotations/models.ts` | exact |
| `src/lib/collab/relativePosition.ts` | utility | transform | `src/lib/editor/plugins/annotations/utils.ts` | role-match |
| `src/lib/collab/yjsUndo.ts` (MODIFY) | service | event-driven | self | exact |
| `src/lib/collab/types.ts` (MODIFY) | model | type-defs | self | exact |
| `src/lib/collab/index.ts` (MODIFY) | barrel | re-export | self | exact |

## Pattern Assignments

### `src/lib/collab/yjsAnnotations.ts` (service, bidirectional-sync)

**Analog:** `src/lib/collab/yjsBinding.ts`

**Imports pattern** (lines 1-15):
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

**Annotation for origin tracking** (line 18):
```typescript
/** Annotation to mark transactions originating from Y.Text (prevents feedback loop) */
export const yjsAnnotation = Annotation.define<boolean>();
```

**ViewPlugin class structure** (lines 26-113):
```typescript
export function createYjsBinding(ytext: Y.Text) {
    return ViewPlugin.fromClass(
        class {
            private observer: (event: Y.YTextEvent, tr: Y.Transaction) => void;
            private destroyed = false;

            constructor(private view: EditorView) {
                // Y.Text -> CodeMirror
                this.observer = (event, yTransaction) => {
                    // Skip if destroyed or if this change originated from CodeMirror (origin === "local")
                    if (this.destroyed || yTransaction.origin === "local") return;
                    // ... apply changes to view
                };
                ytext.observe(this.observer);
            }

            update(update: ViewUpdate) {
                // CodeMirror -> Y.Text
                // Skip if this transaction came from Y.Text (has yjsAnnotation)
                if (
                    update.docChanged &&
                    !update.transactions.some((tr) => tr.annotation(yjsAnnotation))
                ) {
                    const ydoc = ytext.doc;
                    if (ydoc) {
                        ydoc.transact(() => {
                            // ... apply changes to ytext
                        }, "local"); // Origin for UndoManager (per D-74)
                    }
                }
            }

            destroy() {
                this.destroyed = true;
                ytext.unobserve(this.observer);
            }
        },
    );
}
```

**Key pattern: Bidirectional sync with origin tracking**
- Yjs -> CodeMirror: Use `ymap.observe()`, check `yTransaction.origin === "local"` to skip own changes
- CodeMirror -> Yjs: Use `update(ViewUpdate)`, check `tr.annotation(yjsAnnotation)` to skip Yjs-originated transactions
- Use `ydoc.transact(() => {...}, "local")` for local changes so UndoManager tracks them

---

### `src/lib/collab/annotationSchema.ts` (model, transform)

**Analog:** `src/lib/editor/plugins/annotations/models.ts`

**Type definitions pattern** (lines 31-55):
```typescript
// Plain objects rather than classes for JSON serializability (required by
// CodeMirror StateField toJSON/fromJSON).
export type ThreadMessage = { message: string; author: string; time: number };
export type Thread = ThreadMessage[];

type BaseAnnotation = {
    selection: EditorSelection;
    id: number;
    thread: Thread;
};

// DO NOT COMPARE _type; instead use isAnnotationOfType
type CommentAnnotation = BaseAnnotation & {
    _type: "comment";
};

export type VersionState = object & {
    doc: string;
    label?: string;
    annotationGeneration?: number;
};

type RevisionAnnotation = BaseAnnotation & {
    _type: "revision";
    activeVersionIndex: number;
    versions: VersionState[];
};
```

**Type guard pattern** (lines 43-48):
```typescript
export function isAnnotationOfType<T extends AnnotationType>(
    annotation: GenericAnnotation,
    type: T,
): annotation is Annotation<T> {
    return annotation._type === type;
}
```

**Zod schema pattern** (lines 126-173):
```typescript
export const ThreadMessageSchema = z.object({
    message: z.string(),
    author: z.string(),
    time: z.number(),
});

const EditorSelectionSchema = z
    .object({
        ranges: z.array(z.object({ anchor: z.number(), head: z.number() })).min(1),
        main: z.number().optional(),
    })
    .passthrough();

export const RawAnnotationSchema = z.discriminatedUnion("_type", [
    RawBaseSchema.extend({ _type: z.literal("comment") }),
    RawBaseSchema.extend({
        _type: z.literal("suggestion"),
        replacements: z.array(SuggestionReplacementSchema),
        author: z.string().optional(),
    }),
    RawBaseSchema.extend({
        _type: z.literal("revision"),
        activeVersionIndex: z.number(),
        versions: z.array(VersionStateSchema).min(1),
    }),
]);
```

**Key pattern: Yjs annotation schema should:**
- Store `startPos`/`endPos` as `Uint8Array` (encoded RelativePosition)
- Store `thread`, `replacements`, `versions` as JSON strings (avoid nested Y.Array per Yjs bug #642)
- Include `id: string` (client-prefixed for collision avoidance)
- Use Zod for validation when deserializing from Y.Map

---

### `src/lib/collab/relativePosition.ts` (utility, transform)

**Analog:** `src/lib/editor/plugins/annotations/utils.ts`

**Utility function pattern** (from `utils.ts` lines 1-70):
```typescript
/**
 * utils.ts -- Annotation query/transform utilities.
 *
 * Contains pure functions for:
 *   - Range validation and cleanup (cleanRangesOf)
 *   - Position mapping through changes (mapRange)
 *   - Cursor position queries (getAnnotationAt)
 */
import { EditorSelection, type ChangeDesc, type SelectionRange } from "@codemirror/state";
import type { GenericAnnotation } from "./models";

// Pure query function returning union type
export function cleanRangesOf(
    selection: EditorSelection,
    allowEmpty: boolean = false,
): EditorSelection | null {
    const filtered = selection.ranges.filter((r) => allowEmpty || !r.empty);
    if (filtered.length === 0) return null;
    return EditorSelection.create(filtered, /* main index logic */);
}

// Effect mapper function
export function mapRange(ann: GenericAnnotation, change: ChangeDesc): GenericAnnotation {
    // ... position mapping logic
}
```

**Key pattern: RelativePosition utilities should:**
- Export `absoluteToRelative(ytext, selection)` -> `{ startPos: Uint8Array, endPos: Uint8Array }`
- Export `relativeToAbsolute(ydoc, ytext, startPos, endPos)` -> `EditorSelection | null`
- Handle `null` gracefully when referenced text is deleted
- Use pure functions with explicit return types

---

### `src/lib/collab/yjsUndo.ts` (MODIFY: extend to track Y.Map)

**Current implementation** (lines 32-39):
```typescript
export function createYjsUndoExtension(ytext: Y.Text): {
    extension: Extension;
    undoManager: Y.UndoManager;
} {
    const undoManager = new Y.UndoManager(ytext, {
        trackedOrigins: new Set(["local"]), // Only undo local changes (per D-74)
        captureTimeout: 500, // Merge rapid typing into single undo step
    });
    // ... keymap setup
}
```

**D-83 unified stack modification:**
```typescript
// Current: tracks only ytext
const undoManager = new Y.UndoManager(ytext, { ... });

// Updated: tracks both ytext and ymap (D-83 unified stack)
const undoManager = new Y.UndoManager([ytext, ymap], {
    trackedOrigins: new Set(["local"]),
    captureTimeout: 500,
});
```

**Key pattern:**
- Extend function signature to accept `ymap: Y.Map<YjsAnnotation>`
- Pass array `[ytext, ymap]` as first argument to UndoManager
- Keep existing keymap bindings unchanged

---

### `src/lib/collab/types.ts` (MODIFY: extend with annotation sync types)

**Current types** (lines 1-42):
```typescript
/**
 * types.ts -- Collab-related types.
 */
import type * as Y from "yjs";
import type { WebsocketProvider } from "y-websocket";
import type { Awareness } from "y-protocols/awareness";

/** Active collab session state (Yjs-based) */
export type CollabSession = {
    docId: string;
    clientID: string;
    isOwner: boolean;
    ydoc: Y.Doc;
    provider: WebsocketProvider;
    awareness: Awareness;
};

/** Connection state for UI display */
export type CollabState = "disconnected" | "connecting" | "connected" | ...;
```

**Extension pattern:**
```typescript
// Add Yjs annotation type for sync
export interface YjsAnnotation {
    id: string;                    // Client ID prefixed for uniqueness
    _type: "comment" | "suggestion" | "revision";
    startPos: Uint8Array;          // Encoded RelativePosition
    endPos: Uint8Array;            // Encoded RelativePosition
    thread: string;                // JSON-serialized Thread (avoid nested Y.Array)
    replacements?: string;         // JSON for suggestions
    versions?: string;             // JSON for revisions
    activeVersionIndex?: number;   // For revisions
}

// Extend CollabSession
export type CollabSession = {
    // ... existing fields
    ymap: Y.Map<YjsAnnotation>;    // Annotation sync map
};
```

---

### `src/lib/collab/index.ts` (MODIFY: re-export new modules)

**Current re-export pattern** (lines 19-40):
```typescript
// Yjs modules
import { createYjsBinding } from "./yjsBinding";
import { createYjsUndoExtension } from "./yjsUndo";
import { createAwarenessExtension, colorForClient } from "./awareness";
import {
    createYjsProvider,
    disconnectYjsProvider,
    // ...
} from "./yjsProvider";

// Types
export type { CollabSession, CollabState } from "./types";

// Re-exports
export { collabState, ownerLeftSignal, pendingUpdatesCount, reconnectAttempt } from "./store";
export { colorForClient } from "./awareness";
export { relayConfigured, getYjsProvider, getCurrentDocId } from "./yjsProvider";
```

**Extension pattern:**
```typescript
// Add new module imports
import { createAnnotationSyncPlugin, yjsAnnotationSync } from "./yjsAnnotations";
import { absoluteToRelative, relativeToAbsolute } from "./relativePosition";
import type { YjsAnnotation } from "./annotationSchema";

// Add to re-exports
export { createAnnotationSyncPlugin, yjsAnnotationSync } from "./yjsAnnotations";
export { absoluteToRelative, relativeToAbsolute } from "./relativePosition";
export type { YjsAnnotation } from "./annotationSchema";
```

---

## Shared Patterns

### StateEffect bridging to Yjs
**Source:** `src/lib/editor/plugins/annotations/annotationField.ts`
**Apply to:** `src/lib/collab/yjsAnnotations.ts`

From annotationField.ts (lines 87-120):
```typescript
export const addAnnotation = StateEffect.define<GenericAnnotation>({
    map: mapRange,
});
export const removeAnnotation = StateEffect.define<GenericAnnotation>({
    map: mapRange,
});
export const updateThread = StateEffect.define<{
    annotationId: number;
    newThread: Thread;
}>();
```

**Bridge pattern:** Listen for these effects in ViewPlugin `update()`, translate to Y.Map mutations:
```typescript
for (const tr of viewUpdate.transactions) {
    for (const effect of tr.effects) {
        if (effect.is(addAnnotation)) {
            const yjsAnn = codeMirrorToYjsAnnotation(effect.value, ytext);
            ydoc.transact(() => ymap.set(String(effect.value.id), yjsAnn), "local");
        } else if (effect.is(removeAnnotation)) {
            ydoc.transact(() => ymap.delete(String(effect.value.id)), "local");
        }
    }
}
```

### Error handling
**Source:** `src/lib/editor/listeners.ts`, `src/lib/errorGuard.ts`
**Apply to:** All collab files

```typescript
// Log with module prefix
console.error("[yjsAnnotations] Failed to apply remote annotation:", error);
console.warn("[relativePosition] Position returned null, annotation text may have been deleted");
```

### Test structure
**Source:** `src/lib/collab/yjsBinding.test.ts`, `src/lib/collab/yjsBinding.convergence.test.ts`
**Apply to:** New test files

Unit test pattern:
```typescript
describe("yjsAnnotations", () => {
    let ydoc: Y.Doc;
    let ytext: Y.Text;
    let ymap: Y.Map<YjsAnnotation>;
    let view: EditorView;

    beforeEach(() => {
        ydoc = new Y.Doc();
        ytext = ydoc.getText("document");
        ymap = ydoc.getMap("annotations");
        const state = EditorState.create({ 
            doc: "", 
            extensions: [annotationField, createAnnotationSyncPlugin(ytext, ymap)] 
        });
        view = new EditorView({ state, parent: document.body });
    });

    afterEach(() => {
        view.destroy();
        ydoc.destroy();
    });

    // ... tests
});
```

Convergence test pattern (from yjsBinding.convergence.test.ts):
```typescript
interface Peer {
    ydoc: Y.Doc;
    ytext: Y.Text;
    ymap: Y.Map<YjsAnnotation>;
    view: EditorView;
}

function connect(a: Peer, b: Peer): () => void {
    const aToB = (update: Uint8Array, origin: unknown) => {
        if (origin === "remote") return;
        Y.applyUpdate(b.ydoc, update, "remote");
    };
    // ... bidirectional relay
}
```

---

## No Analog Found

No files are without analogs. All new files have strong matches in the existing codebase.

---

## Metadata

**Analog search scope:** `src/lib/collab/`, `src/lib/editor/plugins/annotations/`
**Files scanned:** 12
**Pattern extraction date:** 2026-04-17
