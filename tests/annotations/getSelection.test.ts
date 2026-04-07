import { describe, it, expect, vi } from "vitest";
import { Text } from "@codemirror/state";
import { getSelection } from "$lib/editor/plugins/annotations";

vi.mock("$lib/posthog", () => ({ default: { capture: vi.fn() } }));

const doc = Text.of([
    "The quick brown fox jumps over the lazy dog.",
    "She said something... and then left the room.",
    "This is a test of the emergency broadcast system.",
]);

describe("getSelection", () => {
    it("finds exact targetText in the document", () => {
        const sel = getSelection({ targetText: "brown fox", document: doc });
        expect(doc.sliceString(sel.main.from, sel.main.to)).toBe("brown fox");
    });

    it("finds targetText disambiguated by context", () => {
        const twoThe = Text.of(["the cat sat on the mat"]);
        const sel = getSelection({
            targetText: "the",
            context: "on the mat",
            document: twoThe,
        });
        expect(sel.main.from).toBe(15);
    });

    it("throws when targetText is not found", () => {
        expect(() => getSelection({ targetText: "nonexistent phrase", document: doc })).toThrow(
            "Target text not found in document",
        );
    });

    it("throws when neither targetText nor editorSelection provided", () => {
        expect(() => getSelection({ document: doc })).toThrow(
            "Must specify at least either targetText or editorSelection",
        );
    });

    // ── Ellipsis stripping ──────────────────────────────────────────────

    it("strips trailing three-dot ellipsis and finds the prefix", () => {
        const sel = getSelection({ targetText: "brown fox...", document: doc });
        expect(doc.sliceString(sel.main.from, sel.main.to)).toBe("brown fox");
    });

    it("strips trailing unicode ellipsis and finds the prefix", () => {
        const sel = getSelection({ targetText: "brown fox\u2026", document: doc });
        expect(doc.sliceString(sel.main.from, sel.main.to)).toBe("brown fox");
    });

    it("strips ellipsis with leading space", () => {
        const sel = getSelection({ targetText: "brown fox ...", document: doc });
        expect(doc.sliceString(sel.main.from, sel.main.to)).toBe("brown fox");
    });

    it("preserves ellipsis that actually exists in the document", () => {
        // "something..." is literally in the doc on line 2
        const sel = getSelection({ targetText: "something...", document: doc });
        expect(doc.sliceString(sel.main.from, sel.main.to)).toBe("something...");
    });

    it("strips ellipsis from context too", () => {
        const sel = getSelection({
            targetText: "emergency...",
            context: "test of the emergency broadcast...",
            document: doc,
        });
        expect(doc.sliceString(sel.main.from, sel.main.to)).toBe("emergency");
    });
});
