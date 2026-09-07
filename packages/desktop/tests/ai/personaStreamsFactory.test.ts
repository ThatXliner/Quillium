import { runMultiPersonaStreams } from "$lib/ai/chatFactory";
import type { StreamOpts } from "$lib/ai/clientStreams";
import { annotationField } from "$lib/editor/plugins/annotations";
import type { ReaderPersona } from "$lib/readers/presets";
import {
    currentDocumentId,
    currentDraftId,
    currentTabId,
    documentContent,
    editorView,
} from "$lib/stores";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { UIMessageChunk } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    applyEditorialAction: vi.fn(),
    aiSettings: {
        provider: "openai",
        model: "test-model",
        apiKey: "test-key",
        baseURL: "",
    },
    ensureApiKeyLoaded: vi.fn(),
    getAiAbortSignal: vi.fn(),
    posthogCapture: vi.fn(),
    toastError: vi.fn(),
    toastWarning: vi.fn(),
}));

vi.mock("$lib/ai/editorialAction", () => ({
    applyEditorialAction: mocks.applyEditorialAction,
    editorialActionFailureMessage: vi.fn(),
}));

vi.mock("$lib/ai/settings.svelte", () => ({
    aiSettings: mocks.aiSettings,
    beginAiTask: vi.fn(),
    endAiTask: vi.fn(),
    ensureApiKeyLoaded: mocks.ensureApiKeyLoaded,
    getAiAbortSignal: mocks.getAiAbortSignal,
    getEffectiveDocumentContext: vi.fn(() => ({ freeform: "", decisions: [] })),
    getEffectiveEditorialPreferences: vi.fn(() => ({
        stance: "author-first",
        feedbackDensity: "focused",
        voiceLatitude: "preserve",
    })),
    setAiProcessing: vi.fn(),
    useAiChatEffects: vi.fn(),
}));

vi.mock("$lib/posthog", () => ({ default: { capture: mocks.posthogCapture } }));

vi.mock("svelte-sonner", () => ({
    toast: {
        error: mocks.toastError,
        warning: mocks.toastWarning,
    },
}));

const personas: ReaderPersona[] = [
    {
        id: "skeptical-editor",
        name: "Skeptical Editor",
        emoji: "",
        color: "#336699",
        description: "Checks claims.",
        instruction: "checks claims",
        builtin: true,
        enabled: true,
        chattiness: "quiet",
    },
    {
        id: "clarity-coach",
        name: "Clarity Coach",
        emoji: "",
        color: "#336699",
        description: "Checks clarity.",
        instruction: "checks clarity",
        builtin: true,
        enabled: true,
        chattiness: "quiet",
    },
];

const errorText = "The provider rejected required tool selection.";

function streamWithChunk(chunk: UIMessageChunk): ReadableStream<UIMessageChunk> {
    return new ReadableStream({
        start(controller) {
            controller.enqueue(chunk);
            controller.close();
        },
    });
}

describe("runMultiPersonaStreams", () => {
    let view: EditorView;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.ensureApiKeyLoaded.mockResolvedValue(undefined);
        mocks.getAiAbortSignal.mockReturnValue(new AbortController().signal);
        view = new EditorView({
            state: EditorState.create({
                doc: "The draft contains a deliberate fragment.",
                extensions: [annotationField],
            }),
            parent: document.body,
        });
        editorView.set(view);
        currentDocumentId.set("document-1");
        currentTabId.set("tab-1");
        currentDraftId.set("draft-1");
        documentContent.set("The draft contains a deliberate fragment.");
        mocks.aiSettings.provider = "openai";
        mocks.aiSettings.model = "test-model";
        mocks.aiSettings.apiKey = "test-key";
        mocks.aiSettings.baseURL = "";
    });

    afterEach(() => {
        editorView.set(null as unknown as Parameters<typeof editorView.set>[0]);
        view.destroy();
    });

    it.each(["feedback", "revise"] as const)(
        "uses annotation-only %s streams and skips noAction before dispatch",
        async (mode) => {
            mocks.applyEditorialAction.mockReturnValue({ ok: true });
            const streamFn = vi.fn(async (options: StreamOpts) => {
                const isNoAction = options.persona?.id === "skeptical-editor";
                return streamWithChunk(
                    isNoAction
                        ? {
                              type: "tool-input-available",
                              toolCallId: `call-${options.persona?.id}`,
                              toolName: "noAction",
                              input: {},
                          }
                        : {
                              type: "tool-input-available",
                              toolCallId: `call-${options.persona?.id}`,
                              toolName: "createComment",
                              input: {
                                  targetText: "deliberate fragment",
                                  comment: "This phrase needs attention.",
                              },
                          },
                );
            });

            await runMultiPersonaStreams({
                personas,
                streamFn,
                messages: [],
                mode,
            });

            expect(streamFn).toHaveBeenCalledTimes(2);
            expect(streamFn.mock.calls.map(([options]) => options.annotationOnly)).toEqual([
                true,
                true,
            ]);
            expect(streamFn.mock.calls.map(([options]) => options.persona?.id)).toEqual([
                "skeptical-editor",
                "clarity-coach",
            ]);
            expect(mocks.applyEditorialAction).toHaveBeenCalledOnce();
            expect(mocks.applyEditorialAction).toHaveBeenCalledWith(
                expect.objectContaining({
                    payload: {
                        action: "comment",
                        targetText: "deliberate fragment",
                        comment: "This phrase needs attention.",
                    },
                }),
            );
            expect(mocks.toastError).not.toHaveBeenCalled();
            expect(mocks.toastWarning).not.toHaveBeenCalled();
            expect(
                mocks.posthogCapture.mock.calls.filter(([event]) => event === "annotation_created"),
            ).toHaveLength(1);
            expect(
                mocks.posthogCapture.mock.calls.filter(
                    ([event]) => event === "reader_persona_review_completed",
                ),
            ).toHaveLength(2);
        },
    );

    it("does not dispatch noAction or record annotation analytics", async () => {
        const streamFn = vi.fn(async (options: StreamOpts) => {
            return streamWithChunk({
                type: "tool-input-available",
                toolCallId: `call-${options.persona?.id}`,
                toolName: "noAction",
                input: {},
            });
        });

        await runMultiPersonaStreams({
            personas,
            streamFn,
            messages: [],
            mode: "feedback",
        });

        expect(mocks.applyEditorialAction).not.toHaveBeenCalled();
        expect(mocks.toastError).not.toHaveBeenCalled();
        expect(mocks.toastWarning).not.toHaveBeenCalled();
        expect(
            mocks.posthogCapture.mock.calls.filter(([event]) => event === "annotation_created"),
        ).toHaveLength(0);
        expect(
            mocks.posthogCapture.mock.calls.filter(
                ([event]) => event === "reader_persona_review_completed",
            ),
        ).toHaveLength(2);
    });

    it("surfaces provider stream errors and does not record completion", async () => {
        const streamFn = vi.fn(async (_options: StreamOpts) =>
            streamWithChunk({ type: "error", errorText }),
        );

        await expect(
            runMultiPersonaStreams({
                personas: [personas[0]],
                streamFn,
                messages: [],
                mode: "feedback",
            }),
        ).rejects.toThrow(errorText);

        expect(mocks.toastError).toHaveBeenCalledOnce();
        expect(mocks.toastError).toHaveBeenCalledWith(errorText);
        expect(
            mocks.posthogCapture.mock.calls.filter(
                ([event]) => event === "reader_persona_review_completed",
            ),
        ).toHaveLength(0);
    });

    it("uses the API key loaded during the request capture window", async () => {
        mocks.ensureApiKeyLoaded.mockImplementationOnce(async () => {
            mocks.aiSettings.apiKey = "loaded-from-keychain";
        });
        const streamFn = vi.fn(async (_options: StreamOpts) => streamWithChunk({ type: "finish" }));

        await runMultiPersonaStreams({
            personas: [personas[0]],
            streamFn,
            messages: [],
            mode: "feedback",
        });

        expect(streamFn).toHaveBeenCalledOnce();
        expect(streamFn.mock.calls[0]?.[0].apiKey).toBe("loaded-from-keychain");
    });

    it("does not dispatch after the tab changes while credentials load", async () => {
        let resolveCredentials!: () => void;
        mocks.ensureApiKeyLoaded.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    resolveCredentials = resolve;
                }),
        );
        const streamFn = vi.fn(async (_options: StreamOpts) => streamWithChunk({ type: "finish" }));
        const request = runMultiPersonaStreams({
            personas: [personas[0]],
            streamFn,
            messages: [],
            mode: "feedback",
        });

        await Promise.resolve();
        currentTabId.set("tab-2");
        resolveCredentials();

        await expect(request).rejects.toThrow(/target.*changed/i);
        expect(streamFn).not.toHaveBeenCalled();
    });
});
