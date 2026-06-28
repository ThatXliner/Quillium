import { normalizeTag, parseTags, serializeTags } from "$lib/library/tags";
import { describe, expect, it } from "vitest";

describe("library tag helpers", () => {
    it("normalizes whitespace and enforces the tag length cap", () => {
        expect(normalizeTag("  draft   ideas  ")).toBe("draft ideas");
        expect(normalizeTag("x".repeat(40))).toBe("x".repeat(32));
    });

    it("parses valid JSON arrays and ignores invalid entries", () => {
        expect(
            parseTags(JSON.stringify([" draft ", 17, "two   words", "", "x".repeat(40)])),
        ).toEqual(["draft", "two words", "x".repeat(32)]);
    });

    it("returns an empty list for absent, malformed, or non-array values", () => {
        expect(parseTags(null)).toEqual([]);
        expect(parseTags(undefined)).toEqual([]);
        expect(parseTags("{bad json")).toEqual([]);
        expect(parseTags(JSON.stringify({ tag: "draft" }))).toEqual([]);
    });

    it("serializes normalized tags and removes duplicates case-insensitively", () => {
        expect(serializeTags([" Draft ", "draft", "two   words", "", "TWO WORDS"])).toBe(
            JSON.stringify(["Draft", "two words"]),
        );
    });
});
