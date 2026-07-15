import {
    PROMPT_CATEGORIES,
    WRITING_PROMPTS,
    chooseWritingPrompt,
    formatPromptInsertion,
    promptsInCategory,
} from "$lib/writingPrompts/prompts";
import { describe, expect, it } from "vitest";

describe("writing prompts", () => {
    it("provides multiple prompts in every category", () => {
        for (const category of PROMPT_CATEGORIES) {
            expect(promptsInCategory(category).length).toBeGreaterThanOrEqual(5);
        }
    });

    it("selects only from the requested category", () => {
        expect(chooseWritingPrompt("Dialogue", undefined, () => 0).category).toBe("Dialogue");
        expect(chooseWritingPrompt("Setting", undefined, () => 0.99).category).toBe("Setting");
    });

    it("does not immediately repeat a prompt when alternatives exist", () => {
        const first = promptsInCategory("Character")[0];
        const next = chooseWritingPrompt("Character", first.id, () => 0);

        expect(next.id).not.toBe(first.id);
    });

    it("clamps an injected random value at the end of the library", () => {
        expect(chooseWritingPrompt(null, undefined, () => 1)).toEqual(WRITING_PROMPTS.at(-1));
    });

    it("separates a prompt from prose at the cursor", () => {
        const insertion = formatPromptInsertion("Opening paragraph.", 18, 18, "Keep writing.");

        expect(insertion).toEqual({ text: "\n\nKeep writing.", cursorOffset: 15 });
    });

    it("preserves an existing blank-line boundary", () => {
        const insertion = formatPromptInsertion("Before\n\nAfter", 8, 8, "Prompt");

        expect(insertion).toEqual({ text: "Prompt\n\n", cursorOffset: 6 });
    });
});
