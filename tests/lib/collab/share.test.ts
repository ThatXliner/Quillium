import { buildReadonlyShareUrl, buildSharePreviewText } from "$lib/collab/share";
import { buildShareFingerprint } from "$lib/collab/sharePayload";
import { describe, expect, it } from "vitest";

describe("buildReadonlyShareUrl", () => {
    it("builds the public share URL", () => {
        expect(buildReadonlyShareUrl("abc-123")).toBe("https://quillium.bryanhu.com/share/abc-123");
    });
});

describe("buildSharePreviewText", () => {
    it("collapses repeated whitespace", () => {
        expect(buildSharePreviewText("Hello\n\nworld   again", 40)).toBe("Hello world again");
    });

    it("truncates long previews with an ellipsis", () => {
        expect(buildSharePreviewText("abcdefghijklmnopqrstuvwxyz", 10)).toBe("abcdefghi…");
    });
});

describe("buildShareFingerprint", () => {
    it("changes when annotations change", () => {
        expect(buildShareFingerprint("Doc", "hello", [])).not.toBe(
            buildShareFingerprint("Doc", "hello", [
                {
                    id: 1,
                    type: "comment",
                    from: 0,
                    to: 5,
                    selectedText: "hello",
                    thread: [],
                },
            ]),
        );
    });

    it("stays stable when annotation object keys are reordered", () => {
        const localShape = [
            {
                id: 1,
                type: "suggestion",
                from: 0,
                to: 5,
                selectedText: "hello",
                thread: [{ message: "Try this", author: "A", time: 1 }],
                replacements: [{ text: "hi", rationale: "shorter" }],
                author: "A",
            },
        ];

        const roundTrippedShape = [
            {
                author: "A",
                from: 0,
                id: 1,
                replacements: [{ rationale: "shorter", text: "hi" }],
                selectedText: "hello",
                thread: [{ author: "A", message: "Try this", time: 1 }],
                to: 5,
                type: "suggestion",
            },
        ];

        expect(buildShareFingerprint("Doc", "hello", localShape as never[])).toBe(
            buildShareFingerprint("Doc", "hello", roundTrippedShape as never[]),
        );
    });
});
