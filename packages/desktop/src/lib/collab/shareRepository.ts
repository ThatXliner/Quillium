/**
 * shareRepository.ts — Dependency-injected Supabase persistence for Omni Web
 * Preview shares. The desktop wrapper supplies the configured client and the
 * current author's display name; tests can supply an authenticated client and
 * exercise this exact production data path.
 */
import type { SerializedAnnotation } from "@quillium/share";
import type { SupabaseClient } from "@supabase/supabase-js";

const SHARE_BASE_URL = "https://quillium.bryanhu.com/share";
const SHARE_SELECT =
    "share_token, enabled, published_title, preview_text, published_content, published_annotations, published_state, author_name, published_at, updated_at";

export type ReadonlyShare = {
    shareToken: string;
    enabled: boolean;
    publishedTitle: string;
    previewText: string;
    publishedContent: string;
    publishedAnnotations: SerializedAnnotation[];
    /** Serialized CM state blob; null for pre-migration shares. */
    publishedState: Record<string, unknown> | null;
    authorName: string | null;
    publishedAt: string | null;
    updatedAt: string;
};

export type PublishReadonlyShareInput = {
    documentId: string;
    ownerId: string;
    title: string;
    content: string;
    annotations: SerializedAnnotation[];
    state: Record<string, unknown> | null;
};

export type RepositoryPublishReadonlyShareInput = PublishReadonlyShareInput & {
    authorName: string | null;
};

export type ShareRepository = {
    getReadonlyShare: (documentId: string) => Promise<ReadonlyShare | null>;
    publishReadonlyShare: (input: RepositoryPublishReadonlyShareInput) => Promise<ReadonlyShare>;
    disableReadonlyShare: (documentId: string) => Promise<ReadonlyShare | null>;
};

type ShareRow = {
    share_token: string;
    enabled: boolean;
    published_title: string;
    preview_text: string;
    published_content: string;
    published_annotations: SerializedAnnotation[] | null;
    published_state: Record<string, unknown> | null;
    author_name: string | null;
    published_at: string | null;
    updated_at: string;
};

function mapShare(row: ShareRow): ReadonlyShare {
    return {
        shareToken: row.share_token,
        enabled: row.enabled,
        publishedTitle: row.published_title,
        previewText: row.preview_text,
        publishedContent: row.published_content,
        publishedAnnotations: row.published_annotations ?? [],
        publishedState: row.published_state ?? null,
        authorName: row.author_name,
        publishedAt: row.published_at,
        updatedAt: row.updated_at,
    };
}

export function buildReadonlyShareUrl(token: string): string {
    return `${SHARE_BASE_URL}/${token}`;
}

export function buildSharePreviewText(content: string, maxLength = 220): string {
    const flattened = content.replace(/\s+/g, " ").trim();
    if (flattened.length <= maxLength) return flattened;
    return `${flattened.slice(0, maxLength - 1).trimEnd()}…`;
}

async function registerSyncDocument(
    client: SupabaseClient,
    documentId: string,
    ownerId: string,
    title: string,
): Promise<void> {
    const { error } = await client.from("sync_documents").upsert(
        {
            id: documentId,
            owner_id: ownerId,
            title,
        },
        { onConflict: "id" },
    );

    if (error) {
        throw new Error(`Failed to register document: ${error.message}`);
    }
}

export function createShareRepository(client: SupabaseClient): ShareRepository {
    return {
        async getReadonlyShare(documentId: string): Promise<ReadonlyShare | null> {
            const { data, error } = await client
                .from("shares")
                .select(SHARE_SELECT)
                .eq("document_id", documentId)
                .maybeSingle<ShareRow>();

            if (error) {
                throw new Error(`Failed to load share: ${error.message}`);
            }

            return data ? mapShare(data) : null;
        },

        async publishReadonlyShare(
            input: RepositoryPublishReadonlyShareInput,
        ): Promise<ReadonlyShare> {
            await registerSyncDocument(client, input.documentId, input.ownerId, input.title);

            const { data, error } = await client
                .from("shares")
                .upsert(
                    {
                        document_id: input.documentId,
                        enabled: true,
                        permission: "read",
                        published_title: input.title.trim() || "Untitled",
                        preview_text: buildSharePreviewText(input.content),
                        published_content: input.content,
                        published_annotations: input.annotations,
                        published_state: input.state,
                        author_name: input.authorName,
                        published_at: new Date().toISOString(),
                    },
                    { onConflict: "document_id" },
                )
                .select(SHARE_SELECT)
                .single<ShareRow>();

            if (error) {
                throw new Error(`Failed to publish share: ${error.message}`);
            }

            return mapShare(data);
        },

        async disableReadonlyShare(documentId: string): Promise<ReadonlyShare | null> {
            const { error } = await client.from("shares").delete().eq("document_id", documentId);

            if (error) {
                throw new Error(`Failed to disable share: ${error.message}`);
            }

            return null;
        },
    };
}
