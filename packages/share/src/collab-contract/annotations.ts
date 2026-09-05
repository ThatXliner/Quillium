// Validate live Yjs children before projecting them into editor state.
import * as Y from "yjs";
import { z } from "zod";
import { SuggestionReplacementSchema, ThreadMessageSchema } from "../core/models.js";

export type YjsAnnotationNode = Y.Map<unknown>;

const VersionNodeSchema = z
    .instanceof(Y.Map)
    .transform((node) => Object.fromEntries(node.entries()))
    .pipe(
        z.object({
            id: z.string().optional(),
            text: z.instanceof(Y.Text),
            label: z.string().optional(),
            annotations: z.instanceof(Y.Map).optional(),
        }),
    );

export const YjsThreadSchema = z
    .instanceof(Y.Array)
    .transform((array) => array.toArray())
    .pipe(z.array(ThreadMessageSchema));

const BaseSchema = z.object({
    id: z.string().optional(),
    startPos: z.instanceof(Uint8Array),
    endPos: z.instanceof(Uint8Array),
    status: z.enum(["pending", "active"]).optional(),
    thread: YjsThreadSchema.optional().default([]),
    annotations: z.instanceof(Y.Map).optional(),
});

// Optional legacy fields remain supported until older clients/rooms retire.
// Child annotations are validated individually when read, so one bad child
// cannot hide its valid siblings or its parent revision.
export const YjsAnnotationNodeSchema = z
    .instanceof(Y.Map)
    .transform((node) => Object.fromEntries(node.entries()))
    .pipe(
        z.discriminatedUnion("_type", [
            BaseSchema.extend({ _type: z.literal("comment") }),
            BaseSchema.extend({
                _type: z.literal("suggestion"),
                author: z.string().nullish(),
                replacements: z
                    .instanceof(Y.Array)
                    .transform((array) => array.toArray())
                    .pipe(z.array(SuggestionReplacementSchema))
                    .optional()
                    .default([]),
            }),
            BaseSchema.extend({
                _type: z.literal("revision"),
                versions: z
                    .instanceof(Y.Map)
                    .refine(
                        (versions) =>
                            versions.size > 0 &&
                            Array.from(versions.values()).every(
                                (version) => VersionNodeSchema.safeParse(version).success,
                            ),
                    ),
                order: z
                    .instanceof(Y.Array)
                    .transform((array) => array.toArray())
                    .pipe(z.array(z.string()))
                    .optional(),
                activeVersionId: z.string().optional(),
                activeVersionIndex: z.number().int().nonnegative().optional(),
            }),
        ]),
    );
