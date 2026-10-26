import { z } from "zod";

export const PASSAGE_REVIEW_TOOL_NAME = "reviewPassages";

export const PASSAGE_REVIEW_CATEGORIES = [
    {
        id: "keep",
        label: "Keep",
        meaning: "Core content",
        guidance: "core content that carries scene, insight, change, or payoff",
    },
    {
        id: "condense",
        label: "Condense",
        meaning: "Useful idea, too many words",
        guidance: "a useful idea that takes more words than it needs",
    },
    {
        id: "cut",
        label: "Cut",
        meaning: "Redundant or lower-value evidence",
        guidance: "redundant or lower-value evidence the piece does not need",
    },
    {
        id: "revise",
        label: "Revise",
        meaning: "Wording or logic needs work",
        guidance: "an idea worth keeping whose wording or logic needs work",
    },
] as const;

export type PassageReviewCategory = (typeof PASSAGE_REVIEW_CATEGORIES)[number]["id"];

export const MAX_REVIEW_PASSAGES = 30;

export const passageReviewInputSchema = z.object({
    summary: z.string().trim().max(1000).optional(),
    passages: z
        .array(
            z.object({
                passage: z
                    .string()
                    .min(1)
                    .max(10000)
                    .refine((text) => text.trim().length > 0)
                    .describe(
                        "Exact passage copied verbatim from the draft. Never paraphrase or truncate.",
                    ),
                category: z.enum(PASSAGE_REVIEW_CATEGORIES.map((category) => category.id)),
                reason: z
                    .string()
                    .trim()
                    .min(1)
                    .max(2000)
                    .describe(
                        "Explain the mark with evidence. Diagnose only, without replacement wording.",
                    ),
            }),
        )
        .min(1)
        .max(MAX_REVIEW_PASSAGES)
        .describe("Reviewed passages in source order, without overlaps."),
});

export type PassageReview = z.infer<typeof passageReviewInputSchema>;

const passageReviewResultSchema = z.discriminatedUnion("status", [
    z.object({
        status: z.literal("complete"),
        review: passageReviewInputSchema,
        scope: z.enum(["selection", "draft"]),
    }),
    z.object({
        status: z.literal("invalid"),
        reason: z.enum(["invalid-payload", "source-mismatch"]),
    }),
]);

export type PassageReviewResult = z.infer<typeof passageReviewResultSchema>;

export function validatePassageReview({
    input,
    sourceText,
    scope,
}: {
    input: unknown;
    sourceText: string;
    scope: "selection" | "draft";
}): PassageReviewResult {
    const parsed = passageReviewInputSchema.safeParse(input);
    if (!parsed.success) return { status: "invalid", reason: "invalid-payload" };
    let cursor = 0;
    for (const item of parsed.data.passages) {
        const start = sourceText.indexOf(item.passage, cursor);
        if (start < 0) return { status: "invalid", reason: "source-mismatch" };
        cursor = start + item.passage.length;
    }
    return { status: "complete", review: parsed.data, scope };
}

export function parsePassageReviewResult(value: unknown): PassageReviewResult | null {
    const parsed = passageReviewResultSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}

export function passageReviewLegend(review: PassageReview): {
    category: (typeof PASSAGE_REVIEW_CATEGORIES)[number];
    count: number;
}[] {
    return PASSAGE_REVIEW_CATEGORIES.map((category) => ({
        category,
        count: review.passages.filter((item) => item.category === category.id).length,
    })).filter((entry) => entry.count > 0);
}

export function passageReviewCategoryPrompt(): string {
    return PASSAGE_REVIEW_CATEGORIES.map(
        (category) => `- ${category.id} (${category.label}): ${category.guidance}.`,
    ).join("\n");
}

export function passageReviewHistoryText(review: PassageReview): string {
    return `Earlier passage review shown to the writer. It is historical and the draft may have changed since:\n${JSON.stringify(review)}`;
}
