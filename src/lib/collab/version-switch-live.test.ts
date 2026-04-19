/**
 * version-switch-live.test.ts -- Verify that switching the active version
 * in live-collab mode actually lands the right content in annotationField
 * and in every version's subtree Y.Text.
 *
 * The user-facing bug: after going live with two versions, the owner clicks
 * a different version pill and the inline editor body keeps showing the old
 * version's text. The "(empty)" pill is highlighted but the body renders
 * the other version's content.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import * as Y from "yjs";
import {
    addAnnotation,
    annotationField,
    setActiveRevisionVersion,
} from "$lib/editor/plugins/annotations/annotationField";
import { isAnnotationOfType, versionText } from "$lib/editor/plugins/annotations/models";
import type { GenericAnnotation } from "$lib/editor/plugins/annotations/models";
import { createYjsBinding } from "./yjsBinding";
import { createAnnotationSyncPlugin } from "./yjsAnnotations";
import { AnnotationIdMap } from "./annotationSchema";
import type { YjsAnnotationNode } from "./types";

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
    if (initialText) ydoc.transact(() => ytext.insert(0, initialText), "init");
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
    const aToB = (u: Uint8Array, o: unknown) => {
        if (o === "remote") return;
        Y.applyUpdate(b.ydoc, u, "remote");
    };
    const bToA = (u: Uint8Array, o: unknown) => {
        if (o === "remote") return;
        Y.applyUpdate(a.ydoc, u, "remote");
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

describe("version switch in live collab", () => {
    let owner: Peer;
    let joiner: Peer;
    let disconnect: () => void;

    beforeEach(async () => {
        owner = makePeer("owner", "hello world");
        joiner = makePeer("joiner");
        disconnect = connect(owner, joiner);

        // Create a revision with TWO versions:
        //   v0 = "hello"   (populated)
        //   v1 = ""        (empty)
        // Active = 0.
        const revision: GenericAnnotation = {
            id: 0,
            _type: "revision",
            selection: EditorSelection.single(0, 5),
            thread: [],
            versions: [{ doc: "hello" }, { doc: "" }],
            activeVersionIndex: 0,
        };
        owner.view.dispatch({ effects: [addAnnotation.of(revision)] });

        // Let initial sync drain.
        await new Promise((r) => setTimeout(r, 50));
    });

    afterEach(() => {
        disconnect();
        owner.view.destroy();
        joiner.view.destroy();
        owner.ydoc.destroy();
        joiner.ydoc.destroy();
    });

    it("owner switching to the empty version updates the parent doc range", () => {
        // Sanity: owner starts with revision active-index 0 and parent doc range
        // [0,5] = "hello".
        const before = owner.view.state.field(annotationField)[0];
        if (!isAnnotationOfType(before, "revision")) throw new Error("not revision");
        expect(before.activeVersionIndex).toBe(0);
        const docBefore = owner.view.state.doc.sliceString(
            before.selection.main.from,
            before.selection.main.to,
        );
        expect(docBefore).toBe("hello");

        // Click the v1 pill — equivalent to setActiveRevisionVersion(.., 1).
        owner.view.dispatch(setActiveRevisionVersion(owner.view.state, 0, 1));

        // After the switch, parent doc range should be v1's text ("").
        const after = owner.view.state.field(annotationField)[0];
        if (!isAnnotationOfType(after, "revision")) throw new Error("not revision");
        expect(after.activeVersionIndex).toBe(1);
        const docAfter = owner.view.state.doc.sliceString(
            after.selection.main.from,
            after.selection.main.to,
        );
        expect(docAfter).toBe(""); // empty version active → range is empty
        expect(versionText(after.versions[after.activeVersionIndex])).toBe("");
    });

    it("joiner sees the active version switch (regression: currently broken)", async () => {
        // Owner switches to v1.
        owner.view.dispatch(setActiveRevisionVersion(owner.view.state, 0, 1));
        await new Promise((r) => setTimeout(r, 50));

        // Joiner's parent doc range should now also be empty (owner's doc change
        // propagates through main yjsBinding).
        const joinerRevEntries = Object.values(joiner.view.state.field(annotationField));
        expect(joinerRevEntries.length).toBe(1);
        const joinerRev = joinerRevEntries[0];
        if (!isAnnotationOfType(joinerRev, "revision")) throw new Error("not revision");

        const joinerDocRange = joiner.view.state.doc.sliceString(
            joinerRev.selection.main.from,
            joinerRev.selection.main.to,
        );
        expect(joinerDocRange).toBe("");

        // And the activeVersionIndex must also sync — this is the actual bug.
        expect(joinerRev.activeVersionIndex).toBe(1);
    });

    it("v1's subtree Y.Text on both peers is empty after the switch", async () => {
        owner.view.dispatch(setActiveRevisionVersion(owner.view.state, 0, 1));
        await new Promise((r) => setTimeout(r, 50));

        const ownerYjsId = owner.idMap.getYjsId(0)!;
        const ownerNode = owner.ymap.get(ownerYjsId) as Y.Map<unknown>;
        const ownerVersions = ownerNode.get("versions") as Y.Map<unknown>;
        const ownerV1 = ownerVersions.get("1") as Y.Map<unknown>;
        const ownerV1Text = ownerV1.get("text") as Y.Text;
        expect(ownerV1Text.toString()).toBe("");

        // Joiner's side.
        const joinerAnnMapKeys = Array.from(joiner.ymap.keys());
        expect(joinerAnnMapKeys.length).toBe(1);
        const joinerNode = joiner.ymap.get(joinerAnnMapKeys[0]) as Y.Map<unknown>;
        const joinerVersions = joinerNode.get("versions") as Y.Map<unknown>;
        const joinerV1 = joinerVersions.get("1") as Y.Map<unknown>;
        const joinerV1Text = joinerV1.get("text") as Y.Text;
        expect(joinerV1Text.toString()).toBe("");
    });

    it("versions[i].doc stays accurate after switch (no stale v0 content in v1)", () => {
        // Precondition: versions[0].doc is "hello", versions[1].doc is "".
        const before = owner.view.state.field(annotationField)[0];
        if (!isAnnotationOfType(before, "revision")) throw new Error("not revision");
        expect(before.versions[0].doc).toBe("hello");
        expect(before.versions[1].doc).toBe("");

        // Switch to v1.
        owner.view.dispatch(setActiveRevisionVersion(owner.view.state, 0, 1));

        const after = owner.view.state.field(annotationField)[0];
        if (!isAnnotationOfType(after, "revision")) throw new Error("not revision");

        // v0 keeps its content; v1 stays empty. Neither should show the other's text.
        expect(after.versions[0].doc).toBe("hello");
        expect(after.versions[1].doc).toBe("");
    });
});
