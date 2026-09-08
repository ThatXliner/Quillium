import { webcrypto } from "node:crypto";
import { buildAnnotationContextInputs } from "$lib/ai/annotationContext";
import { streamFeedback } from "$lib/ai/clientStreams";
import { captureContextRetrieval } from "$lib/ai/contextRetrieval";
import { annotationField } from "$lib/editor/plugins/annotations/annotationField";
import type { Annotations } from "$lib/editor/plugins/annotations/models";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ streamText: vi.fn() }));
vi.mock("$lib/ai/provider", () => ({ createModel: vi.fn(() => ({})) }));
vi.mock("ai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("ai")>()),
    streamText: mocks.streamText,
}));

let view: EditorView | undefined;

beforeEach(() => vi.stubGlobal("crypto", webcrypto));

afterEach(() => {
    vi.unstubAllGlobals();
    view?.destroy();
    view = undefined;
});

function createView(documentContent: string, annotations: Annotations): EditorView {
    const annotationFieldJson = Object.fromEntries(
        Object.values(annotations).map((annotation) => [
            annotation.id,
            {
                ...annotation,
                selection: annotation.selection.toJSON(),
            },
        ]),
    );
    view = new EditorView({
        state: EditorState.fromJSON(
            {
                doc: documentContent,
                selection: EditorSelection.single(0).toJSON(),
                annotationField: annotationFieldJson,
            },
            { extensions: [annotationField] },
            { annotationField },
        ),
        parent: document.body,
    });
    return view;
}

it("makes a recently withdrawn concern accessible to Feedback beyond the automatic budget", async () => {
    mocks.streamText.mockReturnValue({ toUIMessageStream: () => new ReadableStream() });
    const documentContent = "The revised draft now explains the evidence.";
    const withdrawal = "I withdraw the evidence concern.";
    const annotations: Annotations = Object.fromEntries(
        Array.from({ length: 9 }, (_, index) => [
            index + 1,
            {
                id: index + 1,
                _type: "comment" as const,
                status: "active" as const,
                selection: EditorSelection.single(0, documentContent.length),
                thread:
                    index === 0
                        ? [
                              { author: "AI", message: "The evidence is missing.", time: 1 },
                              { author: "Writer", message: "I added the evidence.", time: 10 },
                              { author: "AI", message: withdrawal, time: 11 },
                          ]
                        : [
                              {
                                  author: "AI",
                                  message: `Other concern ${index}`,
                                  time: 100 + index,
                              },
                          ],
            },
        ]),
    );
    const annotationContext = buildAnnotationContextInputs({
        documentContent,
        annotations,
    });
    const rootView = createView(documentContent, annotations);
    const contextRetrieval = captureContextRetrieval({
        rootView,
        documentId: "document-a",
        tabId: "tab-a",
        draftId: "draft-a",
    });
    await streamFeedback({
        messages: [
            {
                id: "reconsider",
                role: "user",
                parts: [{ type: "text", text: "I addressed your concerns. Reconsider." }],
            },
        ],
        documentContent,
        selectedText: "",
        annotationContext,
        contextRetrieval,
        provider: "openai",
        model: "test",
        apiKey: "test",
    });
    const request = mocks.streamText.mock.calls[0][0];
    const supplied = JSON.stringify(request.messages);
    expect(supplied).not.toContain(withdrawal);
    expect(request.tools?.listAnnotationThreads).toBeDefined();

    const matches = contextRetrieval.listAnnotationThreads({ query: "withdraw" });
    expect(matches.threads).toHaveLength(1);
    const reference = matches.threads[0]?.threadReference;
    expect(reference).toBeTruthy();
    const fullThread = contextRetrieval.readAnnotationThread({
        threadReference: reference ?? "",
    });
    expect(fullThread).toMatchObject({ available: true, id: 1 });
    if (!fullThread.available) throw new Error("Thread unavailable");
    expect(fullThread.content).toContain(withdrawal);
});

function user(id: string): import("ai").UIMessage {
    return { id, role: "user", parts: [{ type: "text", text: `Request ${id}` }] };
}

it("anchors one initial summary, notes changes, and reseeds trimmed history", async () => {
    const { createContextHistory } = await import("$lib/ai/contextHistory");
    const history = createContextHistory();
    const rootView = createView("Original draft.", {});
    const capture = () =>
        captureContextRetrieval({ rootView, documentId: "doc", tabId: "tab", draftId: "draft" });
    const prepare = (messages: import("ai").UIMessage[], extra = {}) =>
        history.prepare({
            messages,
            initialSummary: { role: "user", content: rootView.state.doc.toString() },
            retrieval: capture(),
            mode: "feedback",
            ...extra,
        });
    const messages = [user("1")];
    const first = await prepare(messages);
    expect(first).toHaveLength(2);
    expect(messages).toHaveLength(1);
    messages.push(user("2"));
    const unchanged = await prepare(messages);
    expect(unchanged).toHaveLength(3);
    expect(unchanged[0]).toEqual(first[0]);
    expect(JSON.stringify(unchanged)).not.toContain("Editor context changed");
    rootView.dispatch({ changes: { from: rootView.state.doc.length, insert: " NEW_PROSE" } });
    messages.push(user("3"));
    const changed = await prepare(messages);
    expect(changed).toHaveLength(5);
    expect(JSON.stringify(changed)).toContain("Editor context changed");
    expect(JSON.stringify(changed)).not.toContain("NEW_PROSE");
    const retry = await prepare(messages);
    expect(retry).toEqual(changed);
    messages.push(user("4"));
    expect(await prepare(messages)).toHaveLength(6);
    // Removing the baseline must not leave only references to unavailable old context.
    const trimmed = await prepare(messages.slice(1));
    expect(JSON.stringify(trimmed).match(/Initial editor context/g)).toHaveLength(1);
    expect(JSON.stringify(trimmed)).toContain("NEW_PROSE");
    expect(trimmed.at(-2)?.id).toBe("context:4");
    expect(JSON.stringify(trimmed)).not.toContain("Editor context changed");
    const reset = await prepare([user("new-chat")]);
    expect(reset).toHaveLength(2);
    expect(reset[0].id).toBe("context:new-chat");
});

it("notices selection and writer guidance changes without resending unchanged guidance", async () => {
    const { createContextHistory } = await import("$lib/ai/contextHistory");
    const history = createContextHistory();
    const rootView = createView("Draft text.", {});
    const messages = [user("1")];
    const prepare = (freeform: string, selectedTextRange?: { from: number; to: number }) =>
        history.prepare({
            messages,
            initialSummary: { role: "user", content: "Initial draft and brief." },
            retrieval: captureContextRetrieval({
                rootView,
                documentId: "doc",
                tabId: "tab",
                draftId: "draft",
            }),
            mode: "feedback",
            documentContext: { freeform },
            selectedTextRange,
        });
    await prepare("OLD_BRIEF");
    messages.push(user("2"));
    const selection = await prepare("OLD_BRIEF", { from: 0, to: 5 });
    expect(JSON.stringify(selection.at(-2))).toContain("selectionRange");
    expect(JSON.stringify(selection.at(-2))).not.toContain("OLD_BRIEF");
    messages.push(user("3"));
    const brief = await prepare("NEW_BRIEF", { from: 0, to: 5 });
    expect(JSON.stringify(brief.at(-2))).toContain("NEW_BRIEF");
    messages.push(user("4"));
    rootView.dispatch({ changes: { from: 0, insert: "Edited " } });
    const edited = await prepare("NEW_BRIEF", { from: 0, to: 5 });
    expect(JSON.stringify(edited.at(-2))).toContain("Editor context changed");
    expect(JSON.stringify(edited.at(-2))).not.toContain("NEW_BRIEF");
    messages.push(user("5"));
    const cleared = await prepare("");
    expect(JSON.stringify(cleared.at(-2))).toContain("No writer guidance is currently set.");
});

it("prunes historical retrieval using the SDK while preserving editorial records and UI history", async () => {
    mocks.streamText.mockClear();
    mocks.streamText.mockReturnValue({ toUIMessageStream: () => new ReadableStream() });
    const rootView = createView("Draft text.", {});
    const messages: import("ai").UIMessage[] = [
        user("1"),
        {
            id: "assistant-1",
            role: "assistant",
            parts: [
                {
                    type: "tool-readDraftContext",
                    toolCallId: "read-1",
                    state: "output-available",
                    input: {},
                    output: { content: "STALE_RETRIEVED_PASSAGE" },
                },
                {
                    type: "tool-createComment",
                    toolCallId: "comment-1",
                    state: "output-available",
                    input: { targetText: "Draft text.", comment: "Keep this editorial record" },
                    output: { success: true },
                },
                { type: "text", text: "Keep this explanation." },
            ],
        },
        user("2"),
    ];
    const original = JSON.stringify(messages);
    await streamFeedback({
        messages,
        documentContent: "Draft text.",
        selectedText: "",
        provider: "openai",
        model: "test",
        apiKey: "test",
        contextRetrieval: captureContextRetrieval({
            rootView,
            documentId: "doc",
            tabId: "tab",
            draftId: "draft",
        }),
    });
    const request = mocks.streamText.mock.calls[0][0];
    const supplied = JSON.stringify(request.messages);
    expect(supplied).not.toContain("STALE_RETRIEVED_PASSAGE");
    expect(supplied).not.toContain('"toolName":"readDraftContext"');
    expect(supplied).toContain("Keep this editorial record");
    expect(supplied).toContain("Keep this explanation.");
    expect(JSON.stringify(messages)).toBe(original);
    expect(request.prepareStep({ stepNumber: 1 })).toBeUndefined();
});
