import { AnnotationIdMap } from "$lib/collab/annotationSchema";
import { collabCompartment, disableCollab } from "$lib/collab/index";
import { isCollabJoiner, joinerPriorView } from "$lib/collab/store";
import {
    type Peer,
    connect,
    flushAll,
    makeJoinerPeer,
    makeOwnerPeer,
    makePeerWithAnnotationSync,
    teardown,
} from "$lib/collab/test-helpers/twoPeerHarness";
import type { YjsAnnotationNode } from "$lib/collab/types";
import { createAnnotationSyncPlugin } from "$lib/collab/yjsAnnotations";
import { createYjsBinding } from "$lib/collab/yjsBinding";
import { createYjsUndoExtension } from "$lib/collab/yjsUndo";
import { historyCompartment } from "$lib/editor/extensions";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import {
    addAnnotation,
    annotationField,
    removeAnnotation,
    setActiveRevisionVersion,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    type GenericAnnotation,
    activeVersionIndex,
    isAnnotationOfType,
    makeVersion,
} from "$lib/editor/plugins/annotations/models";
import { currentDraftId } from "$lib/stores";
// joiner-view.test.ts - End-to-end Phase 02 verification: JOINER-01/-03/-05
// + criteria #6 (own-edits-only undo), #7 (owner history excludes remote text),
// and #8 (selection restored on undo/redo). Uses Phase 1 flushAll primitive
// and Plan 02-01 makeJoinerPeer factory.
import { history, historyField, undo } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { get } from "svelte/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

vi.mock("$app/navigation", () => ({ goto: vi.fn() }));

type JoinerPeer = Peer & { undoManager: Y.UndoManager };

describe("joiner view hardening", () => {
    const peers: Peer[] = [];
    const disconnects: Array<() => void> = [];

    function track<T extends Peer>(peer: T): T {
        peers.push(peer);
        return peer;
    }

    function trackDisconnect(disconnect: () => void): void {
        disconnects.push(disconnect);
    }

    function comment(id: number, from: number, to: number): GenericAnnotation {
        return {
            id,
            _type: "comment",
            selection: EditorSelection.single(from, to),
            thread: [],
        };
    }

    function makeProductionAnnotationPeer(
        clientId: string,
        initialText = "",
        joiner = false,
    ): Peer & { undoManager?: Y.UndoManager } {
        const ydoc = new Y.Doc();
        const ytext = ydoc.getText("document");
        const ymap = ydoc.getMap<YjsAnnotationNode>("annotations");
        const idMap = new AnnotationIdMap();
        if (initialText) {
            ydoc.transact(() => ytext.insert(0, initialText), "init");
        }
        const undo = joiner ? createYjsUndoExtension(ytext, ymap) : undefined;
        const state = EditorState.create({
            doc: initialText,
            extensions: [
                annotationExtensions(),
                createYjsBinding(ytext),
                createAnnotationSyncPlugin(ytext, ymap, clientId, idMap),
                ...(undo ? [undo.extension] : []),
            ],
        });
        const view = new EditorView({ state, parent: document.body });
        return {
            ydoc,
            ytext,
            ymap: ymap as Y.Map<unknown>,
            view,
            clientId,
            idMap,
            ...(undo ? { undoManager: undo.undoManager } : {}),
        };
    }

    afterEach(() => {
        while (disconnects.length > 0) {
            disconnects.pop()?.();
        }
        while (peers.length > 0) {
            const peer = peers.pop();
            if (peer) teardown(peer);
        }
        joinerPriorView.set(null);
        isCollabJoiner.set(false);
        currentDraftId.set(null);
    });

    it("no history field - joiner state.field(historyField, false) is undefined", async () => {
        const owner = track(makePeerWithAnnotationSync("owner", "hello"));
        const joiner = track(makeJoinerPeer("joiner"));
        await Promise.resolve();
        trackDisconnect(connect(owner, joiner));

        await flushAll(owner, joiner);

        expect(joiner.view.state.field(historyField, false)).toBeUndefined();
    });

    it("cmd-z post-connect - undo on freshly-connected joiner is a no-op", async () => {
        const owner = track(makePeerWithAnnotationSync("owner", "shared text"));
        const joiner = track(makeJoinerPeer("joiner"));
        await Promise.resolve();
        trackDisconnect(connect(owner, joiner));
        await flushAll(owner, joiner);

        const docBefore = joiner.view.state.doc.toString();
        const annBefore = JSON.stringify(joiner.view.state.field(annotationField));

        joiner.undoManager.undo();
        await flushAll(owner, joiner);

        expect(joiner.view.state.doc.toString()).toBe(docBefore);
        expect(JSON.stringify(joiner.view.state.field(annotationField))).toBe(annBefore);
    });

    it("no annotation duplication - owner has N annotations, joiner connects, joiner annotation count = N", async () => {
        const owner = track(makePeerWithAnnotationSync("owner", "owner text"));
        owner.view.dispatch({
            effects: [
                addAnnotation.of(comment(0, 0, 1)),
                addAnnotation.of(comment(1, 2, 3)),
                addAnnotation.of(comment(2, 4, 5)),
            ],
        });

        const joiner = track(makeJoinerPeer("joiner"));
        await Promise.resolve();
        trackDisconnect(connect(owner, joiner));
        await flushAll(owner, joiner);

        const joinerCount = Object.keys(joiner.view.state.field(annotationField)).length;
        expect(joinerCount).toBe(3);
        expect(joiner.ymap.size).toBe(3);
    });

    it("undo own edits only - joiner Cmd-z does not affect owner's edits", async () => {
        const owner = track(makePeerWithAnnotationSync("owner", "text"));
        const joiner = track(makeJoinerPeer("joiner"));
        await Promise.resolve();
        trackDisconnect(connect(owner, joiner));
        await flushAll(owner, joiner);

        owner.view.dispatch({ changes: { from: 0, insert: "OWNER " } });
        await flushAll(owner, joiner);
        expect(joiner.view.state.doc.toString().startsWith("OWNER ")).toBe(true);

        joiner.view.dispatch({
            changes: { from: joiner.view.state.doc.length, insert: " JOINER" },
        });
        await flushAll(owner, joiner);
        expect(joiner.view.state.doc.toString().endsWith(" JOINER")).toBe(true);

        joiner.undoManager.undo();
        await flushAll(owner, joiner);

        const doc = joiner.view.state.doc.toString();
        expect(doc.startsWith("OWNER ")).toBe(true);
        expect(doc.endsWith(" JOINER")).toBe(false);
    });

    it("owner history excludes remote text - owner Cmd-z does not undo joiner's incoming text", async () => {
        const owner = track(makeOwnerPeer("owner", "text"));
        const joiner = track(makeJoinerPeer("joiner"));
        await Promise.resolve();
        trackDisconnect(connect(owner, joiner));
        await flushAll(owner, joiner);

        owner.view.dispatch({ changes: { from: 0, insert: "OWNER " } });
        joiner.view.dispatch({
            changes: { from: joiner.view.state.doc.length, insert: " JOINER" },
        });
        await flushAll(owner, joiner);

        expect(undo(owner.view)).toBe(true);
        await flushAll(owner, joiner);

        const doc = owner.view.state.doc.toString();
        expect(doc.includes("OWNER ")).toBe(false);
        expect(doc.endsWith(" JOINER")).toBe(true);
    });

    it("selection restored - undo restores caret to where it was at edit time", async () => {
        const joiner: JoinerPeer = track(makeJoinerPeer("joiner", "hello world"));

        joiner.view.dispatch({ selection: EditorSelection.cursor(5) });
        joiner.view.dispatch({
            changes: { from: 5, insert: "X" },
            selection: EditorSelection.cursor(6),
        });
        await Promise.resolve();
        const after = joiner.view.state.selection.main.head;

        joiner.undoManager.undo();
        await Promise.resolve();
        const undone = joiner.view.state.selection.main.head;

        expect(undone).toBe(after);
    });

    it("yjs undo extension wired - joiner has Y.UndoManager and no historyField", () => {
        const joiner = track(makeJoinerPeer("joiner"));

        expect(joiner.undoManager).toBeInstanceOf(Y.UndoManager);
        expect(joiner.view.state.field(historyField, false)).toBeUndefined();
    });

    it("joiner version switch preserves revision annotation", async () => {
        const owner = track(makeProductionAnnotationPeer("owner", "hello world"));
        const ownerVersions = [makeVersion({ doc: "world" }), makeVersion({ doc: "" })];
        owner.view.dispatch({
            effects: addAnnotation.of({
                id: 0,
                _type: "revision",
                selection: EditorSelection.single(6, 11),
                thread: [],
                versions: ownerVersions,
                activeVersionId: ownerVersions[0].id,
            }),
        });
        await Promise.resolve();

        const joinerYdoc = new Y.Doc();
        Y.applyUpdate(joinerYdoc, Y.encodeStateAsUpdate(owner.ydoc), "remote");
        const joinerYtext = joinerYdoc.getText("document");
        const joinerYmap = joinerYdoc.getMap<YjsAnnotationNode>("annotations");
        const idMap = new AnnotationIdMap();
        const undo = createYjsUndoExtension(joinerYtext, joinerYmap);
        const joinerState = EditorState.create({
            doc: joinerYtext.toString(),
            extensions: [
                annotationExtensions(),
                createYjsBinding(joinerYtext),
                createAnnotationSyncPlugin(joinerYtext, joinerYmap, "joiner", idMap),
                undo.extension,
            ],
        });
        const joiner = track({
            ydoc: joinerYdoc,
            ytext: joinerYtext,
            ymap: joinerYmap as Y.Map<unknown>,
            view: new EditorView({ state: joinerState, parent: document.body }),
            clientId: "joiner",
            idMap,
            undoManager: undo.undoManager,
        });
        const ownerToJoiner = (update: Uint8Array, origin: unknown) => {
            if (origin !== "remote") Y.applyUpdate(joiner.ydoc, update, "remote");
        };
        const joinerToOwner = (update: Uint8Array, origin: unknown) => {
            if (origin !== "remote") Y.applyUpdate(owner.ydoc, update, "remote");
        };
        owner.ydoc.on("update", ownerToJoiner);
        joiner.ydoc.on("update", joinerToOwner);
        trackDisconnect(() => {
            owner.ydoc.off("update", ownerToJoiner);
            joiner.ydoc.off("update", joinerToOwner);
        });
        await flushAll(owner, joiner);

        const annId = Number(Object.keys(joiner.view.state.field(annotationField))[0]);
        const joinerRev = joiner.view.state.field(annotationField)[annId];
        if (!isAnnotationOfType(joinerRev, "revision")) {
            expect.fail("Expected revision annotation");
            return;
        }
        joiner.view.dispatch(
            setActiveRevisionVersion(joiner.view.state, annId, joinerRev.versions[1].id),
        );
        await flushAll(owner, joiner);
        await Promise.resolve();

        const ownerAnnotations = Object.values(owner.view.state.field(annotationField));
        const joinerAnnotations = Object.values(joiner.view.state.field(annotationField));
        expect(ownerAnnotations).toHaveLength(1);
        expect(joinerAnnotations).toHaveLength(1);

        const ownerRevision = ownerAnnotations[0];
        const joinerRevision = joinerAnnotations[0];
        if (
            !isAnnotationOfType(ownerRevision, "revision") ||
            !isAnnotationOfType(joinerRevision, "revision")
        ) {
            expect.fail("Expected revision annotations");
            return;
        }
        expect(activeVersionIndex(ownerRevision)).toBe(1);
        expect(activeVersionIndex(joinerRevision)).toBe(1);
        expect(owner.view.state.doc.toString()).toBe("hello ");
        expect(joiner.view.state.doc.toString()).toBe("hello ");
    });

    it("leaving a joined session restores the pre-session editor snapshot", () => {
        const state = EditorState.create({
            doc: "local draft",
            extensions: [
                annotationField,
                historyCompartment.of(history({ newGroupDelay: 250 })),
                collabCompartment.of([]),
            ],
        });
        const view = new EditorView({ state, parent: document.body });

        try {
            view.dispatch({
                effects: addAnnotation.of(comment(0, 0, 5)),
            });
            const snapshot = view.state.toJSON({ annotationField });
            const localAnnotation = view.state.field(annotationField)[0];
            view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: "remote live" },
                effects: removeAnnotation.of(localAnnotation),
            });

            currentDraftId.set(null);
            joinerPriorView.set({
                draftId: "draft-local",
                viewType: "editor",
                editorStateJson: snapshot,
            });
            isCollabJoiner.set(true);

            disableCollab(view);

            expect(view.state.doc.toString()).toBe("local draft");
            expect(Object.values(view.state.field(annotationField))).toHaveLength(1);
            expect(Object.values(view.state.field(annotationField))[0].selection.main.from).toBe(0);
            expect(Object.values(view.state.field(annotationField))[0].selection.main.to).toBe(5);
            expect(get(currentDraftId)).toBe("draft-local");
            expect(get(isCollabJoiner)).toBe(false);
            expect(get(joinerPriorView)).toBeNull();
        } finally {
            view.destroy();
        }
    });
});
