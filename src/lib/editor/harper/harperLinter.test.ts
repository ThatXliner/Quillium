import { describe, it, expect } from "vitest";
import { hashText, splitParagraphs, shiftLints, mergeLints } from "./harperLinter";

describe("hashText", () => {
    it("returns a number", () => {
        expect(typeof hashText("hello")).toBe("number");
    });

    it("is deterministic", () => {
        expect(hashText("hello world")).toBe(hashText("hello world"));
    });

    it("produces different hashes for different inputs", () => {
        expect(hashText("foo")).not.toBe(hashText("bar"));
        expect(hashText("paragraph one")).not.toBe(hashText("paragraph two"));
    });

    it("handles empty string", () => {
        expect(typeof hashText("")).toBe("number");
    });

    it("is sensitive to ordering", () => {
        expect(hashText("ab")).not.toBe(hashText("ba"));
    });
});

describe("splitParagraphs", () => {
    it("returns a single paragraph for text with no blank lines", () => {
        const result = splitParagraphs("hello world");
        expect(result).toEqual([{ text: "hello world", offset: 0 }]);
    });

    it("splits on a blank line", () => {
        const result = splitParagraphs("first\n\nsecond");
        expect(result).toEqual([
            { text: "first", offset: 0 },
            { text: "second", offset: 7 },
        ]);
    });

    it("splits on multiple blank lines", () => {
        const result = splitParagraphs("a\n\nb\n\nc");
        expect(result).toHaveLength(3);
        expect(result[0].text).toBe("a");
        expect(result[1].text).toBe("b");
        expect(result[2].text).toBe("c");
    });

    it("offsets are correct for absolute positions", () => {
        const doc = "para one\n\npara two\n\npara three";
        const result = splitParagraphs(doc);
        for (const { text, offset } of result) {
            expect(doc.slice(offset, offset + text.length)).toBe(text);
        }
    });

    it("skips blank-only paragraphs", () => {
        const result = splitParagraphs("\n\n   \n\nhello");
        expect(result).toEqual([{ text: "hello", offset: 7 }]);
    });

    it("returns empty array for blank document", () => {
        expect(splitParagraphs("")).toEqual([]);
        expect(splitParagraphs("   \n\n   ")).toEqual([]);
    });

    it("handles trailing newlines", () => {
        const result = splitParagraphs("hello\n\nworld\n\n");
        expect(result).toHaveLength(2);
    });
});

// Minimal mock lint object for shiftLints/mergeLints tests
function makeLint(start: number, end: number) {
    return {
        span: () => ({ start, end }),
        message: () => "test",
    };
}

describe("shiftLints", () => {
    it("returns lints unchanged when offset is 0", () => {
        const lint = makeLint(5, 10);
        // @ts-expect-error - mock lint object
        const result = shiftLints({ Rule: [lint] }, 0);
        expect(result).toEqual({ Rule: [lint] });
    });

    it("shifts all span positions by offset", () => {
        const lint = makeLint(2, 8);
        // @ts-expect-error - mock lint object
        const result = shiftLints({ Rule: [lint] }, 100);
        expect(result.Rule[0].span()).toEqual({ start: 102, end: 108 });
    });

    it("shifts across multiple linter groups", () => {
        // @ts-expect-error - mock lint object
        const result = shiftLints({ Spelling: [makeLint(0, 3)], Grammar: [makeLint(5, 9)] }, 50);
        expect(result.Spelling[0].span()).toEqual({ start: 50, end: 53 });
        expect(result.Grammar[0].span()).toEqual({ start: 55, end: 59 });
    });

    it("does not mutate the original lint span", () => {
        const lint = makeLint(1, 5);
        // @ts-expect-error - mock lint object
        shiftLints({ Rule: [lint] }, 10);
        expect(lint.span()).toEqual({ start: 1, end: 5 });
    });
});

describe("mergeLints", () => {
    it("merges results from multiple groups", () => {
        // @ts-expect-error - mock lint object
        const a = { Spelling: [makeLint(0, 3)] };
        // @ts-expect-error - mock lint object
        const b = { Grammar: [makeLint(10, 15)] };
        const result = mergeLints(a, b);
        expect(Object.keys(result)).toContain("Spelling");
        expect(Object.keys(result)).toContain("Grammar");
    });

    it("concatenates lints under the same group key", () => {
        // @ts-expect-error - mock lint object
        const a = { Spelling: [makeLint(0, 3)] };
        // @ts-expect-error - mock lint object
        const b = { Spelling: [makeLint(10, 15)] };
        const result = mergeLints(a, b);
        expect(result.Spelling).toHaveLength(2);
    });

    it("returns empty object when given no results", () => {
        expect(mergeLints()).toEqual({});
    });
});
