import {
    getCommentSubmission,
    registerCommentSubmissions,
} from "$lib/collab/commentSubmission.svelte";
import CommentModal from "$lib/editor/plugins/annotations/CommentModal.svelte";
import PreComment from "$lib/editor/plugins/annotations/PreComment.svelte";
import Thread from "$lib/editor/plugins/annotations/Thread.svelte";
import {
    addAnnotation,
    annotationField,
    updateThread,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    clearDraft,
    commentDraftScope,
    commentDraftScopeBridge,
    getDraft,
} from "$lib/editor/plugins/annotations/drafts.svelte";
import type { GenericAnnotation } from "$lib/editor/plugins/annotations/models";
import {
    annotations as annotationsStore,
    modalStack,
    editorView as rootEditorView,
} from "$lib/stores";
import { Compartment, EditorSelection, EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const views: EditorView[] = [];
const scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
beforeAll(() =>
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
        configurable: true,
        value: vi.fn(),
    }),
);
afterAll(() => {
    if (scrollToDescriptor)
        Object.defineProperty(HTMLElement.prototype, "scrollTo", scrollToDescriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});
afterEach(() => {
    cleanup();
    for (const view of views.splice(0)) {
        clearDraft(view, 299);
        view.destroy();
    }
    modalStack.clear();
});

function fixture(kind: "inline" | "modal" | "new" | "new-modal" = "inline") {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
        configurable: true,
        value(this: HTMLDialogElement) {
            this.open = true;
        },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
        configurable: true,
        value(this: HTMLDialogElement) {
            this.open = false;
        },
    });
    const view = new EditorView({
        parent: document.body,
        state: EditorState.create({ doc: "Text", extensions: [annotationField] }),
    });
    views.push(view);
    let accept: (() => void) | undefined;
    let reject: ((error: Error) => void) | undefined;
    const send = vi.fn(
        (_id: number, _message: string) =>
            new Promise<void>((resolve, fail) => {
                accept = resolve;
                reject = fail;
            }),
    );
    registerCommentSubmissions(view, (id, message) => () => send(id, message));
    const annotation: GenericAnnotation = {
        id: 299,
        _type: "comment",
        status: kind.startsWith("new") ? "pending" : "active",
        selection: EditorSelection.single(0, 4),
        thread: kind.startsWith("new") ? [] : [{ message: "Original", author: "Owner", time: 1 }],
    };
    view.dispatch({ effects: addAnnotation.of(annotation) });
    rootEditorView.set(view);
    annotationsStore.set(view.state.field(annotationField));
    const updated = vi.fn();
    if (kind === "modal" || kind === "new-modal")
        modalStack.push({ type: "comment", commentId: 299, parentView: view, label: "Comment" });
    const component =
        kind === "modal" || kind === "new-modal"
            ? render(CommentModal, { props: { parentView: view, commentId: 299, stackIndex: 0 } })
            : kind === "new"
              ? render(PreComment, {
                    props: {
                        view,
                        annotationsData: { 299: annotation },
                        pendingAnnotation: annotation,
                    },
                })
              : render(Thread, {
                    props: {
                        thread: [{ message: "Original", author: "Owner", time: 1 }],
                        updateThread: updated,
                        annotationId: 299,
                        view,
                        commentThread: true,
                    },
                });
    return {
        ...component,
        send,
        updated,
        accept: () => accept?.(),
        reject: () => reject?.(new Error("Connection lost")),
    };
}

describe("acknowledged comment composer", () => {
    it.each(["inline", "modal", "new"] as const)(
        "retains the %s composer draft on failure and exposes an actionable error",
        async (kind) => {
            const { getByPlaceholderText, getByRole, send, reject, updated } = fixture(kind);
            const input = getByPlaceholderText(kind === "new" ? "Add a comment…" : "Reply…");
            await fireEvent.input(input, { target: { value: "Unsent reply" } });
            await fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
            expect(getDraft(views.at(-1), 299)).toBe("Unsent reply");
            expect(send).toHaveBeenCalledWith(299, "Unsent reply");
            reject();
            await vi.waitFor(() => expect(getByRole("alert").textContent).toBe("Connection lost"));
            expect(getDraft(views.at(-1), 299)).toBe("Unsent reply");
            expect(updated).not.toHaveBeenCalled();
        },
    );

    it("clears only an accepted draft and blocks overlapping requests", async () => {
        const { getByPlaceholderText, send, accept } = fixture();
        const input = getByPlaceholderText("Reply…");
        await fireEvent.input(input, { target: { value: "Accepted reply" } });
        await fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
        await fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
        expect(send).toHaveBeenCalledTimes(1);
        expect(getDraft(views.at(-1), 299)).toBe("Accepted reply");
        accept();
        await vi.waitFor(() => expect(getDraft(views.at(-1), 299)).toBe(""));
    });

    it("retains text entered while another reply awaits acknowledgement", async () => {
        const { getByPlaceholderText, send, accept } = fixture();
        const input = getByPlaceholderText("Reply…");
        await fireEvent.input(input, { target: { value: "First reply" } });
        await fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
        await fireEvent.input(input, { target: { value: "Next draft" } });
        await fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
        expect(send).toHaveBeenCalledTimes(1);
        accept();
        await vi.waitFor(() => expect(getDraft(views.at(-1), 299)).toBe("Next draft"));
        expect(getDraft(views.at(-1), 299)).toBe("Next draft");
    });
});

it("keeps a root comment reactive when an earlier root modal occupies the stack", async () => {
    fixture("inline");
    cleanup();
    const view = views.at(-1);
    if (!view) throw new Error("Missing editor");
    rootEditorView.set(view);
    annotationsStore.set(view.state.field(annotationField));
    modalStack.push({
        type: "comment",
        commentId: 298,
        parentView: view,
        label: "Pending comment",
    });
    modalStack.push({
        type: "comment",
        commentId: 299,
        parentView: view,
        label: "Accepted comment",
    });
    const component = render(CommentModal, {
        props: { parentView: view, commentId: 299, stackIndex: 1 },
    });
    expect(component.getByText("Original")).toBeDefined();
    view.dispatch({
        effects: updateThread.of({
            annotationId: 299,
            newThread: [
                { message: "Original", author: "Owner", time: 1 },
                { message: "Accepted reply", author: "Joiner", time: 2 },
            ],
        }),
    });
    annotationsStore.set(view.state.field(annotationField));
    await vi.waitFor(() => expect(component.getByText("Accepted reply")).toBeDefined());
});

it("locks a pending new modal comment until acknowledgement", async () => {
    const { getByPlaceholderText, accept } = fixture("new-modal");
    const input = getByPlaceholderText("Reply…") as HTMLTextAreaElement;
    await fireEvent.input(input, { target: { value: "New comment" } });
    await fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(input.disabled).toBe(true);
    accept();
    await vi.waitFor(() => expect(input.disabled).toBe(false));
});

it("does not clear an equally worded local draft when a previous scope is acknowledged", async () => {
    const { getByPlaceholderText, accept } = fixture();
    const view = views.at(-1);
    if (!view) throw new Error("Missing editor");
    const scope = new Compartment();
    const localScope = {};
    view.dispatch({
        effects: StateEffect.appendConfig.of([
            scope.of(commentDraftScope.of(localScope)),
            commentDraftScopeBridge,
        ]),
    });
    const input = getByPlaceholderText("Reply…");
    await fireEvent.input(input, { target: { value: "Same reply" } });
    view.dispatch({ effects: scope.reconfigure(commentDraftScope.of({})) });
    await fireEvent.input(input, { target: { value: "Same reply" } });
    await fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    view.dispatch({ effects: scope.reconfigure(commentDraftScope.of(localScope)) });
    accept();
    await vi.waitFor(() => expect(getCommentSubmission(view, 299)?.pending).toBe(false));
    expect(getDraft(view, 299)).toBe("Same reply");
});
