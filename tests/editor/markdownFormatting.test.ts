import { describe, expect, it } from "vitest";
import { applyMarkdownFormat } from "$lib/editor/markdownFormatting";

describe("applyMarkdownFormat", () => {
    it("wraps a selection in bold markers", () => {
        const result = applyMarkdownFormat("hello world", 0, 5, "bold");
        expect(result.text).toBe("**hello** world");
        expect(result.selection).toEqual({ from: 2, to: 7 });
    });

    it("unwraps bold markers around the selected text", () => {
        const result = applyMarkdownFormat("**hello** world", 2, 7, "bold");
        expect(result.text).toBe("hello world");
        expect(result.selection).toEqual({ from: 0, to: 5 });
    });

    it("unwraps italic markers around the selected text", () => {
        const result = applyMarkdownFormat("_hello_ world", 1, 6, "italic");
        expect(result.text).toBe("hello world");
        expect(result.selection).toEqual({ from: 0, to: 5 });
    });

    it("inserts paired italic markers at the cursor", () => {
        const result = applyMarkdownFormat("hello", 5, 5, "italic");
        expect(result.text).toBe("hello__");
        expect(result.selection).toEqual({ from: 6, to: 6 });
    });

    it("toggles heading prefixes on the active line", () => {
        const applied = applyMarkdownFormat("Title", 0, 0, "heading1");
        expect(applied.text).toBe("# Title");

        const removed = applyMarkdownFormat(applied.text, 0, applied.text.length, "heading1");
        expect(removed.text).toBe("Title");
    });

    it("adds bullet list prefixes to multiple lines", () => {
        const result = applyMarkdownFormat("alpha\nbeta", 0, 10, "bulletList");
        expect(result.text).toBe("- alpha\n- beta");
    });

    it("adds numbered list prefixes sequentially", () => {
        const result = applyMarkdownFormat("alpha\nbeta", 0, 10, "numberedList");
        expect(result.text).toBe("1. alpha\n2. beta");
    });

    it("toggles block quotes off when every line is quoted", () => {
        const result = applyMarkdownFormat("> alpha\n> beta", 0, 14, "blockquote");
        expect(result.text).toBe("alpha\nbeta");
    });
});
