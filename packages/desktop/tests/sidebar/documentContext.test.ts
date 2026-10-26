import DocumentContext from "$lib/ai/DocumentContext.svelte";
import { generateContext } from "$lib/ai/clientStreams";
import {
    documentContext,
    endAiTask,
    getAiAbortSignal,
    saveDocumentContext,
} from "$lib/ai/settings.svelte";
import { type AppSettings, appSettings } from "$lib/settings.svelte";
import { currentDocumentId } from "$lib/stores";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/ai/clientStreams", () => ({
    generateContext: vi.fn(),
}));

vi.mock("$lib/ai/settings.svelte", () => ({
    aiSettings: {
        provider: "openai",
        model: "gpt-5.6-sol",
        apiKey: "test-api-key",
    },
    beginAiTask: vi.fn(() => Symbol("document-context")),
    documentContext: {
        freeform: "",
        decisions: [],
    },
    endAiTask: vi.fn(),
    ensureApiKeyLoaded: vi.fn(async () => {}),
    getAiAbortSignal: vi.fn(),
    hasApiKey: vi.fn(() => true),
    saveDocumentContext: vi.fn(),
}));

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((promiseResolve) => {
        resolve = promiseResolve;
    });
    return { promise, resolve };
}

const promptPlaceholder =
    "Paste your essay prompt, assignment, or brief here and the AI will generate context below…";

const mutableAppSettings = appSettings as AppSettings;
let previousAiEnabled: boolean;

beforeEach(() => {
    previousAiEnabled = mutableAppSettings.aiEnabled;
    mutableAppSettings.aiEnabled = true;
    documentContext.freeform = "";
    documentContext.decisions = [];
    vi.clearAllMocks();
});

afterEach(() => {
    cleanup();
    mutableAppSettings.aiEnabled = previousAiEnabled;
    currentDocumentId.set(null);
});

describe("DocumentContext generation lifecycle", () => {
    it("does not apply or save a result after the document changes", async () => {
        const request = deferred<string>();
        const requestController = new AbortController();
        vi.mocked(generateContext).mockReturnValue(request.promise);
        vi.mocked(getAiAbortSignal).mockReturnValue(requestController.signal);
        currentDocumentId.set("document-a");

        const ui = render(DocumentContext, { active: true, session: null });
        await submitPrompt(ui, "Write an opening paragraph");
        expect(generateContext).toHaveBeenCalledWith(
            expect.objectContaining({ prompt: "Write an opening paragraph" }),
        );

        currentDocumentId.set("document-b");
        request.resolve("Generated context for document A");
        await vi.waitFor(() => expect(endAiTask).toHaveBeenCalledOnce());

        expect(documentContext.freeform).toBe("");
        expect(saveDocumentContext).not.toHaveBeenCalled();
    });

    it("ignores a result after its request is aborted", async () => {
        const request = deferred<string>();
        const requestController = new AbortController();
        vi.mocked(generateContext).mockReturnValue(request.promise);
        vi.mocked(getAiAbortSignal).mockReturnValue(requestController.signal);
        currentDocumentId.set("document-a");

        const ui = render(DocumentContext, { active: true, session: null });
        await submitPrompt(ui, "Describe the audience");
        requestController.abort();
        request.resolve("Should be ignored");
        await vi.waitFor(() => expect(endAiTask).toHaveBeenCalledOnce());

        expect(documentContext.freeform).toBe("");
        expect(saveDocumentContext).not.toHaveBeenCalled();
    });

    it("applies and saves a result when the document remains current", async () => {
        const request = deferred<string>();
        const requestController = new AbortController();
        vi.mocked(generateContext).mockReturnValue(request.promise);
        vi.mocked(getAiAbortSignal).mockReturnValue(requestController.signal);
        currentDocumentId.set("document-a");

        const ui = render(DocumentContext, { active: true, session: null });
        await submitPrompt(ui, "Set the tone");
        request.resolve("A concise, reflective tone");
        await vi.waitFor(() => expect(endAiTask).toHaveBeenCalledOnce());

        expect(documentContext.freeform).toBe("A concise, reflective tone");
        expect(saveDocumentContext).toHaveBeenCalledOnce();
    });
});

type DocumentContextUi = {
    getByPlaceholderText: (text: string) => HTMLElement;
    getByRole: (role: "button", options: { name: string }) => HTMLElement;
};

async function submitPrompt(ui: DocumentContextUi, prompt: string): Promise<void> {
    await fireEvent.input(ui.getByPlaceholderText(promptPlaceholder), {
        target: { value: prompt },
    });
    await fireEvent.click(ui.getByRole("button", { name: "Generate context" }));
    await vi.waitFor(() => expect(generateContext).toHaveBeenCalledOnce());
}
