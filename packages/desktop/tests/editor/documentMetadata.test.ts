import { documentMetadata, titleForDocument } from "$lib/editor/documentMetadata";
import { describe, expect, it } from "vitest";

describe("document metadata", () => {
    it.each([
        ["Untitled", "One two three", "Untitled"],
        ["Untitled", "One two three four", "One two three four"],
        ["Untitled", "  First line  \nBody", "First line"],
        ["Untitled", "\nBody", "Untitled"],
        ["Chosen title", "A new first line\nBody", "Chosen title"],
        ["Untitled", `${"x".repeat(50)}\nBody`, "x".repeat(40)],
    ])("derives %s from %j as %s", (title, text, expected) => {
        expect(titleForDocument(title, text)).toBe(expected);
    });

    it("counts whitespace-separated words and limits the preview to 200 characters", () => {
        expect(documentMetadata(" \n\t")).toEqual({ wordCount: 0, previewText: " \n\t" });
        const text = "one two\n".repeat(30);
        expect(documentMetadata(text)).toEqual({ wordCount: 60, previewText: text.slice(0, 200) });
    });
});
