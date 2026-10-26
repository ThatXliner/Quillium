import { type DiffOp, wordDiff } from "$lib/editor/diff";
import { docTextFromStateJson } from "$lib/editor/history/diff";
import { describe, expect, it } from "vitest";

const types = (segs: DiffOp[]) => segs.map((s) => s.type);
const text = (segs: DiffOp[], type: DiffOp["type"]) =>
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
        expect(types(segs)).toEqual(["insert"]);
        expect(text(segs, "insert")).toBe("hello there");
    });

    it("marks everything removed when after is empty", () => {
        const segs = wordDiff("hello there", "");
        expect(types(segs)).toEqual(["delete"]);
        expect(text(segs, "delete")).toBe("hello there");
    });

    it("keeps identical text as a single equal segment", () => {
        const segs = wordDiff("the quick fox", "the quick fox");
        expect(types(segs)).toEqual(["equal"]);
    });

    it("highlights an inserted word", () => {
        const segs = wordDiff("the fox", "the quick fox");
        // "the " unchanged, "quick " added, "fox" unchanged.
        expect(text(segs, "insert")).toContain("quick");
        expect(text(segs, "equal")).toContain("the");
        expect(text(segs, "equal")).toContain("fox");
        expect(text(segs, "delete")).toBe("");
    });

    it("highlights a deleted word", () => {
        const segs = wordDiff("the quick fox", "the fox");
        expect(text(segs, "delete")).toContain("quick");
        expect(text(segs, "insert")).toBe("");
    });

    it("represents a replacement as delete + insert", () => {
        const segs = wordDiff("hello world", "hello there");
        expect(text(segs, "delete")).toContain("world");
        expect(text(segs, "insert")).toContain("there");
        expect(text(segs, "equal")).toContain("hello");
    });

    it("reconstructs `after` from equal+insert and `before` from equal+delete", () => {
        const before = "alpha beta gamma";
        const after = "alpha GAMMA delta";
        const segs = wordDiff(before, after);
        const rebuiltAfter = segs
            .filter((s) => s.type !== "delete")
            .map((s) => s.text)
            .join("");
        const rebuiltBefore = segs
            .filter((s) => s.type !== "insert")
            .map((s) => s.text)
            .join("");
        expect(rebuiltAfter).toBe(after);
        expect(rebuiltBefore).toBe(before);
    });

    it("preserves newlines across edits", () => {
        const segs = wordDiff("line one\nline two", "line one\nline 2");
        const rebuiltAfter = segs
            .filter((s) => s.type !== "delete")
            .map((s) => s.text)
            .join("");
        expect(rebuiltAfter).toBe("line one\nline 2");
    });

    it("diffs a small edit in a long document (prefix/suffix trimming)", () => {
        // Far beyond the raw LCS cap — but only one word changed, so the
        // trimmed middle is tiny and the diff must still be word-precise.
        const words = Array.from({ length: 5000 }, (_, i) => `word${i}`);
        const before = words.join(" ");
        const changed = [...words];
        changed[2500] = "CHANGED";
        const after = changed.join(" ");

        const segs = wordDiff(before, after);

        expect(text(segs, "delete")).toBe("word2500");
        expect(text(segs, "insert")).toBe("CHANGED");
        const rebuiltAfter = segs
            .filter((s) => s.type !== "delete")
            .map((s) => s.text)
            .join("");
        expect(rebuiltAfter).toBe(after);
    });

    it("represents a wholesale rewrite as one delete+insert, never as unchanged", () => {
        // Middle exceeds the LCS cap with no common prefix/suffix: the
        // fallback must still show "replaced", not silently render the new
        // text as if nothing changed.
        const before = Array.from({ length: 1100 }, (_, i) => `before${i}`).join(" ");
        const after = Array.from({ length: 1100 }, (_, i) => `after${i}`).join(" ");

        const segs = wordDiff(before, after);

        expect(text(segs, "delete")).toBe(before);
        expect(text(segs, "insert")).toBe(after);
        expect(text(segs, "equal")).toBe("");
    });
});
