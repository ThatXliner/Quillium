/** publicSharePayload.ts. Parses public share RPC rows before rendering. */
import {
    PublishedAnnotationSchema,
    type ReadonlyShareDocument,
    ReadonlyShareStateSchema,
} from "@quillium/share";
import { z } from "zod";

const PublicShareRpcRowSchema = z.object({
    published_title: z.string(),
    preview_text: z.string(),
    published_content: z.string(),
    published_annotations: z.array(PublishedAnnotationSchema).nullable(),
    published_state: ReadonlyShareStateSchema.nullable(),
    author_name: z.string().nullable(),
    published_at: z
        .string()
        .refine((value) => Number.isFinite(Date.parse(value)))
        .nullable(),
});

export function parsePublicShare(data: unknown, token: string): ReadonlyShareDocument | null {
    const result = PublicShareRpcRowSchema.safeParse(data);
    if (!result.success) return null;
    const share = result.data;
    return {
        token,
        title: share.published_title || "Untitled",
        excerpt: share.preview_text,
        content: share.published_content,
        annotations: share.published_annotations ?? [],
        state: share.published_state,
        authorName: share.author_name,
        publishedAt: share.published_at,
        canonicalUrl: `https://quillium.bryanhu.com/share/${token}`,
    };
}
