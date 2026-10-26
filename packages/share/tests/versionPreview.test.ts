import { describe, expect, it } from "vitest";
import { VERSION_PREVIEW_MAX_LENGTH, formatVersionPreviewText } from "../src/versionPreview";

describe("formatVersionPreviewText", () => {
    it("flattens and trims whitespace", () => {
        expect(formatVersionPreviewText("  First\n\t second   line  ")).toBe("First second line");
    });

    it("uses the canonical empty label", () => {
        expect(formatVersionPreviewText(undefined)).toBe("(empty)");
        expect(formatVersionPreviewText(" \n\t ")).toBe("(empty)");
    });

    it("keeps text at the default boundary without an ellipsis", () => {
        const text = "a".repeat(VERSION_PREVIEW_MAX_LENGTH);
        expect(formatVersionPreviewText(text)).toBe(text);
    });

    it("truncates text beyond the default boundary with an ellipsis", () => {
        const prefix = "a".repeat(VERSION_PREVIEW_MAX_LENGTH);
        expect(formatVersionPreviewText(`${prefix}b`)).toBe(`${prefix}…`);
    });

    it("honors a caller-provided boundary", () => {
        expect(formatVersionPreviewText("abcdef", 5)).toBe("abcde…");
        expect(formatVersionPreviewText("abcde", 5)).toBe("abcde");
    });
});
