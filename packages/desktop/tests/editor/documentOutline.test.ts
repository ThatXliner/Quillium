import { describe, expect, it } from "vitest";
import { getDocumentOutline } from "$lib/editor/documentOutline";

describe("document outline", () => {
    it("keeps heading hierarchy and exact positions, including duplicate labels", () => {
        const doc = "# Start\n\n## Part\n\n###### Detail\n\n## Part";
        expect(getDocumentOutline(doc)).toEqual([
            { from: 0, level: 1, label: "Start" },
            { from: doc.indexOf("## Part"), level: 2, label: "Part" },
            { from: doc.indexOf("######"), level: 6, label: "Detail" },
            { from: doc.lastIndexOf("## Part"), level: 2, label: "Part" },
        ]);
    });

    it("recognizes setext headings and removes heading and inline formatting marks", () => {
        expect(getDocumentOutline("Title\n=====\n\n## **Bold** and `code` ##")).toEqual([
            { from: 0, level: 1, label: "Title" },
            { from: 13, level: 2, label: "Bold and code" },
        ]);
    });

    it("uses a link’s label without its destination", () => {
        expect(getDocumentOutline("# [Chapter](https://example.com)")).toEqual([
            { from: 0, level: 1, label: "Chapter" },
        ]);
    });

    it("ignores code blocks, escaped headings, and ordinary prose", () => {
        expect(getDocumentOutline("```\n# Code\n```\n\n    # Indented code\n\n\\# Escaped\n\nProse")).toEqual([]);
    });

    it("updates positions after edits and drops removed headings", () => {
        expect(getDocumentOutline("Intro\n\n# Heading")).toEqual([
            { from: 7, level: 1, label: "Heading" },
        ]);
        expect(getDocumentOutline("Intro\n\nHeading")).toEqual([]);
    });
});
