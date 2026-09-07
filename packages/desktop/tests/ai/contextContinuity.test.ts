import { buildAnnotationContextInputs } from "$lib/ai/annotationContext";
import { streamFeedback } from "$lib/ai/clientStreams";
import { captureContextRetrieval } from "$lib/ai/contextRetrieval";
import { annotationField } from "$lib/editor/plugins/annotations/annotationField";
import type { Annotations } from "$lib/editor/plugins/annotations/models";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ streamText: vi.fn() }));
vi.mock("$lib/ai/provider", () => ({ createModel: vi.fn(() => ({})) }));
vi.mock("ai", async (importOriginal) => ({
    ...(await importOriginal<typeof import("ai")>()),
    streamText: mocks.streamText,
}));

let view: EditorView | undefined;

afterEach(() => {
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
