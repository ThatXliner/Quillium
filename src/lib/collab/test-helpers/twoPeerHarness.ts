/**
 * twoPeerHarness.ts -- Shared 2-peer fixture for Yjs convergence tests.
 *
 * Role: Eliminates duplicated makePeer/connect helpers across convergence suites.
 *   - yjsBinding.convergence.test.ts (existing)
 *   - yjsAnnotations.convergence.test.ts (existing)
 *   - subtree-convergence.test.ts (Phase 8.5, new)
 *   - convergence-edgecases.test.ts (Phase 8.5, new)
 *   - recursive-mount.test.ts (Phase 8.5, new)
 *
 * Key dependencies: yjs, @codemirror/state, @codemirror/view.
 *
 * Interactions: Each peer owns a Y.Doc, a "document" Y.Text, an "annotations"
 * Y.Map, and a CodeMirror EditorView with createYjsBinding + createAnnotationSyncPlugin
 * installed. connect() manually pipes updates between two peers with "remote"
 * origin to prevent feedback loops in the UndoManager.
 */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import * as Y from "yjs";
import { createYjsBinding } from "../yjsBinding";
import { createAnnotationSyncPlugin } from "../yjsAnnotations";
import { annotationField } from "$lib/editor/plugins/annotations/annotationField";

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
            // CAST: tests declare ymap as Y.Map<unknown>; after Plan 8.5b-01 the plugin
            // is parameterised on Y.Map<YjsAnnotationNode>, which is itself
            // Y.Map<unknown> at runtime, so this cast narrows the type parameter
            // without changing the runtime shape. Still required because TypeScript
            // generics on Y.Map are invariant (no structural assignability between
            // Y.Map<A> and Y.Map<B> even when A extends B).
            createAnnotationSyncPlugin(ytext, ymap as Y.Map<never>, clientId),
        ],
    });
    const view = new EditorView({ state, parent: document.body });
    return { ydoc, ytext, ymap, view, clientId };
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
