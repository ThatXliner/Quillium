import { describe, expect, it } from "vitest";
import {
    hasIdenticalPreviousVersion,
    hasIdenticalTextContent,
    markdownTextContent,
} from "../src/versionComparison";

describe("revision version text comparison", () => {
    it("ignores Markdown formatting and structural markers", () => {
        expect(
            hasIdenticalTextContent(
                "# **A title**\n\n> Read [this sentence](https://example.com).",
                "A title\n\nRead this sentence.",
            ),
        ).toBe(true);
    });

    it("supports GFM formatting", () => {
        expect(hasIdenticalTextContent("~~Keep~~ this", "Keep this")).toBe(true);
    });

    it("preserves meaningful text changes", () => {
        expect(hasIdenticalTextContent("The **first** draft", "The second draft")).toBe(false);
    });

    it("normalizes whitespace after removing Markdown", () => {
        expect(markdownTextContent("- One\n- Two")).toBe("One Two");
    });

    it("only warns when the active version matches its immediate predecessor", () => {
        const versions = ["First", "**First**", "Third"];

        expect(hasIdenticalPreviousVersion(versions, 0)).toBe(false);
        expect(hasIdenticalPreviousVersion(versions, 1)).toBe(true);
        expect(hasIdenticalPreviousVersion(versions, 2)).toBe(false);
    });
});
