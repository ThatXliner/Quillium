import { sanitizeOutboundMessages } from "$lib/ai/conversationController.svelte";
import {
    MAX_REVIEW_PASSAGES,
    parsePassageReviewResult,
    passageReviewLegend,
    validatePassageReview,
} from "$lib/ai/passageReview";
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

const input = {
    summary: "Protect the opening and shorten the middle.",
    passages: [
        { passage: "A quiet opening.", category: "keep", reason: "Establishes the scene." },
        { passage: "A repeated point.", category: "cut", reason: "Already established." },
    ],
};
const sourceText = "A quiet opening. A repeated point. A closing image.";
const complete = validatePassageReview({ input, sourceText, scope: "draft" });

describe("captured passage reviews", () => {
    it("accepts exact ordered quotes and derives a subset legend", () => {
        expect(complete.status).toBe("complete");
        if (complete.status !== "complete") throw new Error("Expected completed review");
        expect(
            passageReviewLegend(complete.review).map(({ category, count }) => [category.id, count]),
        ).toEqual([
            ["keep", 1],
            ["cut", 1],
        ]);
        expect(parsePassageReviewResult(complete)).toEqual(complete);
    });

    it.each([
        ["invented text", ["An invented scene."]],
        ["reverse order", ["A closing image.", "A quiet opening."]],
        ["overlap", ["A quiet opening.", "opening."]],
        ["duplicated mark", ["A quiet opening.", "A quiet opening."]],
    ])("rejects %s without a partial review", (_name, quotes) => {
        const result = validatePassageReview({
            input: {
                passages: quotes.map((passage) => ({ passage, category: "keep", reason: "x" })),
            },
            sourceText,
            scope: "draft",
        });
        expect(result).toEqual({ status: "invalid", reason: "source-mismatch" });
    });

    it("limits quotes to the captured selection", () => {
        expect(
            validatePassageReview({ input, sourceText: "A quiet opening.", scope: "selection" }),
        ).toEqual({ status: "invalid", reason: "source-mismatch" });
    });

    it("accepts repeated source sentences in their distinct source positions", () => {
        const item = { passage: "Again.", category: "condense", reason: "Repetition." };
        expect(
            validatePassageReview({
                input: { passages: [item, item] },
                sourceText: "Again. Again.",
                scope: "selection",
            }).status,
        ).toBe("complete");
    });

    it.each([
        { passages: [] },
        { passages: [{ passage: "   ", category: "keep", reason: "x" }] },
        { passages: [{ passage: "A quiet opening.", category: "polish", reason: "x" }] },
        { passages: [{ passage: "A quiet opening.", category: "keep", reason: " " }] },
        { ...input, summary: "x".repeat(1001) },
        { passages: [{ passage: "x".repeat(10001), category: "keep", reason: "x" }] },
        { passages: [{ passage: "A quiet opening.", category: "keep", reason: "x".repeat(2001) }] },
        { passages: Array.from({ length: MAX_REVIEW_PASSAGES + 1 }, () => input.passages[0]) },
    ])("rejects malformed or oversized payloads", (value) => {
        expect(validatePassageReview({ input: value, sourceText, scope: "draft" })).toEqual({
            status: "invalid",
            reason: "invalid-payload",
        });
    });

    it("preserves quote whitespace verbatim", () => {
        const passage = " A quiet opening. ";
        const result = validatePassageReview({
            input: { passages: [{ passage, category: "keep", reason: "x" }] },
            sourceText: passage,
            scope: "selection",
        });
        expect(result.status === "complete" && result.review.passages[0].passage).toBe(passage);
    });
});

describe("review history", () => {
    it("sends only completed validated results as historical text", () => {
        const messages: UIMessage[] = [
            {
                id: "assistant",
                role: "assistant",
                parts: [
                    {
                        type: "tool-reviewPassages",
                        toolCallId: "review",
                        state: "output-available",
                        input: {
                            passages: [
                                {
                                    passage: "Never display raw input",
                                    category: "cut",
                                    reason: "x",
                                },
                            ],
                        },
                        output: complete,
                    },
                ],
            },
        ];
        const outbound = sanitizeOutboundMessages(messages);
        expect(outbound).toHaveLength(1);
        const text = outbound[0].parts[0];
        expect(text.type === "text" && text.text).toContain("Earlier passage review shown");
        expect(text.type === "text" && text.text).toContain("A quiet opening.");
        expect(text.type === "text" && text.text).not.toContain("Never display raw input");
        expect(messages[0].parts[0].type).toBe("tool-reviewPassages");
    });

    const common = { type: "tool-reviewPassages", toolCallId: "review", input } as const;
    const unfinished: UIMessage["parts"] = [
        { ...common, state: "input-streaming" },
        { ...common, state: "input-available" },
        { ...common, state: "output-error", errorText: "Failed" },
        {
            ...common,
            state: "output-available",
            output: { status: "invalid", reason: "source-mismatch" },
        },
    ];
    it.each(unfinished)("never promotes an incomplete or invalid $state review", (part) => {
        const message: UIMessage = { id: "assistant", role: "assistant", parts: [part] };
        expect(sanitizeOutboundMessages([message])).toEqual([]);
    });
});
