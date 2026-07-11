/**
 * webPreviewSupport.ts — Schema-correct local Supabase setup for the real-browser
 * Omni Web Preview test. Data goes through the same PostgREST tables the desktop
 * publisher uses, while page reads go through the landing server and public RPC.
 */
import { annotationField, versionGroupField } from "@quillium/share/core";
import { serializeAnnotations } from "../../desktop/src/lib/collab/sharePayload";
import { buildFixtureState, serializeFixtureWire } from "./fixtures";

export type WebPreviewSeed = {
    userId: string;
    modernToken: string;
    legacyToken: string;
    disabledToken: string;
    title: string;
    excerpt: string;
    authorName: string;
    content: string;
};

type SupabaseSeedConfig = {
    url: string;
    serviceRoleKey: string;
};

function adminHeaders(config: SupabaseSeedConfig): HeadersInit {
    return {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
        "Content-Type": "application/json",
    };
}

async function checkedFetch(url: string, init: RequestInit, operation: string): Promise<Response> {
    const response = await fetch(url, init);
    if (response.ok) return response;

    const detail = await response.text();
    throw new Error(`${operation} failed (${response.status}): ${detail}`);
}

async function postRows(
    config: SupabaseSeedConfig,
    table: "sync_documents" | "shares",
    rows: Record<string, unknown>[],
): Promise<void> {
    await checkedFetch(
        `${config.url}/rest/v1/${table}`,
        {
            method: "POST",
            headers: {
                ...adminHeaders(config),
                Prefer: "return=minimal",
            },
            body: JSON.stringify(rows),
        },
        `insert ${table}`,
    );
}

/** Create one owner plus modern, legacy, and disabled public-share rows. */
export async function seedWebPreview(config: SupabaseSeedConfig): Promise<WebPreviewSeed> {
    const runId = crypto.randomUUID();
    const authorName = "Omni E2E Author";
    const userResponse = await checkedFetch(
        `${config.url}/auth/v1/admin/users`,
        {
            method: "POST",
            headers: adminHeaders(config),
            body: JSON.stringify({
                email: `omni-web-preview-${runId}@example.test`,
                password: `E2e-${runId}!`,
                email_confirm: true,
                user_metadata: { display_name: authorName },
            }),
        },
        "create test owner",
    );
    const userPayload = (await userResponse.json()) as {
        id?: string;
        user?: { id?: string };
    };
    const userId = userPayload.id ?? userPayload.user?.id;
    if (!userId) throw new Error("Supabase admin create-user response did not include an id");

    const modernDocumentId = crypto.randomUUID();
    const legacyDocumentId = crypto.randomUUID();
    const disabledDocumentId = crypto.randomUUID();
    const modernToken = crypto.randomUUID();
    const legacyToken = crypto.randomUUID();
    const disabledToken = crypto.randomUUID();
    const title = "Omni browser round-trip";
    const excerpt = "A real landing route backed by the local public-share RPC.";
    const publishedAt = "2026-07-09T12:34:56.000Z";
    const { state } = buildFixtureState();
    // Exercise the same flat producer used by GoLiveButton's fallback payload,
    // not a test-only projection that could preserve more metadata than desktop.
    const flat = {
        content: state.doc.toString(),
        annotations: serializeAnnotations(
            state.doc.toString(),
            state.field(annotationField),
            state.field(versionGroupField),
        ),
    };

    try {
        await postRows(config, "sync_documents", [
            { id: modernDocumentId, owner_id: userId, title },
            { id: legacyDocumentId, owner_id: userId, title: `${title} (legacy)` },
            { id: disabledDocumentId, owner_id: userId, title: `${title} (disabled)` },
        ]);
        await postRows(config, "shares", [
            {
                document_id: modernDocumentId,
                share_token: modernToken,
                enabled: true,
                permission: "read",
                published_title: title,
                preview_text: excerpt,
                published_content: flat.content,
                published_annotations: flat.annotations,
                published_state: serializeFixtureWire(state),
                author_name: authorName,
                published_at: publishedAt,
            },
            {
                document_id: legacyDocumentId,
                share_token: legacyToken,
                enabled: true,
                permission: "read",
                published_title: `${title} (legacy)`,
                preview_text: excerpt,
                published_content: flat.content,
                published_annotations: flat.annotations,
                published_state: null,
                author_name: authorName,
                published_at: publishedAt,
            },
            {
                document_id: disabledDocumentId,
                share_token: disabledToken,
                enabled: false,
                permission: "read",
                published_title: `${title} (disabled)`,
                preview_text: excerpt,
                published_content: flat.content,
                published_annotations: flat.annotations,
                published_state: serializeFixtureWire(state),
                author_name: authorName,
                published_at: publishedAt,
            },
        ]);
    } catch (error) {
        await cleanupWebPreview(config, userId).catch(() => undefined);
        throw error;
    }

    return {
        userId,
        modernToken,
        legacyToken,
        disabledToken,
        title,
        excerpt,
        authorName,
        content: flat.content,
    };
}

/** Deleting the auth owner cascades through users → sync_documents → shares. */
export async function cleanupWebPreview(config: SupabaseSeedConfig, userId: string): Promise<void> {
    await checkedFetch(
        `${config.url}/auth/v1/admin/users/${userId}`,
        {
            method: "DELETE",
            headers: adminHeaders(config),
        },
        "delete test owner",
    );
}
