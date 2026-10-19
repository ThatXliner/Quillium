/** reviewSchema.test.ts — Provider-response compatibility tests for AutoAI. */

import { AutoAIReviewSchema, normalizeAutoAIReview } from "$lib/autoai/reviewSchema";
import { describe, expect, it } from "vitest";

describe("AutoAI review normalization", () => {
    it("retains proposed cuts and exact whitespace in replacement text", () => {
        const result = normalizeAutoAIReview(
            AutoAIReviewSchema.parse({
                annotations: [
                    {
                        type: "suggestion",
                        targetText: "really ",
                        replacement: "",
                        rationale: "Cut filler",
                    },
                    {
                        type: "revision",
                        targetText: "very ",
                        versionText: "",
                        threadMessage: "Cut filler",
                    },
                    {
                        type: "revision",
                        targetText: "word",
                        versionText: " word ",
                        threadMessage: "Keep spacing",
                        scope: "whole-passage",
                    },
                ],
            }),
        );
        expect(result).toEqual([
            { type: "suggestion", targetText: "really ", replacement: "", rationale: "Cut filler" },
            {
                type: "revision",
                targetText: "very ",
                versions: [{ label: "Alternative", text: "" }],
                threadMessage: "Cut filler",
            },
            {
                type: "revision",
                targetText: "word",
                versions: [{ label: "Alternative", text: " word " }],
                threadMessage: "Keep spacing",
                scope: "whole-passage",
            },
        ]);
    });
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

it("prefers nonempty aliases over unused blank fields without trimming wording", () => {
    const result = normalizeAutoAIReview(
        AutoAIReviewSchema.parse({
            annotations: [
                {
                    type: "suggestion",
                    targetText: "old",
                    replacement: "",
                    suggestedReplacement: " new ",
                    rationale: "Clearer",
                },
                {
                    type: "revision",
                    targetText: "old",
                    versionText: "",
                    revisions: [" one ", "two"],
                    threadMessage: "Alternatives",
                },
            ],
        }),
    );
    expect(result).toMatchObject([
        { replacement: " new " },
        { versions: [{ text: " one " }, { text: "two" }] },
    ]);
});
