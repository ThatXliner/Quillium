import { collabCompartment, disableCollab, enableCollab } from "$lib/collab";
import { codeMirrorToYjsAnnotation } from "$lib/collab/annotationSchema";
import { collabSession, collabState } from "$lib/collab/store";
import type { YjsAnnotationNode, YjsVersionGroup } from "$lib/collab/types";
import { historyCompartment } from "$lib/editor/extensions";
import { addAnnotation, annotationField } from "$lib/editor/plugins/annotations/annotationField";
import { type GenericAnnotation, makeVersion } from "$lib/editor/plugins/annotations/models";
import {
    createVersionGroup,
    versionGroupField,
} from "$lib/editor/plugins/annotations/versionGroupField";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { get } from "svelte/store";
import { expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

const fixture = vi.hoisted(() => ({ result: undefined as unknown }));
vi.mock("$lib/collab/yjsProvider", () => ({
    createYjsProvider: async () => {
        collabState.set("connected");
        return fixture.result;
    },
    disconnectYjsProvider: vi.fn(),
    getCurrentDocId: () => "same-document",
    getYjsProvider: () => (fixture.result as { provider: unknown } | undefined)?.provider,
    prepareCommentOperation: vi.fn(),
    relayConfigured: true,
}));
vi.mock("$lib/auth/auth.svelte", () => ({
    getUser: () => ({ id: "owner" }),
    getCurrentUserName: () => "Owner",
}));
vi.mock("$app/navigation", () => ({ goto: vi.fn() }));

it.each(["Draft B prose", "", "with revisions"])(
    "replaces recovered draft state with the active draft %j",
    async (text) => {
        const ydoc = new Y.Doc();
        const ytext = ydoc.getText("document");
        const ymap = ydoc.getMap<YjsAnnotationNode>("annotations");
        const yVersionGroups = ydoc.getMap<YjsVersionGroup>("versionGroups");
        const awareness = new Awareness(ydoc);
        const peer = new Y.Doc();
        const forward = (update: Uint8Array) => Y.applyUpdate(peer, update);
        ydoc.on("update", forward);
        ytext.insert(0, "Draft A prose");
        const oldComment = {
            id: 0,
            _type: "comment" as const,
            status: "active" as const,
            selection: EditorSelection.single(0, 5),
            thread: [{ message: "PRIVATE DRAFT A NOTE", author: "Owner", time: 1 }],
        };
        const node = codeMirrorToYjsAnnotation(oldComment, ytext, "owner", ydoc);
        node.set("id", "owner-init-0");
        ymap.set("owner-init-0", node);
        yVersionGroups.set("old-group", { id: "old-group", label: "Old draft group", members: [] });
        fixture.result = {
            ydoc,
            ytext,
            ymap,
            yVersionGroups,
            awareness,
            provider: { synced: true, on: vi.fn(), off: vi.fn() },
        };
        const view = new EditorView({
            state: EditorState.create({
                doc: text,
                extensions: [
                    annotationField,
                    versionGroupField,
                    historyCompartment.of([]),
                    collabCompartment.of([]),
                ],
            }),
            parent: document.body,
        });
        const revisions: GenericAnnotation[] = [0, 1].map((id) => {
            const version = makeVersion({ id: `version-${id}`, doc: text.slice(id, id + 1) });
            return {
                id,
                _type: "revision",
                status: "active",
                thread: [],
                selection: EditorSelection.single(id, id + 1),
                versions: [version],
                activeVersionId: version.id,
            };
        });
        let groupId = "";
        if (text === "with revisions") {
            const group = createVersionGroup("Current draft group", [
                { revisionId: 0, versionId: "version-0" },
                { revisionId: 1, versionId: "version-1" },
            ]);
            groupId = group.groupId;
            view.dispatch({ effects: revisions.map((revision) => addAnnotation.of(revision)) });
            view.dispatch(group.spec);
        }
        try {
            await enableCollab(view, "same-document", "owner", true);
            for (let i = 0; i < 8; i++) await Promise.resolve();
            expect(view.state.doc.toString()).toBe(text);
            const count = text === "with revisions" ? 2 : 0;
            expect(ymap.size).toBe(count);
            expect(Object.values(view.state.field(annotationField))).toHaveLength(count);
            expect(yVersionGroups.has("old-group")).toBe(false);
            expect(peer.getMap("annotations").size).toBe(count);
            expect(get(collabSession)?.undoManager.undoStack).toHaveLength(0);
            if (count) {
                expect(Object.values(view.state.field(annotationField))).toMatchObject(revisions);
                expect(yVersionGroups.get(groupId)?.members).toEqual([
                    { revisionId: "owner-init-0", versionId: "version-0" },
                    { revisionId: "owner-init-1", versionId: "version-1" },
                ]);
                expect(peer.getMap("versionGroups").toJSON()).toEqual(yVersionGroups.toJSON());
            } else expect(yVersionGroups.size).toBe(0);
        } finally {
            disableCollab(view);
            view.destroy();
            awareness.destroy();
            ydoc.destroy();
            peer.destroy();
        }
    },
);
