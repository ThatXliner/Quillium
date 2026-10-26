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
