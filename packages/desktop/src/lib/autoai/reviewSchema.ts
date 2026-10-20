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
    scope: z.enum(["focused", "whole-passage"]).optional(),
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
          scope?: "focused" | "whole-passage";
      }
    | {
          type: "revision";
          targetText: string;
          versions: Array<{ label: string; text: string }>;
          threadMessage: string;
          scope?: "focused" | "whole-passage";
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
            const aliases = [annotation.replacement, annotation.suggestedReplacement];
            const replacement =
                aliases.find((text) => text !== undefined && text.length > 0) ??
                aliases.find((text) => text !== undefined);
            const rationale = nonEmpty(
                annotation.rationale,
                annotation.comment,
                annotation.explanation,
            );
            return replacement !== undefined && rationale
                ? [
                      {
                          type: "suggestion",
                          targetText,
                          replacement,
                          rationale,
                          ...(annotation.scope ? { scope: annotation.scope } : {}),
                      },
                  ]
                : [];
        }

        const versionTexts = [...(annotation.revisions ?? [])];
        if (
            annotation.versionText !== undefined &&
            (annotation.versionText !== "" || versionTexts.length === 0)
        )
            versionTexts.unshift(annotation.versionText);
        const baseLabel = nonEmpty(annotation.versionLabel, annotation.label) ?? "Alternative";
        const versions = versionTexts.map((text, index) => ({
            label: versionTexts.length === 1 ? baseLabel : `${baseLabel} ${index + 1}`,
            text,
        }));
        const threadMessage = nonEmpty(annotation.threadMessage, annotation.explanation);
        return versions.length > 0 && threadMessage
            ? [
                  {
                      type: "revision",
                      targetText,
                      versions,
                      threadMessage,
                      ...(annotation.scope ? { scope: annotation.scope } : {}),
                  },
              ]
            : [];
    });
}
