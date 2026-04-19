/**
 * nested-editor-sync.test.ts -- End-to-end sync across the two peer +
 * subtree Y.Text + annotationField boundary. This is the harness the prior
 * Phase 9 tests were missing.
 *
 * Why this layer matters: versions[i].doc is maintained by two code paths:
 *   - annotationField Phase 3 (pulls parent doc slice) — SKIPPED in collab
 *     when hasSubtreeForRevision returns true.
 *   - NestedEditorController's collab branch dispatching
 *     _updateRevisionVersionDoc — ONLY fires when the nested editor is
 *     mounted with `_hasCollabSubtree === true`.
 *
 * If neither path is active, the version text silently goes stale. The
 * twoPeerHarness tests never exercised path #2, so they were blind to this.
 *
 * To avoid vitest's CM dual-instance crash when importing the full editor
 * extension stack, we build a minimal nested editor with just the Yjs
 * binding + annotationField and manually call the controller's update
 * logic. The goal is to prove: remote Y.Text edits to a subtree propagate
 * to the local annotationField's versions[i].doc.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import * as Y from "yjs";
import {
    addAnnotation,
    annotationField,
    _updateRevisionVersionDoc,
} from "$lib/editor/plugins/annotations/annotationField";
import type { GenericAnnotation } from "$lib/editor/plugins/annotations/models";
import { createYjsBinding } from "./yjsBinding";
import { createAnnotationSyncPlugin } from "./yjsAnnotations";
import { AnnotationIdMap, codeMirrorToYjsAnnotation } from "./annotationSchema";
import type { YjsAnnotationNode } from "./types";

/**
 * A peer that mirrors the two-peer harness but also tracks an explicit
 * subtree Y.Text handle for a given revision (index 0) so the test can
 * directly simulate typing into the sub-editor via yjsBinding on the
 * subtree.
 */
interface Peer {
    ydoc: Y.Doc;
    ytext: Y.Text;
    ymap: Y.Map<YjsAnnotationNode>;
    view: EditorView;
    clientId: string;
    idMap: AnnotationIdMap;
}

function makePeer(clientId: string, initialText = ""): Peer {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("document");
    const ymap = ydoc.getMap<YjsAnnotationNode>("annotations");
    if (initialText) {
        ydoc.transact(() => ytext.insert(0, initialText), "init");
    }
    const idMap = new AnnotationIdMap();
    const state = EditorState.create({
        doc: initialText,
        extensions: [
            annotationField,
            createYjsBinding(ytext),
            createAnnotationSyncPlugin(ytext, ymap, clientId, idMap),
        ],
    });
    const view = new EditorView({ state, parent: document.body });
    return { ydoc, ytext, ymap, view, clientId, idMap };
}

function connect(a: Peer, b: Peer): () => void {
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
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc), "remote");
    Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc), "remote");
    return () => {
        a.ydoc.off("update", aToB);
        b.ydoc.off("update", bToA);
    };
}

/** Get the version-0 subtree Y.Text for a revision on a given peer. */
function getSubtreeYtext(peer: Peer, revisionCmId: number, versionIndex: number): Y.Text | null {
    const yjsId = peer.idMap.getYjsId(revisionCmId);
    if (!yjsId) return null;
    const node = peer.ymap.get(yjsId);
    if (!(node instanceof Y.Map)) return null;
    const versions = node.get("versions");
    if (!(versions instanceof Y.Map)) return null;
    const v = versions.get(String(versionIndex));
    if (!(v instanceof Y.Map)) return null;
    const vtext = v.get("text");
    return vtext instanceof Y.Text ? vtext : null;
}

/**
 * Simulate the NestedEditorController's collab branch of onNestedUpdate:
 * after subtree Y.Text is edited locally (origin "local"), the controller
 * dispatches _updateRevisionVersionDoc to the parent view. This helper
 * imitates that single behaviour in isolation from CM extension loading.
 */
function simulateNestedEdit(peer: Peer, revisionCmId: number, versionIndex: number, newText: string) {
    const subtree = getSubtreeYtext(peer, revisionCmId, versionIndex);
    if (!subtree) throw new Error("no subtree");
    peer.ydoc.transact(() => {
        subtree.delete(0, subtree.length);
        if (newText.length > 0) subtree.insert(0, newText);
    }, "local");

    // This is the key controller behaviour: after the subtree Y.Text mutation,
    // the nested editor's onNestedUpdate (collab branch) dispatches
    // _updateRevisionVersionDoc to the parent view.
    peer.view.dispatch({
        effects: [
            _updateRevisionVersionDoc.of({
                annotationId: revisionCmId,
                versionIndex,
                doc: newText,
            }),
        ],
        annotations: [Transaction.addToHistory.of(false)],
    });
}

function getAnnotations(peer: Peer) {
    return peer.view.state.field(annotationField);
}

describe("nested-editor sync end-to-end (two peers + subtree Y.Text + annotationField)", () => {
    let owner: Peer;
    let joiner: Peer;
    let disconnect: () => void;

    beforeEach(async () => {
        owner = makePeer("owner", "hello world");
        joiner = makePeer("joiner");
        disconnect = connect(owner, joiner);

        // Owner creates a revision covering "hello".
        const revision: GenericAnnotation = {
            id: 0,
            _type: "revision",
            selection: EditorSelection.single(0, 5),
            thread: [],
            versions: [{ doc: "hello" }],
            activeVersionIndex: 0,
        };
        owner.view.dispatch({ effects: [addAnnotation.of(revision)] });
        // Let owner's _syncInitialToYjs (and joiner's _syncInitialFromYjs) run.
        await new Promise((r) => setTimeout(r, 50));
    });

    afterEach(() => {
        disconnect();
        owner.view.destroy();
        joiner.view.destroy();
        owner.ydoc.destroy();
        joiner.ydoc.destroy();
    });

    it("owner nested edit updates owner versions[0].doc AND propagates to joiner", async () => {
        // Owner types into the inline editor (revision 0, version 0).
        simulateNestedEdit(owner, /* revisionCmId */ 0, /* versionIndex */ 0, "hello!");

        // Give the Y.Text event + observeDeep time to propagate remotely.
        await new Promise((r) => setTimeout(r, 50));

        // Owner's versions[0].doc reflects the edit.
        const ownerRev = getAnnotations(owner)[0] as GenericAnnotation & { versions: { doc: string }[] };
        expect(ownerRev.versions[0].doc).toBe("hello!");

        // Joiner's subtree Y.Text received the update.
        const joinerSubtree = getSubtreeYtext(joiner, /* cmId on joiner */ getFirstCmId(joiner), 0);
        expect(joinerSubtree?.toString()).toBe("hello!");

        // And joiner's versions[0].doc is kept in sync by observeDeep rebuilds.
        const joinerRev = Object.values(getAnnotations(joiner))[0] as GenericAnnotation & {
            versions: { doc: string }[];
        };
        expect(joinerRev.versions[0].doc).toBe("hello!");
    });

    it("joiner nested edit updates joiner versions[0].doc AND propagates to owner", async () => {
        // Joiner types into their nested editor.
        simulateNestedEdit(joiner, /* cmId on joiner */ getFirstCmId(joiner), 0, "HELLO");

        await new Promise((r) => setTimeout(r, 50));

        const joinerRev = Object.values(getAnnotations(joiner))[0] as GenericAnnotation & {
            versions: { doc: string }[];
        };
        expect(joinerRev.versions[0].doc).toBe("HELLO");

        // Owner's subtree Y.Text receives the remote edit.
        const ownerSubtree = getSubtreeYtext(owner, 0, 0);
        expect(ownerSubtree?.toString()).toBe("HELLO");

        // Owner's versions[0].doc reflects the remote edit via observeDeep.
        const ownerRev = getAnnotations(owner)[0] as GenericAnnotation & {
            versions: { doc: string }[];
        };
        expect(ownerRev.versions[0].doc).toBe("HELLO");
    });

    it("owner editing inactive version propagates to joiner's inactive version", async () => {
        // Add version 1 to the revision (owner).
        const current = getAnnotations(owner)[0] as GenericAnnotation & {
            versions: { doc: string }[];
            activeVersionIndex: number;
        };
        const updated: GenericAnnotation = {
            ...current,
            versions: [current.versions[0], { doc: "world" }],
            activeVersionIndex: 0,
        };
        // Replace the annotation — simulate version add. (removeAnnotation +
        // addAnnotation is what _addVersionToRevision effectively does for
        // the Yjs shape via observeDeep rebuild.)
        // For test simplicity, directly manipulate Y.Map:
        const yjsId = owner.idMap.getYjsId(0)!;
        const node = owner.ymap.get(yjsId) as Y.Map<unknown>;
        const versionsMap = node.get("versions") as Y.Map<unknown>;
        const v1 = new Y.Map<unknown>();
        const v1text = new Y.Text();
        v1text.insert(0, "world");
        v1.set("text", v1text);
        owner.ydoc.transact(() => {
            versionsMap.set("1", v1);
        }, "local");
        await new Promise((r) => setTimeout(r, 50));

        // Owner edits version 1 (inactive).
        const v1TextOnOwner = getSubtreeYtext(owner, 0, 1);
        expect(v1TextOnOwner?.toString()).toBe("world");
        owner.ydoc.transact(() => {
            v1TextOnOwner!.insert(v1TextOnOwner!.length, "!");
        }, "local");
        await new Promise((r) => setTimeout(r, 50));

        // Joiner's Y.Text for v1 also updated.
        const joinerCmId = getFirstCmId(joiner);
        const v1TextOnJoiner = getSubtreeYtext(joiner, joinerCmId, 1);
        expect(v1TextOnJoiner?.toString()).toBe("world!");
    });
});

function getFirstCmId(peer: Peer): number {
    const anns = peer.view.state.field(annotationField);
    const keys = Object.keys(anns);
    if (keys.length === 0) throw new Error("no annotations on peer");
    return Number(keys[0]);
}
