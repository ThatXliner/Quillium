import { computeStats } from "$lib/stats/compute";
import { describe, expect, it } from "vitest";

describe("computeStats", () => {
    it("returns zeroed metrics for empty documents", () => {
        expect(computeStats("")).toEqual({
            words: 0,
            chars: 0,
            sentences: 0,
            paragraphs: 0,
            readingTimeMinutes: 0,
            avgSentenceLength: 0,
            avgWordLength: 0,
            vocabularyDiversity: 0,
            readabilityGrade: 0,
        });
    });

    it("computes writing metrics for plain prose", () => {
        const text = "Hello world. This test is simple!\n\nHello again?";

        expect(computeStats(text)).toEqual({
            words: 8,
            chars: text.length,
            sentences: 3,
            paragraphs: 2,
            readingTimeMinutes: 0,
            avgSentenceLength: 2.7,
            avgWordLength: 4.9,
            vocabularyDiversity: 88,
            readabilityGrade: 2,
        });
    });

    it("counts a single non-empty block as one paragraph even without punctuation", () => {
        expect(computeStats("One line\nstill one paragraph")).toMatchObject({
            words: 5,
            sentences: 1,
            paragraphs: 1,
        });
    });
});
