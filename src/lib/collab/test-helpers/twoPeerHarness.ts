/**
 * twoPeerHarness.ts -- Shared 2-peer fixture for Yjs convergence tests.
 *
 * Role: Eliminates duplicated makePeer/connect helpers across convergence suites.
 *   - yjsBinding.convergence.test.ts (existing)
 *   - yjsAnnotations.convergence.test.ts (existing)
 *
 * Key dependencies: yjs, @codemirror/state, @codemirror/view.
 *
 * Interactions: Each peer owns a Y.Doc, a "document" Y.Text, an "annotations"
 * Y.Map, and a CodeMirror EditorView with createYjsBinding installed.
 * connect() manually pipes updates between two peers with "remote" origin to
 * prevent feedback loops in the UndoManager.
 *
 * Phase 10: Annotation sync plugin removed. Main text sync only.
 * Phase 11 will rebuild annotation sync with unified diff-and-write.
 */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import * as Y from "yjs";
import { createYjsBinding } from "../yjsBinding";
import { createAnnotationSyncPlugin } from "../yjsAnnotations";
import { AnnotationIdMap } from "../annotationSchema";
import { annotationField } from "$lib/editor/plugins/annotations/annotationField";
import type { YjsAnnotationNode } from "../types";

export interface Peer {
    ydoc: Y.Doc;
    ytext: Y.Text;
    // NOTE: ymap value type intentionally `unknown` — Plan 8.5a-02 rewrites the
    // annotation shape from YjsAnnotation (flat) to Y.Map (recursive).
    // Using `unknown` here keeps this harness compatible across both.
    ymap: Y.Map<unknown>;
    view: EditorView;
    clientId: string;
    idMap?: AnnotationIdMap; // Present when annotation sync is enabled
}

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

/**
 * Create a peer with both text sync AND annotation sync enabled.
 * Use for Phase 11+ tests that exercise annotation synchronization.
 */
export function makePeerWithAnnotationSync(clientId: string, initialText = ""): Peer {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("document");
    const ymap = ydoc.getMap<YjsAnnotationNode>("annotations");
    const idMap = new AnnotationIdMap();

    if (initialText) {
        ydoc.transact(() => ytext.insert(0, initialText), "init");
    }

    const state = EditorState.create({
        doc: initialText,
        extensions: [
            annotationField,
            createYjsBinding(ytext),
            createAnnotationSyncPlugin(ytext, ymap, clientId, idMap),
        ],
    });
    const view = new EditorView({ state, parent: document.body });
    // Cast ymap to Y.Map<unknown> to satisfy Peer interface (ymap is Y.Map<YjsAnnotationNode>)
    return { ydoc, ytext, ymap: ymap as Y.Map<unknown>, view, clientId, idMap };
}

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

export function teardown(peer: Peer): void {
    peer.view.destroy();
    peer.ydoc.destroy();
}
