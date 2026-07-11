import { describe, expect, it } from "vitest";
import { tokenize, wordDiff } from "../src/diff";

describe("shared word diff", () => {
    it("preserves whitespace while tokenizing", () => {
        expect(tokenize("one\n two")).toEqual(["one", "\n ", "two"]);
    });

    it("describes a prose replacement", () => {
        expect(wordDiff("the brown fox", "the russet fox")).toEqual([
            { type: "equal", text: "the " },
            { type: "delete", text: "brown" },
            { type: "insert", text: "russet" },
            { type: "equal", text: " fox" },
        ]);
    });

    it("reconstructs both inputs from its operations", () => {
        const before = "line one\nline two";
        const after = "line 1\nline two!";
        const operations = wordDiff(before, after);
        expect(
            operations
                .filter((operation) => operation.type !== "insert")
                .map((operation) => operation.text)
                .join(""),
        ).toBe(before);
        expect(
            operations
                .filter((operation) => operation.type !== "delete")
                .map((operation) => operation.text)
                .join(""),
        ).toBe(after);
    });
});
