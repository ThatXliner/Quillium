import { AnnotationIdMap } from "$lib/collab/annotationSchema";
import {
    getCommentSubmission,
    registerCommentSubmissions,
} from "$lib/collab/commentSubmission.svelte";
import { createRolePermissions } from "$lib/collab/rolePermissions";
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
import * as Y from "yjs";

const views: EditorView[] = [];
const animateDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
const scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
beforeAll(() => {
    Object.defineProperty(Element.prototype, "animate", {
        configurable: true,
        value: () => {
            const animation: {
                cancel: () => void;
                currentTime: number;
                effect: null;
                onfinish: (() => void) | null;
                playState: string;
            } = {
                cancel: vi.fn(),
                currentTime: 0,
                effect: null,
                onfinish: null,
                playState: "finished",
            };
            queueMicrotask(() => animation.onfinish?.());
            return animation;
        },
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
        configurable: true,
        value: vi.fn(),
    });
});
afterAll(() => {
    if (animateDescriptor) Object.defineProperty(Element.prototype, "animate", animateDescriptor);
    else Reflect.deleteProperty(Element.prototype, "animate");
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
        state: EditorState.create({
            doc: "Text",
            extensions: [annotationField, commentDraftScopeBridge],
        }),
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
    const unregister = registerCommentSubmissions(view, (id, message) => () => send(id, message), {
        scope: view,
        keyForAnnotationId: (id) => String(id),
    });
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
    const updated = vi.fn((newThread) =>
        view.dispatch({ effects: updateThread.of({ annotationId: 299, newThread }) }),
    );
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
        view,
        unregister,
        updated,
        accept: () => accept?.(),
        reject: (message = "Connection lost") => reject?.(new Error(message)),
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
            await vi.waitFor(() =>
                expect(getByRole("alert").textContent).toContain("Your draft is still here"),
            );
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

it.each(["inline", "modal", "new"] as const)(
    "restores %s composer focus after a rejected send loses focus",
    async (kind) => {
        const { getByPlaceholderText, reject } = fixture(kind);
        const input = getByPlaceholderText(
            kind === "new" ? "Add a comment…" : "Reply…",
        ) as HTMLTextAreaElement;
        await fireEvent.input(input, { target: { value: "Keep my draft" } });
        input.focus();
        await fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
        input.blur();
        reject();
        await vi.waitFor(() => expect(document.activeElement).toBe(input));
        expect(input.value).toBe("Keep my draft");
    },
);

it("does not move focus from another control after a rejected comment", async () => {
    const { getByPlaceholderText, reject, getByRole } = fixture();
    const input = getByPlaceholderText("Reply…") as HTMLTextAreaElement;
    await fireEvent.input(input, { target: { value: "Keep my draft" } });
    input.focus();
    await fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    const other = document.createElement("button");
    document.body.append(other);
    other.focus();
    reject();
    await vi.waitFor(() => expect(getByRole("alert")).toBeDefined());
    expect(document.activeElement).toBe(other);
    other.remove();
});

it.each(["inline", "modal", "new"] as const)(
    "reacts to owning-view join and end permissions in the %s composer",
    async (kind) => {
        const { view, queryByPlaceholderText, getByPlaceholderText } = fixture(kind);
        const placeholder = kind === "new" ? "Add a comment…" : "Reply…";
        const input = getByPlaceholderText(placeholder);
        await fireEvent.input(input, { target: { value: "Private local draft" } });
        const permissions = new Compartment();
        view.dispatch({ effects: StateEffect.appendConfig.of(permissions.of([])) });
        const doc = new Y.Doc();
        try {
            view.dispatch({
                effects: permissions.reconfigure(
                    createRolePermissions({
                        role: "viewer",
                        text: doc.getText("document"),
                        annotations: doc.getMap("annotations"),
                        ids: new AnnotationIdMap(),
                        scope: [],
                        prepareComment: () => async () => {},
                    }),
                ),
            });
            await vi.waitFor(() => expect(queryByPlaceholderText(placeholder)).toBeNull());
            view.dispatch({ effects: permissions.reconfigure([]) });
            await vi.waitFor(() =>
                expect((getByPlaceholderText(placeholder) as HTMLTextAreaElement).value).toBe(
                    "Private local draft",
                ),
            );
        } finally {
            doc.destroy();
        }
    },
);

it("retains a local reply draft when the owning editor rejects the transaction", async () => {
    const { view, unregister, getByPlaceholderText, updated } = fixture();
    unregister();
    view.dispatch({
        effects: StateEffect.appendConfig.of(
            EditorState.transactionFilter.of((transaction) =>
                transaction.effects.some((effect) => effect.is(updateThread)) ? [] : transaction,
            ),
        ),
    });
    const input = getByPlaceholderText("Reply…");
    await fireEvent.input(input, { target: { value: "Blocked draft" } });
    await fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(updated).toHaveBeenCalledTimes(1);
    expect(view.state.field(annotationField)[299]?.thread).toHaveLength(1);
    expect(getDraft(view, 299)).toBe("Blocked draft");
});

it.each([
    ["Comment not found", "select the text again"],
    ["Comment selection is no longer available", "select the text again"],
    ["Comment access is unavailable", "reopen your invitation"],
])("turns the relay failure %s into a recovery action", async (message, action) => {
    const { getByPlaceholderText, reject, getByRole } = fixture();
    const input = getByPlaceholderText("Reply…");
    await fireEvent.input(input, { target: { value: "Keep this draft" } });
    await fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    reject(message);
    await vi.waitFor(() => expect(getByRole("alert").textContent).toContain(action));
    expect(getByRole("alert").textContent).not.toContain(message);
    expect((input as HTMLTextAreaElement).value).toBe("Keep this draft");
});
