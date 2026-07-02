import type { Chattiness, ReaderPersona } from "$lib/readers/presets";
import { buildPersonaPrompt } from "$lib/readers/prompt";
import { describe, expect, it } from "vitest";

function persona(overrides: Partial<ReaderPersona> = {}): ReaderPersona {
    return {
        id: "line-editor",
        name: "Line Editor",
        emoji: "",
        color: "#336699",
        description: "Checks sentences.",
        instruction: "checks sentence rhythm",
        builtin: true,
        enabled: true,
        chattiness: "normal",
        ...overrides,
    };
}

describe("buildPersonaPrompt", () => {
    it("builds an identity block from the persona name and instruction", () => {
        const prompt = buildPersonaPrompt(persona());

        expect(prompt).toContain("You are the Line Editor, a reader who checks sentence rhythm.");
        expect(prompt).toContain("your feedback reflects this lens");
    });

    it("trims instructions and preserves terminal punctuation", () => {
        expect(buildPersonaPrompt(persona({ instruction: "  looks for rhythm!  " }))).toContain(
            "reader who looks for rhythm!",
        );
    });

    it.each([
        ["quiet", "Only comment if you genuinely have something worth saying"],
        ["normal", "Comment on issues worth the writer's attention"],
        ["verbose", "Be thorough"],
    ] satisfies Array<[Chattiness, string]>)(
        "includes the %s chattiness directive",
        (chattiness, expected) => {
            expect(buildPersonaPrompt(persona({ chattiness }))).toContain(expected);
        },
    );

    it("leaves a blank line after the directive for concatenating mode prompts", () => {
        expect(buildPersonaPrompt(persona()).endsWith("\n\n")).toBe(true);
    });
});
