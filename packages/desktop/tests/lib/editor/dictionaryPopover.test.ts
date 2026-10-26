import { type StructuredDictionaryData, generateDictionaryEntry } from "$lib/ai/clientStreams";
import {
    aiSettings,
    beginAiTask,
    endAiTask,
    ensureApiKeyLoaded,
    getAiAbortSignal,
    hasApiKey,
} from "$lib/ai/settings.svelte";
import DictionaryPopover from "$lib/editor/DictionaryPopover.svelte";
import { appEventBus } from "$lib/events/appEventBus";
import { type AppSettings, appSettings } from "$lib/settings.svelte";
import { editorView, selectedText } from "$lib/stores";
import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { APICallError, NoObjectGeneratedError } from "ai";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    chat: {
        status: "ready",
        messages: [] as unknown[],
        stop: vi.fn(),
        sendMessage: vi.fn(),
    },
}));

vi.mock("$lib/ai/chatFactory", () => ({
    createAiChat: vi.fn(() => ({ chat: mocks.chat, clearChat: vi.fn() })),
    useAiChatEffects: vi.fn(),
}));

vi.mock("$lib/ai/clientStreams", () => ({
    generateDictionaryEntry: vi.fn(),
}));

vi.mock("$lib/ai/settings.svelte", () => ({
    aiSettings: {
        provider: "openai",
        model: "gpt-5.6-sol",
        apiKey: "test-api-key",
        baseURL: "",
    },
    beginAiTask: vi.fn(() => Symbol("dictionary-lookup")),
    endAiTask: vi.fn(),
    ensureApiKeyLoaded: vi.fn(async () => {}),
    getAiAbortSignal: vi.fn(),
    hasApiKey: vi.fn(() => true),
}));

vi.mock("$lib/ai/utils", () => ({
    renderMarkdown: vi.fn(async (text: string) => text),
}));

vi.mock("$lib/posthog", () => ({
    capture: vi.fn(),
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

function entryFor(definition: string, synonyms: string[] = []): StructuredDictionaryData {
    return {
        phonetic: "/ˈtɛst/",
        meanings: [{ partOfSpeech: "adjective", definitions: [{ definition, example: "" }] }],
        synonyms,
        antonyms: ["unhelpful"],
    };
}

const emptyEntry: StructuredDictionaryData = {
    phonetic: "",
    meanings: [],
    synonyms: [],
    antonyms: [],
};

async function open(word: string, selectionFrom = 0): Promise<void> {
    selectedText.set(word);
    appEventBus.emit({
        type: "dictionary-open",
        word,
        selectionFrom,
        selectionTo: selectionFrom + word.length,
        x: 100,
        y: 100,
    });
    await tick();
}

function lookupSignal(callIndex: number): AbortSignal {
    const signal = vi.mocked(generateDictionaryEntry).mock.calls[callIndex][0].abortSignal;
    if (!signal) throw new Error("lookup was started without an abort signal");
    return signal;
}

async function expectLookupCount(count: number): Promise<void> {
    await vi.waitFor(() => expect(generateDictionaryEntry).toHaveBeenCalledTimes(count));
}

const mutableAppSettings = appSettings as AppSettings;
let previousAiEnabled: boolean;
let globalStop: AbortController;

beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(aiSettings, {
        provider: "openai",
        model: "gpt-5.6-sol",
        apiKey: "test-api-key",
        baseURL: "",
    });
    vi.mocked(ensureApiKeyLoaded).mockResolvedValue(undefined);
    previousAiEnabled = mutableAppSettings.aiEnabled;
    mutableAppSettings.aiEnabled = true;
    globalStop = new AbortController();
    vi.mocked(getAiAbortSignal).mockReturnValue(globalStop.signal);
    vi.mocked(hasApiKey).mockReturnValue(true);
    mocks.chat.status = "ready";
});

afterEach(() => {
    cleanup();
    mutableAppSettings.aiEnabled = previousAiEnabled;
    selectedText.set("");
});

describe("DictionaryPopover AI lookup", () => {
    it.each(["provider", "model", "baseURL"] as const)(
        "does not send credentials after %s changes during keychain loading",
        async (field) => {
            const keychain = deferred<void>();
            vi.mocked(ensureApiKeyLoaded).mockReturnValue(keychain.promise);
            render(DictionaryPopover);
            await open("helpful");
            if (field === "provider") aiSettings.provider = "anthropic";
            else aiSettings[field] = "changed-setting";
            keychain.resolve();
            expect(await screen.findByText("AI settings changed. Try again.")).toBeTruthy();
            expect(generateDictionaryEntry).not.toHaveBeenCalled();
        },
    );

    it("does not send after AI is disabled during keychain loading", async () => {
        const keychain = deferred<void>();
        vi.mocked(ensureApiKeyLoaded).mockReturnValue(keychain.promise);
        render(DictionaryPopover);
        await open("helpful");
        mutableAppSettings.aiEnabled = false;
        keychain.resolve();
        expect(await screen.findByText("Enable AI in Settings to look up words.")).toBeTruthy();
        expect(generateDictionaryEntry).not.toHaveBeenCalled();
    });

    it("ignores a valid model result delivered after global Stop", async () => {
        const request = deferred<StructuredDictionaryData>();
        vi.mocked(generateDictionaryEntry).mockReturnValue(request.promise);
        render(DictionaryPopover);
        await open("helpful");
        await expectLookupCount(1);
        globalStop.abort();
        expect(await screen.findByText("Lookup stopped.")).toBeTruthy();
        request.resolve(entryFor("A late definition."));
        await tick();
        expect(screen.queryByText("A late definition.")).toBeNull();
    });

    it("renders a structured entry from the configured model without a dictionary API call", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        vi.mocked(generateDictionaryEntry).mockResolvedValue(
            entryFor("Giving aid; useful.", ["useful"]),
        );
        render(DictionaryPopover);

        await open("helpful");

        expect(await screen.findByText("Giving aid; useful.")).toBeTruthy();
        expect(screen.getByText("/ˈtɛst/")).toBeTruthy();
        expect(screen.getByRole("button", { name: "useful" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "unhelpful" })).toBeTruthy();
        expect(generateDictionaryEntry).toHaveBeenCalledWith(
            expect.objectContaining({
                word: "helpful",
                provider: "openai",
                model: "gpt-5.6-sol",
                apiKey: "test-api-key",
            }),
        );
        expect(ensureApiKeyLoaded).toHaveBeenCalled();
        expect(beginAiTask).toHaveBeenCalledWith("dictionary-lookup");
        expect(endAiTask).toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });

    it("blocks lookup and describe requests until a provider is connected", async () => {
        vi.mocked(hasApiKey).mockReturnValue(false);
        const openSettings = vi.fn();
        const unsubscribe = appEventBus.on("ai-open-settings", openSettings);
        render(DictionaryPopover);

        await open("helpful");

        expect(
            await screen.findByText("Connect an AI provider in AI Settings to look up words."),
        ).toBeTruthy();
        expect(ensureApiKeyLoaded).not.toHaveBeenCalled();
        expect(generateDictionaryEntry).not.toHaveBeenCalled();

        const input = screen.getByPlaceholderText("Describe the idea...") as HTMLInputElement;
        expect(input.disabled).toBe(true);
        const form = input.closest("form");
        if (!form) throw new Error("describe form not rendered");
        await fireEvent.input(input, { target: { value: "very happy" } });
        await fireEvent.submit(form);
        expect(mocks.chat.sendMessage).not.toHaveBeenCalled();

        await fireEvent.click(screen.getByRole("button", { name: "Open AI Settings" }));
        expect(openSettings).toHaveBeenCalled();
        unsubscribe();
    });

    it("does not send the word anywhere while AI is disabled", async () => {
        mutableAppSettings.aiEnabled = false;
        render(DictionaryPopover);

        await open("helpful");

        expect(await screen.findByText("Enable AI in Settings to look up words.")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Open AI Settings" })).toBeNull();
        expect(screen.queryByPlaceholderText("Describe the idea...")).toBeNull();
        expect(generateDictionaryEntry).not.toHaveBeenCalled();
    });

    it("explains malformed output and retries the lookup", async () => {
        vi.mocked(generateDictionaryEntry)
            .mockRejectedValueOnce(
                new NoObjectGeneratedError({
                    text: "{}",
                    response: { id: "r", timestamp: new Date(0), modelId: "m" },
                    usage: {
                        inputTokens: 1,
                        outputTokens: 1,
                        totalTokens: 2,
                        inputTokenDetails: {
                            noCacheTokens: 1,
                            cacheReadTokens: 0,
                            cacheWriteTokens: 0,
                        },
                        outputTokenDetails: { textTokens: 1, reasoningTokens: 0 },
                    },
                    finishReason: "stop",
                }),
            )
            .mockResolvedValueOnce(entryFor("Giving aid; useful."));
        render(DictionaryPopover);

        await open("helpful");
        expect(
            await screen.findByText(
                "The AI model returned an incomplete dictionary entry. Try again.",
            ),
        ).toBeTruthy();

        await fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        expect(await screen.findByText("Giving aid; useful.")).toBeTruthy();
        expect(generateDictionaryEntry).toHaveBeenCalledTimes(2);
    });

    it("reports provider failures with the shared AI error message", async () => {
        vi.mocked(generateDictionaryEntry).mockRejectedValue(
            new APICallError({
                message: "Unauthorized",
                url: "https://api.openai.com/v1/responses",
                requestBodyValues: {},
                statusCode: 401,
            }),
        );
        render(DictionaryPopover);

        await open("helpful");

        expect(
            await screen.findByText(
                "Your AI provider rejected the API key. Open AI Settings and check your key.",
            ),
        ).toBeTruthy();
    });

    it("reports an unrecognized word as no results", async () => {
        vi.mocked(generateDictionaryEntry).mockResolvedValue(emptyEntry);
        render(DictionaryPopover);

        await open("xyzzy");

        expect(await screen.findByText('No definition found for "xyzzy".')).toBeTruthy();
    });

    it("shows a stopped state when the global stop control cancels a lookup", async () => {
        vi.mocked(generateDictionaryEntry).mockReturnValue(new Promise(() => {}));
        render(DictionaryPopover);

        await open("helpful");
        await expectLookupCount(1);
        globalStop.abort();

        expect(await screen.findByText("Lookup stopped.")).toBeTruthy();
        expect(lookupSignal(0).aborted).toBe(true);
    });
});

describe("DictionaryPopover cancellation", () => {
    it("aborts and ignores a stale lookup when the popover is retriggered", async () => {
        const first = deferred<StructuredDictionaryData>();
        const second = deferred<StructuredDictionaryData>();
        vi.mocked(generateDictionaryEntry)
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        render(DictionaryPopover);

        await open("first");
        await expectLookupCount(1);
        await open("second", 10);
        await expectLookupCount(2);

        expect(lookupSignal(0).aborted).toBe(true);
        expect(lookupSignal(1).aborted).toBe(false);

        second.resolve(entryFor("The second definition."));
        expect(await screen.findByText("The second definition.")).toBeTruthy();
        first.resolve(entryFor("The stale definition."));
        await tick();
        await Promise.resolve();
        expect(screen.queryByText("The stale definition.")).toBeNull();
    });

    it("aborts the main lookup on dismiss", async () => {
        vi.mocked(generateDictionaryEntry).mockReturnValue(new Promise(() => {}));
        render(DictionaryPopover);

        await open("helpful");
        await expectLookupCount(1);
        await fireEvent.keyDown(window, { key: "Escape" });

        expect(lookupSignal(0).aborted).toBe(true);
    });

    it("aborts pending lookups on unmount", async () => {
        vi.mocked(generateDictionaryEntry).mockReturnValue(new Promise(() => {}));
        const ui = render(DictionaryPopover);

        await open("helpful");
        await expectLookupCount(1);
        ui.unmount();

        expect(lookupSignal(0).aborted).toBe(true);
    });

    it("keeps stacked chip lookups independent and aborts them on dismiss", async () => {
        const useful = deferred<StructuredDictionaryData>();
        const beneficial = deferred<StructuredDictionaryData>();
        vi.mocked(generateDictionaryEntry)
            .mockResolvedValueOnce(entryFor("Giving aid.", ["useful", "beneficial"]))
            .mockReturnValueOnce(useful.promise)
            .mockReturnValueOnce(beneficial.promise);
        render(DictionaryPopover);

        await open("helpful");
        await fireEvent.click(await screen.findByRole("button", { name: "useful" }));
        await fireEvent.click(screen.getByRole("button", { name: "beneficial" }));
        await expectLookupCount(3);

        beneficial.resolve(entryFor("Producing good results."));
        expect(await screen.findByText("Producing good results.")).toBeTruthy();
        expect(screen.getByText("Giving aid.")).toBeTruthy();

        await fireEvent.click(screen.getAllByRole("button", { name: "Close lookup" })[0]);
        expect(lookupSignal(1).aborted).toBe(true);
        expect(lookupSignal(2).aborted).toBe(false);
        expect(screen.getByText("Producing good results.")).toBeTruthy();

        await fireEvent.keyDown(window, { key: "Escape" });
        expect(screen.queryByText("Producing good results.")).toBeNull();
    });

    it("aborts a pending stacked lookup on dismiss", async () => {
        vi.mocked(generateDictionaryEntry)
            .mockResolvedValueOnce(entryFor("Giving aid.", ["useful"]))
            .mockReturnValueOnce(new Promise(() => {}));
        render(DictionaryPopover);

        await open("helpful");
        await fireEvent.click(await screen.findByRole("button", { name: "useful" }));
        await expectLookupCount(2);
        await fireEvent.keyDown(window, { key: "Escape" });

        expect(lookupSignal(1).aborted).toBe(true);
    });
});

describe("DictionaryPopover replacement", () => {
    it("replaces the selected word from a stacked lookup", async () => {
        const dispatch = vi.fn();
        editorView.set({ dispatch } as never);
        vi.mocked(generateDictionaryEntry)
            .mockResolvedValueOnce(entryFor("Giving aid.", ["useful"]))
            .mockResolvedValueOnce(entryFor("Able to be used."));
        render(DictionaryPopover);

        await open("helpful", 4);
        await fireEvent.click(await screen.findByRole("button", { name: "useful" }));
        await fireEvent.click(await screen.findByRole("button", { name: "Replace" }));

        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ changes: { from: 4, to: 11, insert: "useful" } }),
        );
    });
});
