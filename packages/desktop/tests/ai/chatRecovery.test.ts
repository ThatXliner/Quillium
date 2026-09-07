import Chat from "$lib/ai/Chat.svelte";
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
}));

beforeEach(() => {
    mocks.chat.status = "error";
    mocks.sendMessage.mockClear();
});
afterEach(cleanup);

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
        expect(mocks.sendMessage).toHaveBeenCalledWith("Try this again");
    });

    it.each(["submitted", "streaming"])("blocks duplicate sends while %s", async (status) => {
        mocks.chat.status = status;
        const screen = render(Chat, { active: true, session: null });
        const input = screen.getByRole("textbox") as HTMLInputElement;
        expect(input.disabled).toBe(true);
        await fireEvent.input(input, { target: { value: "Duplicate" } });
        await fireEvent.submit(input.closest("form")!);
        expect(mocks.sendMessage).not.toHaveBeenCalled();
    });
});
