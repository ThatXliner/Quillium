import { getCurrentUserName } from "$lib/auth/auth.svelte";
import { supabase } from "$lib/auth/supabase";
import { writable } from "svelte/store";
import {
    type ReadonlyShareTab,
    type SerializedAnnotation,
    decodeReadonlySharePayload,
    encodeReadonlySharePayload,
    getActiveReadonlyShareTab,
} from "./sharePayload";

const SHARE_BASE_URL = "https://quillium.bryanhu.com/share";

export type ReadonlyShare = {
    shareToken: string;
    enabled: boolean;
    publishedTitle: string;
    previewText: string;
    publishedContent: string;
    publishedAnnotations: SerializedAnnotation[];
    publishedTabs: ReadonlyShareTab[];
    publishedActiveTabId: string | null;
    authorName: string | null;
    publishedAt: string | null;
    updatedAt: string;
};

export const readonlyShareState = writable<ReadonlyShare | null>(null);

type ShareRow = {
    share_token: string;
    enabled: boolean;
    published_title: string;
    preview_text: string;
    published_content: string;
    published_annotations: SerializedAnnotation[] | null;
    author_name: string | null;
    published_at: string | null;
    updated_at: string;
};

type PublishReadonlyShareInput = {
    documentId: string;
    ownerId: string;
    title: string;
    activeTabId: string | null;
    tabs: ReadonlyShareTab[];
};

function requireSupabase() {
    if (!supabase) {
        throw new Error("Supabase not configured");
    }
    return supabase;
}

function mapShare(row: ShareRow): ReadonlyShare {
    const decoded = decodeReadonlySharePayload(row.published_content, row.published_annotations);

    return {
        shareToken: row.share_token,
        enabled: row.enabled,
        publishedTitle: row.published_title,
        previewText: row.preview_text,
        publishedContent: decoded.content,
        publishedAnnotations: decoded.annotations,
        publishedTabs: decoded.tabs,
        publishedActiveTabId: decoded.activeTabId,
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

async function registerSyncDocument(documentId: string, ownerId: string, title: string) {
    const client = requireSupabase();
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

export async function getReadonlyShare(documentId: string): Promise<ReadonlyShare | null> {
    const client = requireSupabase();
    const { data, error } = await client
        .from("shares")
        .select(
            "share_token, enabled, published_title, preview_text, published_content, published_annotations, author_name, published_at, updated_at",
        )
        .eq("document_id", documentId)
        .maybeSingle<ShareRow>();

    if (error) {
        throw new Error(`Failed to load share: ${error.message}`);
    }

    return data ? mapShare(data) : null;
}

export async function publishReadonlyShare(
    input: PublishReadonlyShareInput,
): Promise<ReadonlyShare> {
    const client = requireSupabase();
    await registerSyncDocument(input.documentId, input.ownerId, input.title);

    const activeTab = getActiveReadonlyShareTab(input.tabs, input.activeTabId);
    const publishedContent = encodeReadonlySharePayload({
        activeTabId: activeTab?.id ?? null,
        tabs: input.tabs,
    });
    const previewSource = input.tabs.map((tab) => tab.content).join("\n\n");

    const { data, error } = await client
        .from("shares")
        .upsert(
            {
                document_id: input.documentId,
                enabled: true,
                permission: "read",
                published_title: input.title.trim() || "Untitled",
                preview_text: buildSharePreviewText(previewSource),
                published_content: publishedContent,
                published_annotations: activeTab?.annotations ?? [],
                author_name: getCurrentUserName(),
                published_at: new Date().toISOString(),
            },
            { onConflict: "document_id" },
        )
        .select(
            "share_token, enabled, published_title, preview_text, published_content, published_annotations, author_name, published_at, updated_at",
        )
        .single<ShareRow>();

    if (error) {
        throw new Error(`Failed to publish share: ${error.message}`);
    }

    return mapShare(data);
}

export async function disableReadonlyShare(documentId: string): Promise<ReadonlyShare | null> {
    const client = requireSupabase();
    const { error } = await client.from("shares").delete().eq("document_id", documentId);

    if (error) {
        throw new Error(`Failed to disable share: ${error.message}`);
    }

    return null;
}
