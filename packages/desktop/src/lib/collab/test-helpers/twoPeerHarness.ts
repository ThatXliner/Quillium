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
import { history } from "@codemirror/commands";
import * as Y from "yjs";
import { createYjsBinding } from "../yjsBinding";
import { createAnnotationSyncPlugin } from "../yjsAnnotations";
import { createVersionGroupSyncPlugin } from "../yjsVersionGroups";
import { createYjsUndoExtension } from "../yjsUndo";
import { AnnotationIdMap } from "../annotationSchema";
import { annotationField } from "$lib/editor/plugins/annotations/annotationField";
import type { VersionGroup } from "$lib/editor/plugins/annotations/models";
import { versionGroupField } from "$lib/editor/plugins/annotations/versionGroupField";
import type { YjsAnnotationNode } from "../types";

export interface Peer {
    ydoc: Y.Doc;
    ytext: Y.Text;
    // NOTE: ymap value type intentionally `unknown` — Plan 8.5a-02 rewrites the
    // annotation shape from YjsAnnotation (flat) to Y.Map (recursive).
    // Using `unknown` here keeps this harness compatible across both.
    ymap: Y.Map<unknown>;
    yVersionGroups: Y.Map<VersionGroup>;
    view: EditorView;
    clientId: string;
    idMap?: AnnotationIdMap; // Present when annotation sync is enabled
}

export function makePeer(clientId: string, initialText = ""): Peer {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("document");
    const ymap = ydoc.getMap<unknown>("annotations");
    const yVersionGroups = ydoc.getMap<VersionGroup>("versionGroups");
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
    return { ydoc, ytext, ymap, yVersionGroups, view, clientId };
}

/**
 * Create a peer with both text sync AND annotation sync enabled.
 * Use for Phase 11+ tests that exercise annotation synchronization.
 */
export function makePeerWithAnnotationSync(clientId: string, initialText = ""): Peer {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("document");
    const ymap = ydoc.getMap<YjsAnnotationNode>("annotations");
    const yVersionGroups = ydoc.getMap<VersionGroup>("versionGroups");
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
    return { ydoc, ytext, ymap: ymap as Y.Map<unknown>, yVersionGroups, view, clientId, idMap };
}

/**
 * Create a peer with text, annotation, and version-group sync enabled.
 * Use for #273 tests that exercise document-level group metadata.
 */
export function makePeerWithVersionGroupSync(clientId: string, initialText = ""): Peer {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("document");
    const ymap = ydoc.getMap<YjsAnnotationNode>("annotations");
    const yVersionGroups = ydoc.getMap<VersionGroup>("versionGroups");
    const idMap = new AnnotationIdMap();

    if (initialText) {
        ydoc.transact(() => ytext.insert(0, initialText), "init");
    }

    const state = EditorState.create({
        doc: initialText,
        extensions: [
            annotationField,
            versionGroupField,
            createYjsBinding(ytext),
            createAnnotationSyncPlugin(ytext, ymap, clientId, idMap),
            createVersionGroupSyncPlugin(yVersionGroups),
        ],
    });
    const view = new EditorView({ state, parent: document.body });
    return { ydoc, ytext, ymap: ymap as Y.Map<unknown>, yVersionGroups, view, clientId, idMap };
}

export function makeJoinerPeer(
    clientId: string,
    initialText = "",
): Peer & { undoManager: Y.UndoManager } {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("document");
    const ymap = ydoc.getMap<YjsAnnotationNode>("annotations");
    const yVersionGroups = ydoc.getMap<VersionGroup>("versionGroups");
    const idMap = new AnnotationIdMap();

    if (initialText) {
        ydoc.transact(() => ytext.insert(0, initialText), "init");
    }

    const { extension: undoExt, undoManager } = createYjsUndoExtension(ytext, ymap);
    const state = EditorState.create({
        doc: initialText,
        extensions: [
            annotationField,
            createYjsBinding(ytext),
            createAnnotationSyncPlugin(ytext, ymap, clientId, idMap),
            // joiner-shape: history intentionally omitted; undo via Y.UndoManager.
            undoExt,
        ],
    });
    const view = new EditorView({ state, parent: document.body });
    return {
        ydoc,
        ytext,
        ymap: ymap as Y.Map<unknown>,
        yVersionGroups,
        view,
        clientId,
        idMap,
        undoManager,
    };
}

export function makeOwnerPeer(clientId: string, initialText = ""): Peer {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("document");
    const ymap = ydoc.getMap<YjsAnnotationNode>("annotations");
    const yVersionGroups = ydoc.getMap<VersionGroup>("versionGroups");
    const idMap = new AnnotationIdMap();

    if (initialText) {
        ydoc.transact(() => ytext.insert(0, initialText), "init");
    }

    const state = EditorState.create({
        doc: initialText,
        extensions: [
            annotationField,
            history({ newGroupDelay: 250 }),
            createYjsBinding(ytext),
            createAnnotationSyncPlugin(ytext, ymap, clientId, idMap),
        ],
    });
    const view = new EditorView({ state, parent: document.body });
    return { ydoc, ytext, ymap: ymap as Y.Map<unknown>, yVersionGroups, view, clientId, idMap };
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

/**
 * flushAll -- Variadic state-vector-equality flush primitive for N-peer convergence tests.
 *
 * Drains queued microtasks, then checks pairwise Y.encodeStateVector equality
 * across every peer. Repeats until stable or until MAX_ITERATIONS is exceeded
 * (in which case it throws a loud error -- this signals real amplification or
 * a feedback loop, not a transient miss).
 *
 * This is the ONLY flush primitive used by two-peer convergence tests in Phases
 * 1-9. Do not introduce alternative flush helpers (fixed-N microtask ticks,
 * explicit update-queue drains, single awaits) -- they hide amplification bugs
 * behind their own counters or tick budgets.
 *
 * Decisions: D-01 (variadic), D-02 (state-vector loop with cap), D-03 (rejected alts).
 */
export const FLUSH_ALL_MAX_ITERATIONS = 20;

export async function flushAll(...peers: Peer[]): Promise<void> {
    if (peers.length < 2) {
        throw new Error("flushAll: requires at least 2 peers");
    }
    for (let iter = 0; iter < FLUSH_ALL_MAX_ITERATIONS; iter++) {
        await Promise.resolve();
        await Promise.resolve();
        const sv0 = Y.encodeStateVector(peers[0].ydoc);
        let converged = true;
        for (let i = 1; i < peers.length; i++) {
            const svi = Y.encodeStateVector(peers[i].ydoc);
            if (!equalUint8(sv0, svi)) {
                converged = false;
                break;
            }
        }
        if (converged) return;
    }
    throw new Error(
        `flushAll: peers did not converge after ${FLUSH_ALL_MAX_ITERATIONS} iterations -- likely amplification or feedback loop (one local op produced an unbounded chain of remote updates)`,
    );
}

function equalUint8(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}
