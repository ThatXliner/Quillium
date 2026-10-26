import { AnnotationIdMap, codeMirrorToYjsAnnotation } from "$lib/collab/annotationSchema";
import { createRolePermissions } from "$lib/collab/rolePermissions";
import { createAnnotationSyncPlugin } from "$lib/collab/yjsAnnotations";
import { createYjsBinding } from "$lib/collab/yjsBinding";
import { parentSyncEdit } from "$lib/editor/plugins/annotations/NestedEditorController";
import {
    addAnnotation,
    annotationField,
    updateThread,
} from "$lib/editor/plugins/annotations/annotationField";
import type { GenericAnnotation } from "$lib/editor/plugins/annotations/models";
import { createNestedEditorState } from "$lib/editor/plugins/annotations/nestedEditor";
import { versionGroupField } from "$lib/editor/plugins/annotations/versionGroupField";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { LiveRole } from "@quillium/share/collab-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

const views: EditorView[] = [];
const docs: Y.Doc[] = [];
afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
    for (const doc of docs.splice(0)) doc.destroy();
});

function fixture(role: LiveRole) {
    const doc = new Y.Doc();
    docs.push(doc);
    const text = doc.getText("document");
    text.insert(0, "Protected text");
    const annotations = doc.getMap<Y.Map<unknown>>("annotations");
    const ids = new AnnotationIdMap();
    const send = vi.fn().mockResolvedValue(undefined);
    const view = new EditorView({
        parent: document.body,
        state: EditorState.create({
            doc: text.toString(),
            extensions: [
                annotationField,
                versionGroupField,
                createYjsBinding(text, true),
                createAnnotationSyncPlugin(text, annotations, "guest", ids, true),
                createRolePermissions({ role, text, annotations, ids, scope: [], send }),
            ],
        }),
    });
    views.push(view);
    return { doc, text, annotations, ids, send, view };
}

function comment(id: number): GenericAnnotation {
    return {
        id,
        _type: "comment",
        status: "pending",
        thread: [],
        selection: EditorSelection.single(0, 4),
    };
}

describe("restricted editor user actions", () => {
    it.each(["viewer", "commenter"] as const)(
        "keeps %s typing out of root CM and Yjs while projecting remote text",
        async (role) => {
            const { view, text, annotations } = fixture(role);
            view.dispatch({ changes: { from: 0, insert: "forbidden" } });
            expect(view.state.doc.toString()).toBe("Protected text");
            expect(text.toString()).toBe("Protected text");
            text.insert(0, "Remote ");
            expect(view.state.doc.toString()).toBe("Remote Protected text");
            expect(annotations.size).toBe(0);
        },
    );

    it("blocks viewer annotation creation", () => {
        const { view, annotations, send } = fixture("viewer");
        view.dispatch({ effects: addAnnotation.of(comment(0)) });
        expect(Object.keys(view.state.field(annotationField))).toHaveLength(0);
        expect(annotations.size).toBe(0);
        expect(send).not.toHaveBeenCalled();
    });

    it("keeps the comment composer local and sends its first message without optimistic Yjs mutation", async () => {
        const { view, annotations, send } = fixture("commenter");
        view.dispatch({ effects: addAnnotation.of(comment(0)) });
        expect(view.state.field(annotationField)[0]?.status).toBe("pending");
        expect(annotations.size).toBe(0);
        view.dispatch({
            effects: updateThread.of({
                annotationId: 0,
                newThread: [{ message: "Note", author: "untrusted author", time: 1 }],
            }),
        });
        expect(view.state.field(annotationField)[0]?.thread).toEqual([]);
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        expect(send.mock.calls[0][0]).toEqual(
            expect.objectContaining({ kind: "createComment", scope: [], message: "Note" }),
        );
        expect(send.mock.calls[0][0]).not.toHaveProperty("author");
        expect(annotations.size).toBe(0);
    });

    it("keeps the authoritative comment when its projection arrives before command acknowledgement", async () => {
        const { doc, view, text, annotations, ids, send } = fixture("commenter");
        let confirm: (() => void) | undefined;
        send.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    confirm = resolve;
                }),
        );
        view.dispatch({ effects: addAnnotation.of(comment(0)) });
        view.dispatch({
            effects: updateThread.of({
                annotationId: 0,
                newThread: [{ message: "Note", author: "guest", time: 1 }],
            }),
        });
        view.dispatch({
            effects: updateThread.of({
                annotationId: 0,
                newThread: [{ message: "Note", author: "guest", time: 1 }],
            }),
        });
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        const authoritative: GenericAnnotation = {
            ...comment(8),
            status: "active",
            thread: [{ message: "Note", author: "guest", time: 2 }],
        };
        const node = codeMirrorToYjsAnnotation(authoritative, text, "server", doc);
        node.set("id", "accepted");
        annotations.set("accepted", node);
        const acceptedId = ids.getCmId("accepted");
        expect(acceptedId).not.toBe(0);
        confirm?.();
        await vi.waitFor(() => expect(view.state.field(annotationField)[0]).toBeUndefined());
        if (acceptedId === undefined) throw new Error("Missing accepted comment");
        expect(view.state.field(annotationField)[acceptedId]?.thread[0]?.message).toBe("Note");
        expect(annotations.size).toBe(1);
    });

    it("sends only appended replies and rejects attempts to replace existing messages", async () => {
        const { doc, view, text, annotations, ids, send } = fixture("commenter");
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        const authoritative: GenericAnnotation = {
            ...comment(0),
            status: "active",
            thread: [{ message: "Original", author: "owner", time: 1 }],
        };
        const node = codeMirrorToYjsAnnotation(authoritative, text, "server", doc);
        annotations.set("comment", node);
        const id = ids.getCmId("comment");
        if (id === undefined) throw new Error("Missing comment");
        view.dispatch({
            effects: updateThread.of({
                annotationId: id,
                newThread: [{ message: "Replaced", author: "guest", time: 2 }],
            }),
        });
        expect(send).not.toHaveBeenCalled();
        view.dispatch({
            effects: updateThread.of({
                annotationId: id,
                newThread: [
                    ...authoritative.thread,
                    { message: "Reply", author: "guest", time: 2 },
                ],
            }),
        });
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        expect(send.mock.calls[0][0]).toEqual({
            kind: "replyToComment",
            scope: [],
            annotationId: "comment",
            message: "Reply",
        });
        expect(view.state.field(annotationField)[id]?.thread).toEqual(authoritative.thread);
        expect((node.get("thread") as Y.Array<unknown>).length).toBe(1);
    });

    it("blocks suggestions and revisions for commenters", () => {
        const { view } = fixture("commenter");
        const suggestion: GenericAnnotation = {
            ...comment(0),
            _type: "suggestion",
            replacements: [],
        };
        view.dispatch({ effects: addAnnotation.of(suggestion) });
        expect(Object.keys(view.state.field(annotationField))).toHaveLength(0);
    });

    it("rejects nested typing while accepting parent-authoritative projection", async () => {
        const { doc, view, text, annotations, ids } = fixture("viewer");
        const version = { id: "v1", doc: "Protected text", provenance: "human" as const };
        const revision: GenericAnnotation = {
            id: 1,
            _type: "revision",
            selection: EditorSelection.single(0, text.length),
            status: "active",
            thread: [],
            versions: [version],
            activeVersionId: "v1",
        };
        const node = codeMirrorToYjsAnnotation(revision, text, "owner", doc);
        node.set("id", "revision");
        annotations.set("revision", node);
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        const revisionId = ids.getCmId("revision");
        expect(revisionId).toBeDefined();
        if (revisionId === undefined) throw new Error("Missing revision ID");
        const nested = new EditorView({
            parent: document.body,
            state: createNestedEditorState(version, () => {}, view, revisionId),
        });
        views.push(nested);
        nested.dispatch({ changes: { from: 0, insert: "forbidden" } });
        expect(nested.state.doc.toString()).toBe("Protected text");
        nested.dispatch({
            changes: { from: 0, insert: "Remote " },
            annotations: parentSyncEdit.of(true),
        });
        expect(nested.state.doc.toString()).toBe("Remote Protected text");
    });
});
