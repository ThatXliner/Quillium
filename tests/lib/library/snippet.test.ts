import { HL_END, HL_START, snippetSegments } from "$lib/library/snippet";
import { describe, expect, it } from "vitest";

describe("snippetSegments", () => {
    it("splits balanced highlight sentinels into renderable segments", () => {
        expect(snippetSegments(`The ${HL_START}quick${HL_END} fox`)).toEqual([
            { text: "The ", highlighted: false },
            { text: "quick", highlighted: true },
            { text: " fox", highlighted: false },
        ]);
    });

    it("supports multiple highlighted ranges", () => {
        expect(snippetSegments(`${HL_START}alpha${HL_END} beta ${HL_START}gamma${HL_END}`)).toEqual(
            [
                { text: "alpha", highlighted: true },
                { text: " beta ", highlighted: false },
                { text: "gamma", highlighted: true },
            ],
        );
    });

    it("strips stray sentinels from plain text", () => {
        expect(snippetSegments(`before ${HL_START}broken ${HL_END}after${HL_END}`)).toEqual([
            { text: "before ", highlighted: false },
            { text: "broken ", highlighted: true },
            { text: "after", highlighted: false },
        ]);
        expect(snippetSegments(`before ${HL_START}broken`)).toEqual([
            { text: "before ", highlighted: false },
            { text: "broken", highlighted: false },
        ]);
        expect(snippetSegments(`before${HL_END} after`)).toEqual([
            { text: "before after", highlighted: false },
        ]);
    });

    it("omits empty segments", () => {
        expect(snippetSegments(`${HL_START}${HL_END}plain`)).toEqual([
            { text: "plain", highlighted: false },
        ]);
        expect(snippetSegments("")).toEqual([]);
    });
});
