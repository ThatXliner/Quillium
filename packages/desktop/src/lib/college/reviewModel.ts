// reviewModel.ts — Bounded, target-neutral data for cross-essay review.
//
// Review groups intentionally keep only stable document/tab/draft identities.
// A captured source carries the short, transmitted prefix of a draft for one
// request; persisted reports retain its metadata and citations, never prose.

import { z } from "zod";
import { researchFingerprint } from "./researchModel";

const MAX_REVIEW_ID = 100;
const MAX_SOURCE_KEY = 200;
const MAX_GROUP_NAME = 200;
const MAX_GROUP_SCHOOL = 200;
const MAX_CYCLE = 100;
const MAX_PROMPT_LABEL = 200;
const MAX_PROMPT_TEXT = 4_000;
const MAX_CAPTURED_SOURCE_CHARS = 12_000;
const MAX_REPORT_SUMMARY = 2_000;
const MAX_REPORT_WARNING = 500;
const MAX_CITATION_QUOTE = 2_000;

function nonBlank(value: string): boolean {
    return value.trim().length > 0;
}

const boundedId = z.string().min(1).max(MAX_REVIEW_ID).refine(nonBlank, "ID must not be blank");

/** An exact source identity. IDs are never inferred from labels or prose. */
export const collegeReviewSourceRefSchema = z
    .object({
        documentId: boundedId,
        tabId: boundedId,
        draftId: boundedId,
    })
    .strict();

export type CollegeReviewSourceRef = z.infer<typeof collegeReviewSourceRefSchema>;

const citationSchema = z
    .object({
        sourceKey: z
            .string()
            .min(1)
            .max(MAX_SOURCE_KEY)
            .refine(nonBlank, "Citation source key must not be blank"),
        from: z.number().int().min(0).max(MAX_CAPTURED_SOURCE_CHARS),
        to: z.number().int().min(0).max(MAX_CAPTURED_SOURCE_CHARS),
        quote: z.string().max(MAX_CITATION_QUOTE),
    })
    .strict()
    .refine((citation) => citation.from <= citation.to, "Citation range is inverted");

export { citationSchema };
export type Citation = z.infer<typeof citationSchema>;

const capturedSourceMetadataShape = {
    sourceKey: z
        .string()
        .min(1)
        .max(MAX_SOURCE_KEY)
        .refine(nonBlank, "Source key must not be blank"),
    documentId: boundedId,
    tabId: boundedId,
    draftId: boundedId,
    documentLabel: z.string().max(MAX_GROUP_NAME),
    tabLabel: z.string().max(MAX_GROUP_NAME),
    draftLabel: z.string().max(MAX_GROUP_NAME),
    promptLabel: z.string().max(MAX_PROMPT_LABEL),
    promptText: z.string().max(MAX_PROMPT_TEXT),
    setupSchool: z.string().max(MAX_GROUP_SCHOOL),
    setupCycle: z.string().max(MAX_CYCLE),
    contentFingerprint: z.string().min(1).max(MAX_SOURCE_KEY),
    totalChars: z.number().int().min(0).max(10_000_000),
    sentChars: z.number().int().min(0).max(MAX_CAPTURED_SOURCE_CHARS),
    omittedChars: z.number().int().min(0).max(10_000_000),
};

const capturedSourceMetadataSchema = z
    .object(capturedSourceMetadataShape)
    .strict()
    .refine(
        (source) => source.sentChars + source.omittedChars === source.totalChars,
        "Captured source character counts do not add up",
    );

/** A source captured for one request, including only the bounded sent prefix. */
export const capturedReviewSourceSchema = z
    .object({
        ...capturedSourceMetadataShape,
        sentContent: z.string().max(MAX_CAPTURED_SOURCE_CHARS),
    })
    .strict()
    .refine(
        (source) => source.sentChars === source.sentContent.length,
        "Captured source sentChars must match sentContent",
    )
    .refine(
        (source) => source.sentChars + source.omittedChars === source.totalChars,
        "Captured source character counts do not add up",
    );

/** Report metadata deliberately omits `sentContent`. */
export const capturedReviewSourceMetadataSchema = capturedSourceMetadataSchema;
export type CapturedReviewSource = z.infer<typeof capturedReviewSourceSchema>;
export type CapturedReviewSourceMetadata = z.infer<typeof capturedReviewSourceMetadataSchema>;
export const collegeReviewCapturedSourceSchema = capturedReviewSourceSchema;
export const collegeReviewCapturedSourceMetadataSchema = capturedReviewSourceMetadataSchema;

const repeatedStorySchema = z
    .object({
        summary: z.string().min(1).max(MAX_REPORT_SUMMARY).refine(nonBlank),
        citations: z.array(citationSchema).min(2).max(8),
    })
    .strict();

const contributionSchema = z
    .object({
        sourceKey: z.string().min(1).max(MAX_SOURCE_KEY).refine(nonBlank),
        summary: z.string().min(1).max(MAX_REPORT_SUMMARY).refine(nonBlank),
        citations: z.array(citationSchema).min(1).max(8),
    })
    .strict();

const contradictionSchema = z
    .object({
        question: z.string().min(1).max(MAX_REPORT_SUMMARY).refine(nonBlank),
        citations: z.array(citationSchema).min(2).max(8),
    })
    .strict();

/** A persisted, citation-backed cross-essay review. It contains no prose. */
export const reportSchema = z
    .object({
        id: boundedId,
        groupId: boundedId,
        createdAt: z.number().int().nonnegative(),
        providerLabel: z.string().min(1).max(200).refine(nonBlank),
        capturedSources: z
            .array(capturedReviewSourceMetadataSchema)
            .min(2)
            .max(8)
            .refine(
                (sources) =>
                    new Set(sources.map((source) => source.sourceKey)).size === sources.length,
                "Captured source keys must be unique",
            ),
        repeatedStories: z.array(repeatedStorySchema).max(24),
        contributions: z.array(contributionSchema).max(8),
        contradictions: z.array(contradictionSchema).max(24),
        warnings: z.array(z.string().max(MAX_REPORT_WARNING)).max(32),
    })
    .strict();

export const collegeReviewReportSchema = reportSchema;
export const collegeReviewCitationSchema = citationSchema;

export type Report = z.infer<typeof reportSchema>;
export type CollegeReviewReport = Report;
export type RepeatedStory = z.infer<typeof repeatedStorySchema>;
export type Contribution = z.infer<typeof contributionSchema>;
export type Contradiction = z.infer<typeof contradictionSchema>;

/** Versioned global grouping of exact draft sources. */
export const collegeReviewGroupSchema = z
    .object({
        version: z.literal(1),
        id: boundedId,
        name: z.string().max(MAX_GROUP_NAME).refine(nonBlank, "Group name must not be blank"),
        school: z.string().max(MAX_GROUP_SCHOOL).refine(nonBlank, "School must not be blank"),
        cycle: z.string().max(MAX_CYCLE),
        sources: z
            .array(collegeReviewSourceRefSchema)
            .min(2)
            .max(8)
            .refine(
                (sources) =>
                    new Set(sources.map((source) => source.draftId)).size === sources.length,
                "Review sources must use unique drafts",
            ),
        latestReport: reportSchema.optional(),
    })
    .strict()
    .refine(
        (group) =>
            new Set(group.sources.map((source) => `${source.documentId}\u0000${source.tabId}`))
                .size === group.sources.length,
        "Review sources must use unique document tabs",
    )
    .refine(
        (group) => !group.latestReport || group.latestReport.groupId === group.id,
        "Latest report must belong to its review group",
    );

export type CollegeReviewGroup = z.infer<typeof collegeReviewGroupSchema>;
export const collegeReviewGroupV1Schema = collegeReviewGroupSchema;

export class CollegeReviewParseError extends Error {
    readonly kind: "unsupported" | "malformed";

    constructor(kind: "unsupported" | "malformed", message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "CollegeReviewParseError";
        this.kind = kind;
    }
}

function parseVersioned<T>(
    raw: unknown,
    schema: { safeParse: (value: unknown) => { success: boolean; data?: T; error?: unknown } },
    label: string,
): T {
    let value: unknown = raw;
    if (typeof raw === "string") {
        try {
            value = JSON.parse(raw) as unknown;
        } catch (cause) {
            throw new CollegeReviewParseError(
                "malformed",
                `The saved ${label} is not valid JSON.`,
                {
                    cause,
                },
            );
        }
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new CollegeReviewParseError("malformed", `The saved ${label} is not an object.`);
    }
    if ((value as { version?: unknown }).version !== 1) {
        throw new CollegeReviewParseError(
            "unsupported",
            `This ${label} uses an unsupported version. Update Quillium before using it.`,
        );
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
        const error = parsed.error as { issues?: Array<{ message?: string }> };
        throw new CollegeReviewParseError(
            "malformed",
            `The saved ${label} is invalid: ${error.issues?.[0]?.message ?? "check its fields"}.`,
            { cause: parsed.error },
        );
    }
    return parsed.data as T;
}

export function parseCollegeReviewGroup(raw: unknown): CollegeReviewGroup {
    return parseVersioned(raw, collegeReviewGroupSchema, "College review group");
}

export function cloneCollegeReviewGroup(group: CollegeReviewGroup): CollegeReviewGroup {
    return parseCollegeReviewGroup(JSON.parse(JSON.stringify(group)) as unknown);
}

export function serializeCollegeReviewGroup(group: CollegeReviewGroup): string {
    return JSON.stringify(cloneCollegeReviewGroup(group));
}

export function parseCollegeReviewReport(raw: unknown): Report {
    const parsed = reportSchema.safeParse(
        typeof raw === "string"
            ? (() => {
                  try {
                      return JSON.parse(raw) as unknown;
                  } catch (cause) {
                      throw new CollegeReviewParseError(
                          "malformed",
                          "The review report is not valid JSON.",
                          { cause },
                      );
                  }
              })()
            : raw,
    );
    if (!parsed.success) {
        throw new CollegeReviewParseError(
            "malformed",
            `The review report is invalid: ${parsed.error.issues[0]?.message ?? "check its fields"}.`,
            { cause: parsed.error },
        );
    }
    return parsed.data;
}

export function cloneCollegeReviewReport(report: Report): Report {
    return parseCollegeReviewReport(JSON.parse(JSON.stringify(report)) as unknown);
}

export function serializeCollegeReviewReport(report: Report): string {
    return JSON.stringify(cloneCollegeReviewReport(report));
}

export const parseReport = parseCollegeReviewReport;
export const cloneReport = cloneCollegeReviewReport;
export const serializeReport = serializeCollegeReviewReport;

/** Stable source identity used by citations and survives label changes. */
export function reviewSourceKey(source: CollegeReviewSourceRef): string {
    return `source:${researchFingerprint(JSON.stringify(collegeReviewSourceRefSchema.parse(source)))}`;
}

/** Stable group identity used to detect edits while a review is in flight. */
export function reviewGroupFingerprint(group: CollegeReviewGroup): string {
    const value = cloneCollegeReviewGroup(group);
    return researchFingerprint(
        JSON.stringify({
            version: value.version,
            id: value.id,
            name: value.name,
            school: value.school,
            cycle: value.cycle,
            sources: value.sources,
        }),
    );
}

export function capturedSourceMetadata(source: CapturedReviewSource): CapturedReviewSourceMetadata {
    const { sentContent: _sentContent, ...metadata } = source;
    return capturedReviewSourceMetadataSchema.parse(metadata);
}
