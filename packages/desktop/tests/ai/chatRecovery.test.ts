import Chat from "$lib/ai/Chat.svelte";
import { appEventBus } from "$lib/events/appEventBus";
import { documentContent } from "$lib/stores";
import { get } from "svelte/store";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    sendMessage: vi.fn(async () => {}),
    chat: {
        status: "error",
        messages: [],
        error: new Error("OpenAI OAuth session not found."),
    },
}));

vi.mock("$lib/ai/chatFactory", () => ({
    createAiChat: () => ({ chat: mocks.chat, clearChat: vi.fn(), sendMessage: mocks.sendMessage }),
    useAiChatEffects: vi.fn(),
}));
vi.mock("$lib/ai/settings.svelte", () => ({
    aiSettings: { provider: "openai-oauth" },
    getEffectiveDocumentContext: () => ({ freeform: "" }),
    getEffectiveEditorialPreferences: () => ({
        stance: "author-first",
        feedbackDensity: "focused",
        voiceLatitude: "preserve",
    }),
    editorialPreferences: {
        stance: "author-first",
        feedbackDensity: "focused",
        voiceLatitude: "preserve",
    },
    persistEditorialPreferences: vi.fn(),
}));

beforeEach(() => {
    vi.stubGlobal(
        "ResizeObserver",
        class {
            observe() {}
            disconnect() {}
        },
    );
    localStorage.clear();
    mocks.chat.status = "error";
    mocks.sendMessage.mockClear();
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("Chat error recovery", () => {
    it("explains expired authorization and permits another message", async () => {
        const screen = render(Chat, { active: true, session: null });
        expect(screen.getByText(/sign in to ChatGPT again/i)).toBeTruthy();
        const input = screen.getByRole("textbox") as HTMLInputElement;
        expect(input.disabled).toBe(false);
        await fireEvent.input(input, { target: { value: "Try this again" } });
        const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
        expect(send.disabled).toBe(false);
        await fireEvent.submit(input.closest("form")!);
        expect(mocks.sendMessage).toHaveBeenCalledWith("Try this again", {
            task: "assistant",
            requestedActions: ["comment", "suggestion", "revision"],
            responseLength: "balanced",
        });
    });

    it("external chat questions use the same assistant without mode selection", async () => {
        const previous = get(documentContent);
        documentContent.set("A draft to discuss.");
        try {
            const screen = render(Chat, { active: true, session: null });
            expect(mocks.sendMessage).not.toHaveBeenCalled();
            appEventBus.emit({ type: "ai-open-chat", message: "Help me find the right word." });
            const input = screen.getByRole("textbox");
            await fireEvent.submit(input.closest("form")!);
            expect(screen.queryByRole("group", { name: "Writing task" })).toBeNull();
            expect(mocks.sendMessage).toHaveBeenCalledWith("Help me find the right word.", {
                task: "assistant",
                requestedActions: ["comment", "suggestion", "revision"],
                responseLength: "balanced",
            });
        } finally {
            documentContent.set(previous);
        }
    });

    it.each(["submitted", "streaming"])("blocks duplicate sends while %s", async (status) => {
        mocks.chat.status = status;
        const screen = render(Chat, { active: true, session: null });
        const input = screen.getByRole("textbox") as HTMLInputElement;
        expect(input.disabled).toBe(false);
        expect(screen.getByRole("button", { name: "Stop response" })).toBeTruthy();
        await fireEvent.input(input, { target: { value: "Duplicate" } });
        await fireEvent.submit(input.closest("form")!);
        expect(mocks.sendMessage).not.toHaveBeenCalled();
    });
});
