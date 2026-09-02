import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
    clearAiConversation,
    isPersistentConversationMode,
    loadAiConversation,
    saveAiConversation,
} from "$lib/ai/persistence";

describe("AI persistence", () => {
    beforeEach(() => {
        invoke.mockReset();
    });

    it("recognizes only draft conversation modes", () => {
        expect(isPersistentConversationMode("chat")).toBe(true);
        expect(isPersistentConversationMode("feedback")).toBe(true);
        expect(isPersistentConversationMode("revise")).toBe(true);
        expect(isPersistentConversationMode("dictionary")).toBe(false);
    });

    it("loads and validates stored UI messages", async () => {
        const messages = [{ id: "m1", role: "user", parts: [{ type: "text", text: "Hi" }] }];
        invoke.mockResolvedValueOnce(JSON.stringify(messages));

        await expect(loadAiConversation("draft-1", "chat")).resolves.toEqual(messages);
        expect(invoke).toHaveBeenCalledWith("cmd_load_ai_conversation", {
            draftId: "draft-1",
            mode: "chat",
        });
    });

    it("ignores malformed or invalid stored messages", async () => {
        const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
        invoke.mockResolvedValueOnce("not json").mockResolvedValueOnce('[{"role":"user"}]');

        await expect(loadAiConversation("draft-1", "chat")).resolves.toEqual([]);
        await expect(loadAiConversation("draft-1", "chat")).resolves.toEqual([]);
        expect(warning).toHaveBeenCalledTimes(2);
        warning.mockRestore();
    });

    it("saves message JSON and deletes an empty conversation", async () => {
        const messages = [
            {
                id: "m1",
                role: "assistant" as const,
                parts: [{ type: "text" as const, text: "Hi" }],
            },
        ];
        invoke.mockResolvedValue(undefined);

        await saveAiConversation("draft-1", "feedback", messages);
        expect(invoke).toHaveBeenNthCalledWith(1, "cmd_save_ai_conversation", {
            draftId: "draft-1",
            mode: "feedback",
            messagesJson: JSON.stringify(messages),
        });

        await saveAiConversation("draft-1", "feedback", []);
        expect(invoke).toHaveBeenNthCalledWith(2, "cmd_clear_ai_conversation", {
            draftId: "draft-1",
            mode: "feedback",
        });
    });

    it("clears one stored mode", async () => {
        invoke.mockResolvedValue(undefined);

        await clearAiConversation("draft-1", "revise");

        expect(invoke).toHaveBeenCalledWith("cmd_clear_ai_conversation", {
            draftId: "draft-1",
            mode: "revise",
        });
    });
});
