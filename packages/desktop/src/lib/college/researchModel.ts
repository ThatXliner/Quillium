// researchModel.ts — Persisted provenance and scope identity for College research.

import { z } from "zod";
import type { CollegeSetup } from "./model";

function _httpsUrl(value: string): URL | null {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return null;
    }
    return url.protocol === "https:" && url.hostname && !url.username && !url.password ? url : null;
}

const researchTargetPromptSchema = z
    .object({
        id: z
            .string()
            .min(1)
            .max(100)
            .refine((value) => value.trim().length > 0),
        label: z.string().max(200),
        text: z
            .string()
            .min(1)
            .max(4_000)
            .refine((value) => value.trim().length > 0),
    })
    .strict();

/** The only target fields allowed into a school research request. */
export const researchTargetSchema = z
    .object({
        school: z
            .string()
            .min(1)
            .max(200)
            .refine((value) => value.trim().length > 0),
        cycle: z.string().max(100),
        program: z.string().max(200),
        sourceUrl: z
            .string()
            .min(1)
            .max(2_000)
            .superRefine((value, context) => {
                if (!_httpsUrl(value)) {
                    context.addIssue({
                        code: "custom",
                        message:
                            "Research source URL must be a parseable HTTPS URL without credentials.",
                    });
                }
            }),
        prompts: z
            .array(researchTargetPromptSchema)
            .min(1)
            .max(12)
            .refine(
                (prompts) => new Set(prompts.map((prompt) => prompt.id)).size === prompts.length,
                "Research prompt IDs must be unique",
            ),
    })
    .strict();

export type ResearchTarget = z.infer<typeof researchTargetSchema>;

/** Provenance attached to a reference returned by one school-research snapshot. */
export const researchProvenanceSchema = z
    .object({
        setupKey: z.string().max(100),
        snapshotId: z.string().min(1).max(100),
        promptIds: z.array(z.string().min(1).max(100)).min(1).max(12),
        school: z.string().max(200),
        program: z.string().max(200),
        targetCycle: z.string().max(100),
        evidence: z.string().max(1000),
    })
    .strict();

export type ResearchProvenance = z.infer<typeof researchProvenanceSchema>;

export const researchReviewSchema = z
    .object({
        target: researchTargetSchema,
        rejectedKeys: z.array(z.string().min(1).max(100)).max(24),
        checkedDate: z.string().max(100),
    })
    .strict();

export type ResearchReview = z.infer<typeof researchReviewSchema>;

/**
 * Return a compact identity for the setup that a research snapshot belongs to.
 * Prompt constraints are included because changing a limit must invalidate the
 * snapshot's effective context even when its wording is unchanged.
 */
export function collegeResearchSetupKey(
    setup: Pick<CollegeSetup, "school" | "program" | "cycle" | "prompts">,
): string {
    const value = JSON.stringify({
        school: setup.school,
        program: setup.program,
        cycle: setup.cycle,
        prompts: setup.prompts.map((prompt) => ({
            id: prompt.id,
            label: prompt.label,
            text: prompt.text,
            sourceUrl: prompt.sourceUrl,
            constraints: prompt.constraints.map((constraint) => ({
                id: constraint.id,
                unit: constraint.unit,
                min: constraint.min,
                max: constraint.max,
                detail: constraint.detail,
            })),
        })),
    });

    return researchFingerprint(value);
}

/** Compact deterministic identity for persisted research comparisons. */
export function researchFingerprint(value: string): string {
    return `${_hash32(value, 0x811c9dc5)}-${_hash32(value, 0x9e3779b9)}`;
}

function _hash32(value: string, seed: number): string {
    let hash = seed >>> 0;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
}
