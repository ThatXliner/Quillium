// model.ts — Validated, target-neutral College writing setup data.
//
// A setup belongs to one document tab in storage, but its JSON deliberately
// contains no document or tab identifiers. This lets duplicate-document logic
// remap the storage row without rewriting the setup blob.

import type { EditorialPreferences } from "$lib/ai/editorialPolicy";
import type { ReaderPersona } from "$lib/readers/presets";
import { z } from "zod";
import {
    type ResearchProvenance,
    type ResearchReview,
    type ResearchTarget,
    bundledGuidanceProvenanceSchema,
    collegeResearchSetupKey,
    researchProvenanceSchema,
    researchReviewSchema,
} from "./researchModel";

const HTTP_URL_PATTERN = /^https?:\/\/[^\s]+$/i;

const editorialPreferencesSchema = z
    .object({
        stance: z.enum(["author-first", "collaborative", "exploratory"]),
        feedbackDensity: z.enum(["quiet", "focused", "thorough"]),
        voiceLatitude: z.enum(["preserve", "adapt", "transform"]),
    })
    .strict();

const personaProfileSchema = z
    .object({
        about: z.string().max(2000),
        goodFor: z.array(z.string().max(200)).max(12),
        example: z.string().max(2000),
    })
    .strict();

/** The persisted portion of a reader persona used by a College tab. */
export const collegeReaderSchema = z
    .object({
        id: z.string().min(1).max(100),
        name: z.string().max(200),
        emoji: z.string().max(32),
        color: z.string().max(100),
        description: z.string().max(1000),
        profile: personaProfileSchema.optional(),
        instruction: z.string().max(4000),
        builtin: z.boolean(),
        enabled: z.boolean(),
        chattiness: z.enum(["quiet", "normal", "verbose"]),
    })
    .strict();

const collegeConstraintSchema = z
    .object({
        id: z.string().min(1).max(100),
        unit: z.enum(["words", "characters", "other"]),
        min: z.number().int().min(0).max(10_000_000).nullable(),
        max: z.number().int().min(0).max(10_000_000).nullable(),
        detail: z.string().max(500),
    })
    .strict()
    .refine((constraint) => {
        return (
            constraint.min === null || constraint.max === null || constraint.min <= constraint.max
        );
    }, "Constraint minimum cannot exceed its maximum");

const collegePromptSchema = z
    .object({
        id: z.string().min(1).max(100),
        label: z.string().max(200),
        text: z.string().max(4000),
        sourceUrl: z
            .string()
            .max(2000)
            .refine((value) => value === "" || HTTP_URL_PATTERN.test(value), {
                message: "Prompt source URL must be empty or an http(s) URL",
            }),
        constraints: z
            .array(collegeConstraintSchema)
            .max(8)
            .refine(
                (constraints) =>
                    new Set(constraints.map((constraint) => constraint.id)).size ===
                    constraints.length,
                "Constraint IDs must be unique",
            ),
    })
    .strict();

const collegeReferenceSchema = z
    .object({
        id: z.string().min(1).max(100),
        publisher: z.string().max(200),
        url: z
            .string()
            .max(2000)
            .refine((value) => value === "" || HTTP_URL_PATTERN.test(value), {
                message: "Reference URL must be empty or an http(s) URL",
            }),
        checkedDate: z.string().max(100),
        cycle: z.string().max(100),
        kind: z.enum(["requirement", "official-advice", "editorial-guidance"]),
        summary: z.string().max(2000),
        research: researchProvenanceSchema.optional(),
        bundle: bundledGuidanceProvenanceSchema.optional(),
    })
    .strict();

/** A document range and count for one prompt answer in the tab writing brief. */
export type CollegeBriefSection = {
    promptId: string;
    heading: string;
    from: number;
    to: number;
    wordCount: number;
    characterCount: number;
};

/** The tab-specific writing brief sent to editorial requests. */
export type CollegeBrief = Pick<
    CollegeSetup,
    "school" | "program" | "cycle" | "intent" | "feedbackFocus" | "prompts"
> & {
    sections?: CollegeBriefSection[];
};

export type CollegePrompt = z.infer<typeof collegePromptSchema>;
export type CollegeReference = z.infer<typeof collegeReferenceSchema>;
export type { ResearchProvenance, ResearchReview, ResearchTarget };
export { collegeResearchSetupKey };

/** Versioned persisted setup. No target IDs belong in this value. */
export type CollegeSetup = {
    version: 1;
    presetVersion: 1;
    kind: "uc-piq" | "common-app" | "supplemental";
    cycle: string;
    school: string;
    program: string;
    intent: string;
    feedbackFocus: string;
    prompts: CollegePrompt[];
    sectionMode?: boolean;
    promptArchive?: CollegePrompt[];
    preferences: EditorialPreferences;
    readers: ReaderPersona[];
    feedbackReaders: boolean;
    reviseReaders: boolean;
    active: boolean;
    references: CollegeReference[];
    researchReview?: ResearchReview;
};

/**
 * Reader fields are intentionally the same required fields as ReaderPersona;
 * profile remains optional so older/custom personas can be saved unchanged.
 */
const collegeSetupSchema = z
    .object({
        version: z.literal(1),
        presetVersion: z.literal(1),
        kind: z.enum(["uc-piq", "common-app", "supplemental"]),
        cycle: z.string().max(100),
        school: z.string().max(200),
        program: z.string().max(200),
        intent: z.string().max(2000),
        feedbackFocus: z.string().max(2000),
        prompts: z
            .array(collegePromptSchema)
            .refine(
                (prompts) => new Set(prompts.map((prompt) => prompt.id)).size === prompts.length,
                "Prompt IDs must be unique",
            ),
        sectionMode: z.boolean().optional(),
        promptArchive: z
            .array(collegePromptSchema)
            .max(100)
            .refine(
                (prompts) => new Set(prompts.map((prompt) => prompt.id)).size === prompts.length,
                "Archived prompt IDs must be unique",
            )
            .optional(),
        preferences: editorialPreferencesSchema,
        readers: z
            .array(collegeReaderSchema)
            .max(16)
            .refine(
                (readers) => new Set(readers.map((reader) => reader.id)).size === readers.length,
                "Reader IDs must be unique",
            ),
        feedbackReaders: z.boolean(),
        reviseReaders: z.boolean().default(false),
        active: z.boolean(),
        references: z
            .array(collegeReferenceSchema)
            .refine(
                (references) =>
                    new Set(references.map((reference) => reference.id)).size === references.length,
                "Reference IDs must be unique",
            ),
        researchReview: researchReviewSchema.optional(),
    })
    .strict()
    .superRefine((setup, context) => {
        if (!setup.sectionMode && setup.prompts.length === 0) {
            context.addIssue({
                code: "custom",
                path: ["prompts"],
                message: "At least one prompt is required outside section mode",
            });
        }
    });

export { collegeSetupSchema };

export class CollegeSetupParseError extends Error {
    readonly kind: "unsupported" | "malformed";

    constructor(kind: "unsupported" | "malformed", message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "CollegeSetupParseError";
        this.kind = kind;
    }
}

/** Parse a DB JSON blob and fail closed on malformed or future versions. */
export function parseCollegeSetup(raw: unknown): CollegeSetup {
    let value: unknown = raw;
    if (typeof raw === "string") {
        try {
            value = JSON.parse(raw) as unknown;
        } catch (cause) {
            throw new CollegeSetupParseError(
                "malformed",
                "The saved College setup is not valid JSON.",
                { cause },
            );
        }
    }

    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new CollegeSetupParseError("malformed", "The saved College setup is not an object.");
    }
    const version = (value as { version?: unknown }).version;
    const presetVersion = (value as { presetVersion?: unknown }).presetVersion;
    if (version !== 1 || presetVersion !== 1) {
        throw new CollegeSetupParseError(
            "unsupported",
            "This College setup uses an unsupported version. Remove it or update Quillium before using it.",
        );
    }

    const parsed = collegeSetupSchema.safeParse(value);
    if (!parsed.success) {
        throw new CollegeSetupParseError(
            "malformed",
            `The saved College setup is invalid: ${parsed.error.issues[0]?.message ?? "check its fields"}.`,
            { cause: parsed.error },
        );
    }
    return parsed.data;
}

/** Deep clone through JSON so snapshots cannot share reactive or mutable data. */
export function cloneCollegeSetup(setup: CollegeSetup): CollegeSetup {
    return parseCollegeSetup(JSON.parse(JSON.stringify(setup)) as unknown);
}

/** Serialize only after validation so DB never receives a malformed setup. */
export function serializeCollegeSetup(setup: CollegeSetup): string {
    return JSON.stringify(cloneCollegeSetup(setup));
}
