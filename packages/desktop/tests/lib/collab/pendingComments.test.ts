import { AnnotationIdMap } from "$lib/collab/annotationSchema";
import { getCommentSubmission } from "$lib/collab/commentSubmission.svelte";
import type { RoleContext } from "$lib/collab/roleContext";
import { createRolePermissions } from "$lib/collab/rolePermissions";
import {
    addAnnotation,
    annotationField,
    removeAnnotation,
} from "$lib/editor/plugins/annotations/annotationField";
import type { GenericAnnotation } from "$lib/editor/plugins/annotations/models";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, expect, it } from "vitest";
import * as Y from "yjs";

const views = new Set<EditorView>();
const docs: Y.Doc[] = [];
afterEach(() => {
    for (const view of views) view.destroy();
    views.clear();
    for (const doc of docs.splice(0)) doc.destroy();
});
function pending(id = 0): GenericAnnotation {
    return {
        id,
        _type: "comment",
        status: "pending",
        thread: [],
        selection: EditorSelection.single(0, 5),
    };
}
function fixture() {
    const doc = new Y.Doc();
    docs.push(doc);
    const text = doc.getText("document");
    text.insert(0, "First and second passage");
    let accept: (() => void) | undefined;
    const context: RoleContext = {
        role: "commenter",
        text,
        annotations: doc.getMap("annotations"),
        ids: new AnnotationIdMap(),
        scope: [],
        prepareComment: () => () =>
            new Promise<void>((resolve) => {
                accept = resolve;
            }),
    };
    function mount(extra: Extension = []): EditorView {
        const view = new EditorView({
            parent: document.body,
            state: EditorState.create({
                doc: text.toString(),
                extensions: [annotationField, createRolePermissions(context), extra],
            }),
        });
        views.add(view);
        return view;
    }
    function close(view: EditorView): void {
        views.delete(view);
        view.destroy();
    }
    return { context, mount, close, accept: () => accept?.() };
}

it("does not restore an accepted pending comment when its originating view closed before ACK", async () => {
    const f = fixture();
    const first = f.mount();
    first.dispatch({ effects: addAnnotation.of(pending()) });
    const submitted = getCommentSubmission(first, 0)!.send("Please clarify");
    f.close(first);
    f.accept();
    expect(await submitted).toBe(true);
    const reopened = f.mount();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(reopened.state.field(annotationField)).toEqual({});
    expect(f.context.ids.getYjsId(0)).toBeUndefined();
});

it("removes a pending comment from a replacement view when its old submission is acknowledged", async () => {
    const f = fixture();
    const first = f.mount();
    first.dispatch({ effects: addAnnotation.of(pending()) });
    const submitted = getCommentSubmission(first, 0)!.send("Please clarify");
    f.close(first);
    const reopened = f.mount();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(reopened.state.field(annotationField)[0]?.status).toBe("pending");
    f.accept();
    expect(await submitted).toBe(true);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(reopened.state.field(annotationField)).toEqual({});
    expect(f.context.annotations.size).toBe(0);
});

it("does not create a pending identity when a later transaction filter rejects the creation", async () => {
    const f = fixture();
    const rejected = f.mount(EditorState.transactionFilter.of(() => []));
    rejected.dispatch({ effects: addAnnotation.of(pending()) });
    expect(rejected.state.field(annotationField)).toEqual({});
    expect(f.context.ids.getYjsId(0)).toBeUndefined();
    f.close(rejected);
    const reopened = f.mount();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(reopened.state.field(annotationField)).toEqual({});
    expect(f.context.annotations.size).toBe(0);
});

it("shares private pending comments across mounted views and cancels them in both", async () => {
    const f = fixture();
    const first = f.mount();
    const second = f.mount();
    first.dispatch({ effects: addAnnotation.of(pending()) });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(second.state.field(annotationField)[0]?.status).toBe("pending");
    second.dispatch({ effects: removeAnnotation.of(second.state.field(annotationField)[0]) });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(first.state.field(annotationField)).toEqual({});
    expect(second.state.field(annotationField)).toEqual({});
    expect(f.context.ids.getYjsId(0)).toBeUndefined();
    expect(f.context.annotations.size).toBe(0);
});

it.each([
    { at: 0, insert: "New ", from: 4, to: 9 },
    { at: 2, insert: "X", from: 0, to: 6 },
    { at: 5, insert: " NEW", from: 0, to: 5 },
])(
    "preserves the selected passage across an owner insertion at $at",
    async ({ at, insert, from, to }) => {
        const f = fixture();
        const first = f.mount();
        first.dispatch({ effects: addAnnotation.of(pending()) });
        f.close(first);
        f.context.text.insert(at, insert);
        const reopened = f.mount();
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        expect(reopened.state.field(annotationField)[0].selection.main.from).toBe(from);
        expect(reopened.state.field(annotationField)[0].selection.main.to).toBe(to);
    },
);

it("keeps a prepared command's end outside text later inserted at that boundary", async () => {
    const f = fixture();
    const prepare = f.context.prepareComment;
    let encodedEnd: number[] | undefined;
    f.context.prepareComment = (command) => {
        if (command.kind === "createComment") encodedEnd = command.end;
        return prepare(command);
    };
    const view = f.mount();
    view.dispatch({ effects: addAnnotation.of(pending()) });
    const submitted = getCommentSubmission(view, 0)!.send("Please clarify");
    f.context.text.insert(5, " NEW");
    if (!encodedEnd || !f.context.text.doc) throw new Error("Missing prepared end anchor");
    const end = Y.createAbsolutePositionFromRelativePosition(
        Y.decodeRelativePosition(Uint8Array.from(encodedEnd)),
        f.context.text.doc,
    );
    expect(end?.index).toBe(5);
    f.accept();
    expect(await submitted).toBe(true);
});
