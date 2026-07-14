import {
    PROMPT_CATEGORIES,
    WRITING_PROMPTS,
    chooseWritingPrompt,
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
});
