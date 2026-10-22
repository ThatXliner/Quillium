/** types.ts. Validated public Web Preview payloads and their inferred types. */
import { z } from "zod";
import {
    AiGenerationProvenanceSchema,
    RawAnnotationSchema,
    SuggestionReplacementSchema,
    ThreadMessageSchema,
    VersionGroupsSchema,
    VersionStateSchema,
} from "./core/models";

export type SerializedThreadMessage = z.infer<typeof ThreadMessageSchema>;
export type SerializedAiGenerationProvenance = z.infer<typeof AiGenerationProvenanceSchema>;

const PublishedAnnotationBaseSchema = z.object({
    id: z.string(),
    type: z.enum(["comment", "suggestion", "revision"]),
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
    selectedText: z.string(),
    thread: z.array(ThreadMessageSchema),
    aiProvenance: AiGenerationProvenanceSchema.optional(),
});

const PublishedCommentSchema = PublishedAnnotationBaseSchema.extend({ type: z.literal("comment") });
const PublishedSuggestionSchema = PublishedAnnotationBaseSchema.extend({
    type: z.literal("suggestion"),
    replacements: z.array(SuggestionReplacementSchema),
    author: z.string().optional(),
});
const PublishedRevisionSchema = PublishedAnnotationBaseSchema.extend({
    type: z.literal("revision"),
    activeVersionIndex: z.number().int().nonnegative(),
    versions: z.array(
        z.object({
            index: z.number().int().nonnegative(),
            // Legacy flat shares omit versionId.
            versionId: z.string().optional(),
            text: z.string(),
            label: z.string().optional(),
            provenance: z.enum(["human", "ai", "mixed"]).optional(),
            aiProvenance: AiGenerationProvenanceSchema.optional(),
            group: z
                .object({
                    id: z.string(),
                    label: z.string(),
                    memberCount: z.number().int().nonnegative(),
                    color: z.string(),
                })
                .optional(),
            get annotations(): z.ZodArray<typeof PublishedAnnotationSchema> {
                return z.array(PublishedAnnotationSchema);
            },
        }),
    ),
});

export const PublishedAnnotationSchema = z.discriminatedUnion("type", [
    PublishedCommentSchema,
    PublishedSuggestionSchema,
    PublishedRevisionSchema,
]);
export type SerializedAnnotationBase = z.infer<typeof PublishedAnnotationBaseSchema>;
export type SerializedCommentAnnotation = z.infer<typeof PublishedCommentSchema>;
export type SerializedSuggestionAnnotation = z.infer<typeof PublishedSuggestionSchema>;
export type SerializedRevisionAnnotation = z.infer<typeof PublishedRevisionSchema>;
export type SerializedAnnotation = z.infer<typeof PublishedAnnotationSchema>;

const [RawCommentSchema, RawSuggestionSchema, RawRevisionSchema] = RawAnnotationSchema.options;
const PublishedVersionStateSchema = VersionStateSchema.extend({
    get annotationField(): z.ZodOptional<typeof PublishedRawAnnotationsSchema> {
        return PublishedRawAnnotationsSchema.optional();
    },
    versionGroupField: VersionGroupsSchema.optional(),
});
const PublishedRawAnnotationSchema = z.discriminatedUnion("_type", [
    RawCommentSchema,
    RawSuggestionSchema,
    RawRevisionSchema.extend({
        get versions(): z.ZodArray<typeof PublishedVersionStateSchema> {
            return z.array(PublishedVersionStateSchema).min(1);
        },
    }),
]);
const PublishedRawAnnotationsSchema = z.record(z.string(), PublishedRawAnnotationSchema);
export const ReadonlyEditorStateSchema = PublishedVersionStateSchema.pick({
    doc: true,
    annotationField: true,
    versionGroupField: true,
});
export type ReadonlyEditorState = z.infer<typeof ReadonlyEditorStateSchema>;

const ReadonlyShareTabSchema = z.object({
    id: z.string(),
    label: z.string(),
    draftId: z.string(),
    state: ReadonlyEditorStateSchema,
});
export type ReadonlyShareTab = z.infer<typeof ReadonlyShareTabSchema>;

export const ReadonlyShareStateV2Schema = z.object({
    kind: z.literal("quillium-readonly-share"),
    version: z.literal(2),
    // Early v2 shares omitted scope and published only the current tab.
    scope: z.enum(["current-tab", "all-tabs"]).optional(),
    activeTabId: z.string().nullable(),
    tabs: z.array(ReadonlyShareTabSchema),
});
export type ReadonlyShareStateV2 = z.infer<typeof ReadonlyShareStateV2Schema>;
export type ReadonlyShareScope = NonNullable<ReadonlyShareStateV2["scope"]>;

export const ReadonlyShareStateSchema = z.union([
    ReadonlyShareStateV2Schema,
    ReadonlyEditorStateSchema.refine((state) => state.kind !== "quillium-readonly-share"),
]);

export function isReadonlyShareStateV2(value: unknown): value is ReadonlyShareStateV2 {
    return ReadonlyShareStateV2Schema.safeParse(value).success;
}

const ReadonlyShareHeaderSchema = ReadonlyShareStateV2Schema.pick({
    kind: true,
    version: true,
    scope: true,
});

export function readonlyShareScopeOf(value: unknown): ReadonlyShareScope {
    const header = ReadonlyShareHeaderSchema.safeParse(value);
    return header.success && header.data.scope === "all-tabs" ? "all-tabs" : "current-tab";
}

export function includesReadonlyShareTab(
    scope: ReadonlyShareScope,
    tabId: string,
    currentTabId: string | null,
): boolean {
    return scope === "all-tabs" || tabId === currentTabId;
}

export type ReadonlyShareDocument = {
    token: string;
    title: string;
    excerpt: string;
    content: string;
    annotations: SerializedAnnotation[];
    state: Record<string, unknown> | null;
    authorName: string | null;
    publishedAt: string | null;
    canonicalUrl: string;
};
