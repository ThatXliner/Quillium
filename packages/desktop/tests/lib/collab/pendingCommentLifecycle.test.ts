import { AnnotationIdMap, codeMirrorToYjsAnnotation } from "$lib/collab/annotationSchema";
import { getCommentSubmission } from "$lib/collab/commentSubmission.svelte";
import { createRolePermissions } from "$lib/collab/rolePermissions";
import { createAnnotationSyncPlugin } from "$lib/collab/yjsAnnotations";
import { createYjsBinding } from "$lib/collab/yjsBinding";
import { createAnnotation } from "$lib/editor/plugins/annotations";
import { NestedEditorController } from "$lib/editor/plugins/annotations/NestedEditorController";
import { annotationField, removeAnnotation } from "$lib/editor/plugins/annotations/annotationField";
import { getDraft, setDraft } from "$lib/editor/plugins/annotations/drafts.svelte";
import { isAnnotationOfType } from "$lib/editor/plugins/annotations/models";
import { versionGroupField } from "$lib/editor/plugins/annotations/versionGroupField";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { expect, it, vi } from "vitest";
import * as Y from "yjs";

vi.mock("$lib/appLog", () => ({ logAppEvent: vi.fn() }));

async function fixture() {
    const doc = new Y.Doc();
    const text = doc.getText("document");
    text.insert(0, "First and second passage");
    const annotations = doc.getMap<Y.Map<unknown>>("annotations");
    const ids = new AnnotationIdMap();
    const prepared: number[] = [];
    let first = true;
    let sentStart: number | undefined;
    const parent = new EditorView({
        parent: document.body,
        state: EditorState.create({
            doc: text.toString(),
            extensions: [
                annotationField,
                versionGroupField,
                createYjsBinding(text, true),
                createAnnotationSyncPlugin(text, annotations, "guest", ids, true),
                createRolePermissions({
                    role: "commenter",
                    text,
                    annotations,
                    ids,
                    scope: [],
                    prepareComment(command) {
                        if (command.kind !== "createComment") throw new Error("Unexpected reply");
                        const start = Y.createAbsolutePositionFromRelativePosition(
                            Y.decodeRelativePosition(Uint8Array.from(command.start)),
                            doc,
                        )!.index;
                        prepared.push(start);
                        return async () => {
                            if (first) {
                                first = false;
                                throw new Error("Connection unavailable");
                            }
                            sentStart = start;
                        };
                    },
                }),
            ],
        }),
    });
    const revision = codeMirrorToYjsAnnotation(
        {
            id: 0,
            _type: "revision",
            status: "active",
            thread: [],
            selection: EditorSelection.single(0, text.length),
            versions: [{ id: "v1", doc: text.toString(), provenance: "human" }],
            activeVersionId: "v1",
        },
        text,
        "owner",
        doc,
    );
    annotations.set("revision", revision);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const revisionId = ids.getCmId("revision")!;
    const versionNode = (revision.get("versions") as Y.Map<Y.Map<unknown>>).get("v1")!;
    const nestedText = versionNode.get("text") as Y.Text;
    const controller = new NestedEditorController(parent, revisionId, {}, "flush");
    const currentVersion = () => {
        const value = parent.state.field(annotationField)[revisionId];
        if (!isAnnotationOfType(value, "revision")) throw new Error("Missing revision");
        return value.versions[0];
    };
    const host = document.createElement("div");
    document.body.append(host);
    const reopen = () => controller.create(host, currentVersion(), 0);
    reopen();
    const createPending = (from: number, to: number): number => {
        const nested = controller.editor!;
        createAnnotation({
            state: nested.state,
            dispatch: (transaction) => nested.dispatch(transaction),
            selection: EditorSelection.single(from, to),
            creation: { source: "human", type: "comment", nested: true },
        });
        const pending = Object.values(nested.state.field(annotationField)).find(
            (a) => a.status === "pending",
        );
        if (!pending) throw new Error("Missing pending comment");
        return pending.id;
    };
    return {
        parent,
        controller,
        nestedText,
        createPending,
        currentVersion,
        reopen,
        prepared,
        get sentStart() {
            return sentStart;
        },
        cleanup() {
            controller.destroy();
            parent.destroy();
            doc.destroy();
            host.remove();
        },
    };
}

it("keeps an unsent nested comment and its anchor when the revision modal closes and reopens", async () => {
    const f = await fixture();
    try {
        const id = f.createPending(0, 5);
        setDraft(f.controller.editor, id, "Please clarify");
        f.controller.destroy();
        f.reopen();
        expect(getDraft(f.controller.editor, id)).toBe("Please clarify");
        await vi.waitFor(() =>
            expect(f.controller.editor!.state.field(annotationField)[id]?.status).toBe("pending"),
        );
        expect(f.controller.editor!.state.field(annotationField)[id]?.selection.main.from).toBe(0);
    } finally {
        f.cleanup();
    }
});

it("keeps the local pending composer when a remote owner edits the nested version", async () => {
    const f = await fixture();
    try {
        const id = f.createPending(0, 5);
        setDraft(f.controller.editor, id, "Please clarify");
        f.nestedText.insert(f.nestedText.length, "!");
        expect(f.controller.needsAnnotationRebuild(f.currentVersion())).toBe(true);
        f.controller.syncVersionFromParent();
        expect(f.controller.editor!.state.doc.toString()).toBe("First and second passage!");
        expect(f.controller.editor!.state.field(annotationField)[id]?.status).toBe("pending");
    } finally {
        f.cleanup();
    }
});

it("keeps a failed pending operation separate from a new selection after remote edits", async () => {
    const f = await fixture();
    try {
        const id = f.createPending(0, 5);
        expect(await getCommentSubmission(f.controller.editor, id)!.send("Please clarify")).toBe(
            false,
        );
        f.nestedText.insert(f.nestedText.length, "!");
        expect(f.controller.needsAnnotationRebuild(f.currentVersion())).toBe(true);
        f.controller.syncVersionFromParent();
        expect(f.controller.editor!.state.field(annotationField)[id]?.status).toBe("pending");
        f.controller.editor!.dispatch({
            effects: removeAnnotation.of(f.controller.editor!.state.field(annotationField)[id]),
        });
        const nextId = f.createPending(10, 16);
        expect(nextId).toBe(id);
        expect(
            await getCommentSubmission(f.controller.editor, nextId)!.send("Please clarify"),
        ).toBe(true);
        expect(f.sentStart).toBe(10);
        expect(f.prepared).toEqual([0, 10]);
    } finally {
        f.cleanup();
    }
});
