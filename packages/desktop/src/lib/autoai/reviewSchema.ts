/**
 * reviewSchema.ts — Structured-output schema and normalization for AutoAI reviews.
 *
 * AI providers do not all handle discriminated-union JSON schemas consistently.
 * Keep the generation schema flat and permissive, then validate each annotation
 * into the stricter shape used by the editor.
 */

import { z } from "zod";

const RawAnnotationSchema = z.object({
    type: z.enum(["comment", "suggestion", "revision"]),
    targetText: z.string(),
    comment: z.string().optional(),
    replacement: z.string().optional(),
    rationale: z.string().optional(),
    versionLabel: z.string().optional(),
    versionText: z.string().optional(),
    threadMessage: z.string().optional(),
    // Common aliases models use even when asked for the canonical fields.
    label: z.string().optional(),
    explanation: z.string().optional(),
    suggestedReplacement: z.string().optional(),
    revisions: z.array(z.string()).optional(),
});

export const AutoAIReviewSchema = z.object({
    annotations: z.array(RawAnnotationSchema),
});

export type AutoAIReviewOutput = z.infer<typeof AutoAIReviewSchema>;

export type AutoAIReviewAnnotation =
    | { type: "comment"; targetText: string; comment: string }
    | {
          type: "suggestion";
          targetText: string;
          replacement: string;
          rationale: string;
      }
    | {
          type: "revision";
          targetText: string;
          versions: Array<{ label: string; text: string }>;
          threadMessage: string;
      };

function nonEmpty(...values: Array<string | undefined>): string | undefined {
    return values.find((value) => value?.trim())?.trim();
}

/** Normalize provider variations and discard only the malformed item, not the whole review. */
export function normalizeAutoAIReview(result: AutoAIReviewOutput): AutoAIReviewAnnotation[] {
    return result.annotations.flatMap((annotation): AutoAIReviewAnnotation[] => {
        const targetText = annotation.targetText;
        if (!targetText) return [];

        if (annotation.type === "comment") {
            const comment = nonEmpty(annotation.comment, annotation.explanation);
            return comment ? [{ type: "comment", targetText, comment }] : [];
        }

        if (annotation.type === "suggestion") {
            const replacement = nonEmpty(annotation.replacement, annotation.suggestedReplacement);
            const rationale = nonEmpty(
                annotation.rationale,
                annotation.comment,
                annotation.explanation,
            );
            return replacement && rationale
                ? [{ type: "suggestion", targetText, replacement, rationale }]
                : [];
        }

        const versionTexts = annotation.revisions?.filter((text) => text.trim()) ?? [];
        if (annotation.versionText?.trim()) versionTexts.unshift(annotation.versionText.trim());
        const baseLabel = nonEmpty(annotation.versionLabel, annotation.label) ?? "Alternative";
        const versions = versionTexts.map((text, index) => ({
            label: versionTexts.length === 1 ? baseLabel : `${baseLabel} ${index + 1}`,
            text,
        }));
        const threadMessage = nonEmpty(annotation.threadMessage, annotation.explanation);
        return versions.length > 0 && threadMessage
            ? [{ type: "revision", targetText, versions, threadMessage }]
            : [];
    });
}
