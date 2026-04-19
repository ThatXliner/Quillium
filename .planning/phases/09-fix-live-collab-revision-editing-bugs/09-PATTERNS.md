# Phase 9: Fix Live Collab Revision Editing Bugs - Pattern Map

**Mapped:** 2026-04-19
**Files analyzed:** 8
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/collab/revision-lifecycle.test.ts` | test | event-driven | `src/lib/collab/yjsAnnotations.convergence.test.ts` | exact |
| `src/lib/collab/index.ts` | service | request-response | (self) | self-modify |
| `src/lib/collab/GoLiveButton.svelte` | component | event-driven | (self) | self-modify |
| `src/lib/collab/store.ts` | store | CRUD | (self) | self-modify |
| `src/lib/collab/yjsAnnotations.ts` | service | event-driven | (self) | self-modify |
| `src/lib/navigation.ts` | utility | request-response | (self) | self-modify |
| `src/lib/editor/plugins/annotations/NestedEditorController.ts` | controller | event-driven | (self) | self-modify |
| `src/lib/editor/listeners.ts` | service | event-driven | (self) | self-modify |

## Pattern Assignments

### `src/lib/collab/revision-lifecycle.test.ts` (test, event-driven)

**Analog:** `src/lib/collab/yjsAnnotations.convergence.test.ts`

This is a NEW file. Use the established two-peer convergence test patterns.

**Imports pattern** (lines 1-23):
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import * as Y from "yjs";
import { createYjsBinding } from "./yjsBinding";
import { createAnnotationSyncPlugin } from "./yjsAnnotations";
import {
    addAnnotation,
    removeAnnotation,
    updateThread,
    annotationField,
    _updateRevisionVersionDoc,
} from "$lib/editor/plugins/annotations/annotationField";
import type { YjsAnnotationNode } from "./types";
import type { GenericAnnotation } from "$lib/editor/plugins/annotations/models";
```

**Two-peer harness pattern** (from `test-helpers/twoPeerHarness.ts` lines 36-59):
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
            createAnnotationSyncPlugin(ytext, ymap as Y.Map<never>, clientId),
        ],
    });
    const view = new EditorView({ state, parent: document.body });
    return { ydoc, ytext, ymap, view, clientId };
}
```

**Connect pattern with initial sync** (lines 61-79):
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

**Test structure pattern** (from `yjsAnnotations.convergence.test.ts` lines 99-117):
```typescript
describe("revision lifecycle (Phase 9)", () => {
    let peerA: Peer;
    let peerB: Peer;
    let disconnect: () => void;

    beforeEach(() => {
        peerA = makePeer("client-a", "hello world");
        peerB = makePeer("client-b");
        disconnect = connect(peerA, peerB);
    });

    afterEach(() => {
        disconnect();
        peerA.view.destroy();
        peerB.view.destroy();
        peerA.ydoc.destroy();
        peerB.ydoc.destroy();
    });
    
    // tests...
});
```

**Revision creation helper pattern** (from `yjsAnnotations.convergence.test.ts` lines 283-295):
```typescript
const revision: GenericAnnotation = {
    id: 0,
    _type: "revision",
    selection: EditorSelection.single(0, 5),
    thread: [],
    versions: [{ doc: "hello" }, { doc: "world" }],
    activeVersionIndex: 0,
};
peerA.view.dispatch({ effects: [addAnnotation.of(revision)] });
```

**Subtree Y.Text edit simulation** (from `yjsAnnotations.convergence.test.ts` lines 341-360):
```typescript
// Simulate nested editor typing:
// 1. yjsBinding updates the version's Y.Text
// 2. onNestedUpdate dispatches _updateRevisionVersionDoc to sync parent CM state
const yjsAnnKey = Array.from(peerA.ymap.keys())[0];
const revNode = peerA.ymap.get(yjsAnnKey)!;
const versionsMap = revNode.get("versions") as Y.Map<Y.Map<unknown>>;
const v0 = versionsMap.get("0")!;
const vtext = v0.get("text") as Y.Text;

// Step 1: Update Y.Text (like yjsBinding does)
peerA.ydoc.transact(() => {
    vtext.insert(vtext.length, " world");
}, "local");

// Step 2: Update parent CM state (like NestedEditorController.onNestedUpdate does)
peerA.view.dispatch({
    effects: [
        _updateRevisionVersionDoc.of({
            annotationId: 0,
            versionIndex: 0,
            doc: "hello world",
        }),
    ],
});
```

---

### `src/lib/collab/index.ts` (service, request-response)

**Self-modify.** D-100 changes the joiner path.

**Current enableCollab pattern** (lines 116-196):
```typescript
export async function enableCollab(
    view: EditorView,
    docId: string,
    clientID: string,
    asOwner: boolean = true,
): Promise<void> {
    // Connect to Yjs relay
    const { provider, awareness, ydoc, ytext, ymap } = await createYjsProvider(docId);

    // Get local content before connecting
    const localDoc = view.state.doc.toString();

    // Wait for initial sync with timeout
    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error("Sync timeout"));
        }, 10000);
        // ...
    });

    // After sync, determine authoritative content
    if (asOwner) {
        // Owner ALWAYS seeds with local content (D-55)
        // ...
    } else if (remoteContent.length > 0) {
        // Joiner: relay content is authoritative
        // ...
    }
    // ...
}
```

**Extension installation pattern** (lines 251-254):
```typescript
// Install Yjs collab extension - includes annotation sync
view.dispatch({
    effects: collabCompartment.reconfigure([binding, undoExt, awarenessExt, annotationSync]),
});
```

---

### `src/lib/collab/GoLiveButton.svelte` (component, event-driven)

**Self-modify.** D-100 changes joinById to create ephemeral view.

**Join by ID pattern** (lines 70-119):
```typescript
async function joinById() {
    const id = joinIdInput.trim();
    if (!id) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        toast.error("Invalid document ID format");
        return;
    }

    connecting = true;
    menuOpen = false;
    try {
        const view = get(editorView);
        const user = getUser();
        const session = getSession();
        if (!view || !user || !session) {
            throw new Error("Missing required state");
        }

        // Disconnect current session if live
        if (isLive) {
            disableCollab(view);
            isLive = false;
        }

        // Switch to shared document ID
        currentDraftId.set(id);

        // Mark this client as an ephemeral joiner BEFORE connecting
        isCollabJoiner.set(true);

        // Connect as joiner -- relay's content becomes source of truth
        await enableCollab(view, id, user.id, false);

        joinIdInput = "";
        isLive = true;
        toast.success("Joined shared document");
    } catch (err) {
        console.error("[collab] Failed to join:", err);
        isCollabJoiner.set(false);
        // ...
    }
}
```

**Owner-left handler pattern** (lines 31-39):
```typescript
$effect(() => {
    if ($ownerLeftSignal > 0 && isLive) {
        // Provider already disconnected via handleOwnerLeft, just update UI state
        isLive = false;
        // Reset joiner flag -- persistence resumes normally after kick
        isCollabJoiner.set(false);
        toast.error("The owner ended the session");
    }
});
```

---

### `src/lib/collab/store.ts` (store, CRUD)

**Self-modify.** `isCollabJoiner` already exists; may need joiner prior-view state.

**Store definition pattern** (lines 1-43):
```typescript
import { writable } from "svelte/store";
import type { CollabState, CollabSession } from "./types";

export const collabState = writable<CollabState>("disconnected");

/**
 * Active collab session (null when not in collab mode).
 */
export const collabSession = writable<CollabSession | null>(null);

/**
 * True when this client joined someone else's live session (not the owner).
 * In Live Room mode, joiners are ephemeral viewers -- they should NOT persist
 * anything to the local event log, since the document belongs to the owner.
 */
export const isCollabJoiner = writable(false);
```

---

### `src/lib/collab/yjsAnnotations.ts` (service, event-driven)

**Self-modify.** May simplify `_syncInitialFromYjs` under D-100.

**Observer pattern with origin check** (lines 60-61):
```typescript
this.deepObserver = (events, tr) => {
    if (this.destroyed || tr.origin === "local") return;
    // ...
};
```

**Queuemicrotask dispatch pattern** (lines 214-236):
```typescript
// CodeMirror doesn't allow dispatch() during plugin construction or
// update(). queueMicrotask defers to the next event loop tick.
queueMicrotask(() => {
    if (this.destroyed) return;

    const effects: ReturnType<typeof addAnnotation.of>[] = [];
    scopeAnnotations.forEach((node, yjsKey) => {
        // Skip if already in CM (owner case)
        if (this.idMap.getCmId(yjsKey) !== undefined) return;

        const cmId = this.idMap.getOrCreateCmId(yjsKey);
        const ann = yjsAnnotationToCodeMirror(node, ydoc, scopeYtext, cmId);
        if (ann) effects.push(addAnnotation.of(ann));
    });

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

---

### `src/lib/navigation.ts` (utility, request-response)

**Self-modify.** D-103 restore navigation.

**Navigation pattern** (lines 1-20):
```typescript
import { goto } from "$app/navigation";
import posthog from "$lib/posthog";

export function goToLibrary(): Promise<void> {
    document.documentElement.setAttribute("data-direction", "left");
    posthog.capture("navigated_to_library");
    return goto("/library");
}

export function goToEditor(): Promise<void> {
    document.documentElement.setAttribute("data-direction", "right");
    posthog.capture("navigated_to_editor");
    return goto("/");
}
```

---

### `src/lib/editor/plugins/annotations/NestedEditorController.ts` (controller, event-driven)

**Self-modify.** D-110 lazy version subscription.

**Collab subtree detection pattern** (lines 107-124):
```typescript
// Resolve subtree context if collab is active for this revision.
let collabSubtree:
    | { subtreeYtext: Y.Text; subtreeAnnotations: Y.Map<unknown>; clientId: string }
    | undefined;
const yjsId = getRevisionYjsId(this.revisionId);
if (yjsId) {
    const ctx = getSubtreeContext(yjsId, versionIndex);
    if (ctx) {
        const session = get(collabSession);
        collabSubtree = {
            subtreeYtext: ctx.subtreeYtext,
            subtreeAnnotations: ctx.subtreeAnnotations as Y.Map<unknown>,
            clientId: session?.clientID ?? "",
        };
        this._subtreeUndoManager = ctx.undoManager;
        this._hasCollabSubtree = true;
    }
}
```

**SyncFromParent collab skip pattern** (lines 219-227):
```typescript
syncFromParent(externalDoc: string): void {
    if (!this._editor) return;
    // Collab path: the subtree Y.Text is authoritative and Yjs observers
    // reconcile live. Patching the nested editor from `activeVersion.doc`
    // would dispatch changes through yjsBinding and corrupt the current
    // version's subtree Y.Text when the parent's `activeVersion` pointer
    // moves (e.g., on version switch) before the controller is rebuilt.
    if (this._hasCollabSubtree) return;
    // ...
}
```

**Bundled parent dispatch pattern** (lines 344-388):
```typescript
// Collab path: bundle the parent doc slice update + versions[i].doc
// update into ONE transaction so no intermediate state is observable.
const newDoc = this._editor.state.doc.toString();
const rev = this.parentView.state.field(annotationField)[this.revisionId];
const isActive = !!rev && rev.activeVersionIndex === this._editorVersionIndex;
const dispatchSpec: Parameters<EditorView["dispatch"]>[0] = {
    effects: [
        _updateRevisionVersionDoc.of({
            annotationId: this.revisionId,
            versionIndex: this._editorVersionIndex,
            doc: newDoc,
        }),
    ],
};
if (isActive && rev) {
    // Translate nested-coord changes to parent-coord changes
    const offset = rev.selection.main.from;
    const parentChanges: { from: number; to: number; insert: string }[] = [];
    update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        parentChanges.push({
            from: offset + fromA,
            to: offset + toA,
            insert: inserted.toString(),
        });
    });
    if (parentChanges.length > 0) {
        dispatchSpec.changes = parentChanges;
        dispatchSpec.effects = [...dispatchSpec.effects, _nestedEditRevision.of(this.revisionId)];
        dispatchSpec.annotations = [
            nestedEditorEdit.of(this.revisionId),
            Transaction.addToHistory.of(true),
        ];
        this._lastDispatchedDoc = newDoc;
    }
}
this.parentView.dispatch(dispatchSpec);
```

---

### `src/lib/editor/listeners.ts` (service, event-driven)

**Self-modify.** Persistence skip for joiners already exists.

**Joiner persistence guard pattern** (lines 222-226):
```typescript
function persistTransaction(update: ViewUpdate): void {
    // Live Room mode: joiners are ephemeral viewers of the owner's document.
    // Skip all local persistence -- the owner's relay is the source of truth.
    if (get(isCollabJoiner)) return;
    // ...
}
```

---

## Shared Patterns

### Origin-Based Loop Prevention
**Source:** `src/lib/collab/yjsAnnotations.ts` line 61
**Apply to:** All Yjs observer callbacks
```typescript
if (this.destroyed || tr.origin === "local") return;
```

### Transaction Annotation for History Bypass
**Source:** `src/lib/collab/index.ts` lines 191-194
**Apply to:** All collab-triggered CM dispatches
```typescript
view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: authoritativeContent },
    annotations: [Transaction.addToHistory.of(false)],
});
```

### Yjs UndoManager Highest Precedence Keymap
**Source:** `src/lib/collab/yjsUndo.ts` lines 49-82
**Apply to:** Collab undo handling
```typescript
// Always claim Mod-z in collab mode, even when the Yjs undo stack is empty
const undoKeymap: KeyBinding[] = [
    {
        key: "Mod-z",
        run: () => {
            if (undoManager.canUndo()) undoManager.undo();
            return true; // Always return true to claim the keystroke
        },
    },
];
// ...
return {
    extension: Prec.highest(keymap.of(undoKeymap)),
    undoManager,
};
```

### QueueMicrotask for Plugin Dispatches
**Source:** `src/lib/collab/yjsAnnotations.ts` lines 182-203
**Apply to:** All dispatches during plugin constructor or update
```typescript
// CodeMirror doesn't allow dispatch() during plugin construction or update().
// queueMicrotask defers to the next event loop tick.
queueMicrotask(() => {
    if (this.destroyed) return;
    // dispatch effects...
});
```

### Two-Peer Test Harness
**Source:** `src/lib/collab/test-helpers/twoPeerHarness.ts`
**Apply to:** All Phase 9 integration tests
```typescript
import { makePeer, connect, teardown, type Peer } from "./test-helpers/twoPeerHarness";
```

---

## No Analog Found

No files in this phase require patterns from outside the existing codebase. All files either:
1. Extend existing test patterns (`twoPeerHarness.ts`, `yjsAnnotations.convergence.test.ts`)
2. Are self-modifications of existing files with established patterns

---

## Metadata

**Analog search scope:** `src/lib/collab/`, `src/lib/editor/`, `src/lib/navigation.ts`
**Files scanned:** 28
**Pattern extraction date:** 2026-04-19
