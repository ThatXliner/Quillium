/** reviewSchema.test.ts — Provider-response compatibility tests for AutoAI. */

import { AutoAIReviewSchema, normalizeAutoAIReview } from "$lib/autoai/reviewSchema";
import { describe, expect, it } from "vitest";

describe("AutoAI review normalization", () => {
    it("accepts canonical annotations without requiring fields from other variants", () => {
        const result = AutoAIReviewSchema.parse({
            annotations: [
                { type: "comment", targetText: "one", comment: "Note" },
                {
                    type: "suggestion",
                    targetText: "two",
                    replacement: "second",
                    rationale: "Clearer",
                },
            ],
        });

        expect(normalizeAutoAIReview(result)).toHaveLength(2);
    });

    it("normalizes field aliases observed in provider responses", () => {
        const result = AutoAIReviewSchema.parse({
            annotations: [
                {
                    type: "suggestion",
                    targetText: "change of pace",
                    suggestedReplacement: "new direction",
                    explanation: "Less clichéd",
                },
                {
                    type: "revision",
                    targetText: "Title in hand",
                    label: "Clarify transition",
                    explanation: "Clarify what title means",
                    revisions: ["Newly appointed, I crashed.", "My first outing ended in a crash."],
                },
            ],
        });

        expect(normalizeAutoAIReview(result)).toEqual([
            {
                type: "suggestion",
                targetText: "change of pace",
                replacement: "new direction",
                rationale: "Less clichéd",
            },
            {
                type: "revision",
                targetText: "Title in hand",
                threadMessage: "Clarify what title means",
                versions: [
                    { label: "Clarify transition 1", text: "Newly appointed, I crashed." },
                    {
                        label: "Clarify transition 2",
                        text: "My first outing ended in a crash.",
                    },
                ],
            },
        ]);
    });

    it("drops one malformed annotation without losing valid siblings", () => {
        const result = AutoAIReviewSchema.parse({
            annotations: [
                { type: "suggestion", targetText: "bad", explanation: "Missing replacement" },
                { type: "comment", targetText: "good", comment: "Useful note" },
            ],
        });

        expect(normalizeAutoAIReview(result)).toEqual([
            { type: "comment", targetText: "good", comment: "Useful note" },
        ]);
    });
});
