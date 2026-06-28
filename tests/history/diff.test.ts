import { type DiffSegment, docTextFromStateJson, wordDiff } from "$lib/editor/history/diff";
import { describe, expect, it } from "vitest";

const types = (segs: DiffSegment[]) => segs.map((s) => s.type);
const text = (segs: DiffSegment[], type: DiffSegment["type"]) =>
    segs
        .filter((s) => s.type === type)
        .map((s) => s.text)
        .join("");

describe("docTextFromStateJson", () => {
    it("reads a string doc", () => {
        expect(docTextFromStateJson(JSON.stringify({ doc: "hello world" }))).toBe("hello world");
    });

    it("joins an array-of-lines doc with newlines", () => {
        expect(docTextFromStateJson(JSON.stringify({ doc: ["a", "b"] }))).toBe("a\nb");
    });

    it("returns empty for null / empty / garbage", () => {
        expect(docTextFromStateJson(null)).toBe("");
        expect(docTextFromStateJson("{}")).toBe("");
        expect(docTextFromStateJson("not json")).toBe("");
    });
});

describe("wordDiff", () => {
    it("marks everything added when before is empty", () => {
        const segs = wordDiff("", "hello there");
        expect(types(segs)).toEqual(["add"]);
        expect(text(segs, "add")).toBe("hello there");
    });

    it("marks everything removed when after is empty", () => {
        const segs = wordDiff("hello there", "");
        expect(types(segs)).toEqual(["del"]);
        expect(text(segs, "del")).toBe("hello there");
    });

    it("keeps identical text as a single same segment", () => {
        const segs = wordDiff("the quick fox", "the quick fox");
        expect(types(segs)).toEqual(["same"]);
    });

    it("highlights an inserted word", () => {
        const segs = wordDiff("the fox", "the quick fox");
        // "the " unchanged, "quick " added, "fox" unchanged.
        expect(text(segs, "add")).toContain("quick");
        expect(text(segs, "same")).toContain("the");
        expect(text(segs, "same")).toContain("fox");
        expect(text(segs, "del")).toBe("");
    });

    it("highlights a deleted word", () => {
        const segs = wordDiff("the quick fox", "the fox");
        expect(text(segs, "del")).toContain("quick");
        expect(text(segs, "add")).toBe("");
    });

    it("represents a replacement as del + add", () => {
        const segs = wordDiff("hello world", "hello there");
        expect(text(segs, "del")).toContain("world");
        expect(text(segs, "add")).toContain("there");
        expect(text(segs, "same")).toContain("hello");
    });

    it("reconstructs `after` from same+add and `before` from same+del", () => {
        const before = "alpha beta gamma";
        const after = "alpha GAMMA delta";
        const segs = wordDiff(before, after);
        const rebuiltAfter = segs
            .filter((s) => s.type !== "del")
            .map((s) => s.text)
            .join("");
        const rebuiltBefore = segs
            .filter((s) => s.type !== "add")
            .map((s) => s.text)
            .join("");
        expect(rebuiltAfter).toBe(after);
        expect(rebuiltBefore).toBe(before);
    });

    it("preserves newlines across edits", () => {
        const segs = wordDiff("line one\nline two", "line one\nline 2");
        const rebuiltAfter = segs
            .filter((s) => s.type !== "del")
            .map((s) => s.text)
            .join("");
        expect(rebuiltAfter).toBe("line one\nline 2");
    });

    it("falls back instead of allocating a huge LCS table", () => {
        const before = Array.from({ length: 1100 }, (_, i) => `before${i}`).join(" ");
        const after = Array.from({ length: 1100 }, (_, i) => `after${i}`).join(" ");
        expect(wordDiff(before, after)).toEqual([{ type: "same", text: after }]);
    });
});
