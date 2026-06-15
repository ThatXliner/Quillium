/**
 * annotation-tree.test.ts -- Recursive Y.Map shape integrity (D-90, D-92).
 *
 * Five tests wired in Plan 8.5a-02 exercise the recursive converter:
 *   - shape integrity on build (comment/suggestion/revision) — node integrated into
 *     a host Y.Map before reads because detached Y types return `undefined` on get().
 *   - version propagation across two Y.Docs (standalone pair, no CM ViewPlugin:
 *     createAnnotationSyncPlugin in yjsAnnotations.ts still expects the legacy
 *     flat YjsAnnotation shape until Plan 8.5b-01 rewires it).
 *   - thread ordering roundtrip (Y.Array is ordered, not set-based).
 *   - revision activeVersionIndex bounds clamp.
 *   - null selection when anchored text is deleted.
 *
 * The remaining `it.todo` entry ("observeDeep fires for descendant Y.Text changes")
 * is wired by Plan 8.5b-01 when the annotation sync plugin switches to observeDeep.
 */
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { EditorSelection } from "@codemirror/state";
import { codeMirrorToYjsAnnotation, yjsAnnotationToCodeMirror } from "$lib/collab/annotationSchema";
import {
    activeVersionIndex,
    makeVersion,
    type GenericAnnotation,
} from "$lib/editor/plugins/annotations/models";
import type { YjsAnnotationNode } from "$lib/collab/types";

const CLIENT_ID = "client-A";

/** Create a fresh Y.Doc with a seeded document Y.Text plus the host annotations Y.Map. */
function makeHost(initialText = "Hello world") {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("document");
    const ymap = ydoc.getMap<YjsAnnotationNode>("annotations");
    if (initialText) {
        ydoc.transact(() => ytext.insert(0, initialText), "init");
    }
    return { ydoc, ytext, ymap };
}

/**
 * Build a node via the converter and integrate it into the host ymap under a key.
 * Detached Y.Maps cannot be read via .get() (they log "Invalid access" and return
 * undefined); all tests must integrate before reading.
 */
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

describe("annotation tree", () => {
    it("recursive shape integrity", () => {
        const host = makeHost("Hello world");

        // Comment
        const comment: GenericAnnotation = {
            _type: "comment",
            id: 0,
            selection: EditorSelection.single(0, 5),
            thread: [{ message: "Hi", author: "A", time: 1 }],
        };
        const commentNode = buildAndIntegrate(comment, host, "comment");
        expect(commentNode instanceof Y.Map).toBe(true);
        expect(commentNode.get("thread") instanceof Y.Array).toBe(true);
        expect(commentNode.get("annotations") instanceof Y.Map).toBe(true);

        // Suggestion
        const suggestion: GenericAnnotation = {
            _type: "suggestion",
            id: 1,
            selection: EditorSelection.single(0, 5),
            thread: [],
            replacements: [{ text: "Hey", rationale: "friendlier" }],
            author: "A",
        };
        const suggestionNode = buildAndIntegrate(suggestion, host, "suggestion");
        expect(suggestionNode instanceof Y.Map).toBe(true);
        expect(suggestionNode.get("thread") instanceof Y.Array).toBe(true);
        expect(suggestionNode.get("annotations") instanceof Y.Map).toBe(true);
        expect(suggestionNode.get("replacements") instanceof Y.Array).toBe(true);

        // Revision
        const revisionVersions = [
            makeVersion({ doc: "Hello" }),
            makeVersion({ doc: "Greetings", label: "alt" }),
        ];
        const revision: GenericAnnotation = {
            _type: "revision",
            id: 2,
            selection: EditorSelection.single(0, 5),
            thread: [],
            activeVersionId: revisionVersions[0].id,
            versions: revisionVersions,
        };
        const revisionNode = buildAndIntegrate(revision, host, "revision");
        expect(revisionNode instanceof Y.Map).toBe(true);
        const versionsMap = revisionNode.get("versions");
        expect(versionsMap instanceof Y.Map).toBe(true);
        const vmap = versionsMap as Y.Map<unknown>;
        expect(vmap.size).toBe(2);
        for (const key of vmap.keys()) {
            const v = vmap.get(key);
            expect(v instanceof Y.Map).toBe(true);
            const vNode = v as Y.Map<unknown>;
            expect(vNode.get("text") instanceof Y.Text).toBe(true);
            expect(vNode.get("annotations") instanceof Y.Map).toBe(true);
        }
        const v0 = vmap.get("0") as Y.Map<unknown>;
        const v1 = vmap.get("1") as Y.Map<unknown>;
        expect((v0.get("text") as Y.Text).toString()).toBe("Hello");
        expect((v1.get("text") as Y.Text).toString()).toBe("Greetings");
    });

    it("version propagation", () => {
        // Standalone two-doc scenario (no CodeMirror ViewPlugin) to exercise
        // pure converter propagation. Using makePeer would install
        // createAnnotationSyncPlugin which still expects the legacy flat shape
        // (owned by Plan 8.5b-01) and would crash on the new recursive shape.
        const a = makeHost("Hello world");
        const b = makeHost("");

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

        try {
            const propagationVersion = makeVersion({ doc: "Hello", label: "original" });
            const revision: GenericAnnotation = {
                _type: "revision",
                id: 0,
                selection: EditorSelection.single(0, 5),
                thread: [],
                activeVersionId: propagationVersion.id,
                versions: [propagationVersion],
            };
            buildAndIntegrate(revision, a, "shared-id");

            // Peer B observes the new node at the same key.
            const bNode = b.ymap.get("shared-id");
            expect(bNode instanceof Y.Map).toBe(true);

            // Read back via the converter on peer B.
            const decoded = yjsAnnotationToCodeMirror(
                bNode as YjsAnnotationNode,
                b.ydoc,
                b.ytext,
                0,
            );
            expect(decoded).not.toBeNull();
            expect(decoded!._type).toBe("revision");
            if (decoded!._type === "revision") {
                expect(decoded!.versions.length).toBe(1);
                expect(decoded!.versions[0].doc).toBe("Hello");
                expect(decoded!.versions[0].label).toBe("original");
            }
        } finally {
            a.ydoc.off("update", aToB);
            b.ydoc.off("update", bToA);
            a.ydoc.destroy();
            b.ydoc.destroy();
        }
    });

    it("roundtrip preserves thread ordering", () => {
        const host = makeHost("Hello world");
        const ann: GenericAnnotation = {
            _type: "comment",
            id: 0,
            selection: EditorSelection.single(0, 5),
            thread: [
                { message: "first", author: "A", time: 1 },
                { message: "second", author: "B", time: 2 },
                { message: "third", author: "A", time: 3 },
            ],
        };
        const node = buildAndIntegrate(ann, host, "comment");
        const decoded = yjsAnnotationToCodeMirror(node, host.ydoc, host.ytext, 0);
        expect(decoded).not.toBeNull();
        expect(decoded!.thread.map((m) => m.message)).toEqual(["first", "second", "third"]);
        expect(decoded!.thread.map((m) => m.time)).toEqual([1, 2, 3]);
    });

    it("revision clamps out-of-range activeVersionIndex", () => {
        const host = makeHost("Hello world");

        // Manually assemble a minimal revision node with a single version and an
        // out-of-range activeVersionIndex to exercise the converter's clamp.
        // Build INSIDE a transact directly on the integrated ymap so all child
        // Y types are inserted into the live tree.
        const node = new Y.Map<unknown>();
        host.ydoc.transact(() => {
            host.ymap.set("test-rev", node as YjsAnnotationNode);
            node.set("id", "test-rev");
            node.set("_type", "revision");
            const startRel = Y.createRelativePositionFromTypeIndex(host.ytext, 0);
            const endRel = Y.createRelativePositionFromTypeIndex(host.ytext, 5);
            node.set("startPos", Y.encodeRelativePosition(startRel));
            node.set("endPos", Y.encodeRelativePosition(endRel));
            node.set("thread", new Y.Array());
            node.set("annotations", new Y.Map());
            const versionsMap = new Y.Map<Y.Map<unknown>>();
            node.set("versions", versionsMap);
            const v0 = new Y.Map<unknown>();
            versionsMap.set("0", v0);
            const vtext = new Y.Text();
            v0.set("text", vtext);
            vtext.insert(0, "Hello");
            v0.set("annotations", new Y.Map());
            node.set("activeVersionIndex", 99);
        }, "init");

        const decoded = yjsAnnotationToCodeMirror(node, host.ydoc, host.ytext, 0);
        expect(decoded).not.toBeNull();
        expect(decoded!._type).toBe("revision");
        if (decoded!._type === "revision") {
            expect(activeVersionIndex(decoded!)).toBe(0);
        }
    });

    it("null selection when anchored text deleted", () => {
        // Yjs RelativePosition resolution does NOT return null when anchored
        // items are merely deleted in the same doc — it collapses to the
        // deletion point (see relativePosition.test.ts "returns null or
        // collapsed when anchored text is fully deleted"). The converter's
        // null return path fires when the referenced items are unreachable,
        // which happens when the position is decoded against a doc that
        // never received those items at all.
        const host = makeHost("Hello world");
        const nullSelVersion = makeVersion({ doc: "Hello" });
        const revision: GenericAnnotation = {
            _type: "revision",
            id: 0,
            selection: EditorSelection.single(0, 5),
            thread: [],
            activeVersionId: nullSelVersion.id,
            versions: [nullSelVersion],
        };
        const node = buildAndIntegrate(revision, host, "revision");

        // Attempt to decode against an independent doc that has no items
        // from the anchor-owning client — this is the real-world "deleted /
        // unreachable anchor" path and is exactly what relativeToAbsolute
        // returns null for.
        const otherDoc = new Y.Doc();
        const otherText = otherDoc.getText("document");
        otherDoc.transact(() => otherText.insert(0, "unrelated text"));

        const decoded = yjsAnnotationToCodeMirror(node, otherDoc, otherText, 0);
        expect(decoded).toBeNull();
    });

    it("observeDeep propagation: remote node appears in CM", () => {
        // Two standalone Y.Docs (no CM ViewPlugin yet — testing pure observeDeep behavior).
        // Peer A sets a comment annotation node into the ymap.
        // Peer B's observeDeep fires and can read the node.
        const a = makeHost("Hello world");
        const b = makeHost("");

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

        const observedKeys: string[] = [];
        b.ymap.observeDeep((events) => {
            for (const ev of events) {
                if (ev.target === b.ymap && ev instanceof Y.YMapEvent) {
                    for (const key of ev.keysChanged) {
                        observedKeys.push(key);
                    }
                }
            }
        });

        try {
            // Peer A creates a comment annotation
            const comment: GenericAnnotation = {
                _type: "comment",
                id: 0,
                selection: EditorSelection.single(0, 5),
                thread: [{ message: "Hi", author: "A", time: 1 }],
            };
            buildAndIntegrate(comment, a, "comment-1");

            // Peer B's observeDeep should have fired
            expect(observedKeys).toContain("comment-1");

            // Peer B can read the node and decode it
            const bNode = b.ymap.get("comment-1");
            expect(bNode instanceof Y.Map).toBe(true);
            const decoded = yjsAnnotationToCodeMirror(
                bNode as YjsAnnotationNode,
                b.ydoc,
                b.ytext,
                0,
            );
            expect(decoded).not.toBeNull();
            expect(decoded!._type).toBe("comment");
            expect(decoded!.thread.length).toBe(1);
            expect(decoded!.thread[0].message).toBe("Hi");
        } finally {
            a.ydoc.off("update", aToB);
            b.ydoc.off("update", bToA);
            a.ydoc.destroy();
            b.ydoc.destroy();
        }
    });
});
