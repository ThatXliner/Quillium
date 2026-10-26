import { aiSettings } from "$lib/ai/settings.svelte";
import Comment from "$lib/editor/plugins/annotations/Comment.svelte";
import {
    addAnnotation,
    annotationField,
    removeAnnotation,
    updateThread as updateThreadEffect,
} from "$lib/editor/plugins/annotations/annotationField";
import type { Annotation, Thread } from "$lib/editor/plugins/annotations/models";
import { type AppSettings, appSettings } from "$lib/settings.svelte";
import { currentDraftId } from "$lib/stores";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const commentAiMocks = vi.hoisted(() => ({
    buildCommentAiPrompt: vi.fn(() => "comment prompt"),
    streamCommentAiResponse: vi.fn(),
}));

vi.mock("$lib/editor/plugins/annotations/commentAi", () => commentAiMocks);
vi.mock("$lib/posthog", () => ({ default: { capture: vi.fn() } }));

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, resolve, reject };
}

function makeComment(): Annotation<"comment"> {
    return {
        _type: "comment",
        id: 0,
        selection: EditorSelection.single(1, 4),
        thread: [{ message: "Existing comment", author: "Writer", time: 1 }],
        status: "active",
    };
}

function createView(comment: Annotation<"comment">): EditorView {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
        state: EditorState.create({
            doc: "abcdefgh",
            extensions: [annotationField],
        }),
        parent,
    });
    view.dispatch({ effects: addAnnotation.of(comment) });
    return view;
}

function appendThread(view: EditorView, thread: Thread): void {
    view.dispatch({
        effects: updateThreadEffect.of({ annotationId: 0, newThread: thread }),
    });
}

function startRequest() {
    const comment = makeComment();
    const view = createView(comment);
    views.push(view);
    const request = deferred<string>();
    commentAiMocks.streamCommentAiResponse.mockReturnValue(request.promise);
    const updateThread = (thread: Thread) => appendThread(view, thread);
    const ui = render(Comment, {
        props: {
            comment,
            isActive: true,
            view,
            removeComment: vi.fn(),
            updateThread,
        },
    });
    return { comment, view, request, ui };
}

const mutableAppSettings = appSettings as AppSettings;
let previousAiEnabled: boolean;
let previousApiKey: string;
let views: EditorView[] = [];

beforeEach(() => {
    previousAiEnabled = mutableAppSettings.aiEnabled;
    previousApiKey = aiSettings.apiKey;
    mutableAppSettings.aiEnabled = true;
    aiSettings.apiKey = "test-api-key";
    currentDraftId.set("draft-a");
    commentAiMocks.streamCommentAiResponse.mockReset();
    commentAiMocks.buildCommentAiPrompt.mockClear();
});

afterEach(() => {
    cleanup();
    for (const view of views) view.destroy();
    views = [];
    currentDraftId.set(null);
    mutableAppSettings.aiEnabled = previousAiEnabled;
    aiSettings.apiKey = previousApiKey;
});

describe("comment AI suggestions", () => {
    it.each([
        {
            label: "a response",
            settle: (request: Deferred<string>) => request.resolve("AI reply"),
            expected: "AI reply",
        },
        {
            label: "an error",
            settle: (request: Deferred<string>) => request.reject(new Error("stream failed")),
            expected: "Sorry, I encountered an error generating a suggestion.",
        },
    ])("preserves a reply added while waiting for $label", async ({ settle, expected }) => {
        const { comment, view, request, ui } = startRequest();

        await fireEvent.click(ui.getByRole("button", { name: "Get AI suggestion" }));
        ui.unmount();

        const writerReply = {
            message: "Reply added while AI was thinking",
            author: "Writer",
            time: 2,
        };
        appendThread(view, [...comment.thread, writerReply]);
        settle(request);

        await vi.waitFor(() => {
            expect(view.state.field(annotationField)[0]?.thread).toEqual([
                ...comment.thread,
                writerReply,
                expect.objectContaining({ message: expected, author: "AI" }),
            ]);
        });
    });

    it("does not append after the draft changes on the same editor view", async () => {
        const { comment, view, request, ui } = startRequest();

        await fireEvent.click(ui.getByRole("button", { name: "Get AI suggestion" }));
        ui.unmount();
        currentDraftId.set("draft-b");
        request.resolve("AI reply");

        await Promise.resolve();
        await Promise.resolve();
        expect(view.state.field(annotationField)[0]?.thread).toEqual(comment.thread);
    });

    it("does not resurrect a deleted annotation", async () => {
        const { view, request, ui } = startRequest();

        await fireEvent.click(ui.getByRole("button", { name: "Get AI suggestion" }));
        ui.unmount();
        const current = view.state.field(annotationField)[0];
        if (!current) throw new Error("Expected comment annotation");
        view.dispatch({ effects: removeAnnotation.of(current) });
        request.resolve("AI reply");

        await Promise.resolve();
        await Promise.resolve();
        expect(view.state.field(annotationField)[0]).toBeUndefined();
    });

    it("does not append to a replacement annotation with the same id", async () => {
        const { view, request, ui } = startRequest();

        await fireEvent.click(ui.getByRole("button", { name: "Get AI suggestion" }));
        ui.unmount();
        const current = view.state.field(annotationField)[0];
        if (!current) throw new Error("Expected comment annotation");
        const replacement = makeComment();
        replacement.thread = [{ message: "Replacement comment", author: "Writer", time: 3 }];
        view.dispatch({
            effects: [removeAnnotation.of(current), addAnnotation.of(replacement)],
        });
        request.resolve("AI reply");

        await Promise.resolve();
        await Promise.resolve();
        expect(view.state.field(annotationField)[0]?.thread).toEqual(replacement.thread);
    });
});
