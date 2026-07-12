/**
 * webPreviewSupport.ts — Schema-correct Supabase setup for the real-browser Omni Web Preview
 * test. It supports a local stack or dedicated hosted test project. Data goes through the same
 * PostgREST tables the desktop publisher uses; reads use the landing server and public RPC.
 */
import type { SerializedAnnotation } from "@quillium/share";
import { annotationField, versionGroupField } from "@quillium/share/core";
import { serializeAnnotations } from "../../desktop/src/lib/collab/sharePayload";
import {
    VISUAL_FIXTURE_TIME,
    buildFixtureState,
    buildVisualFixtureState,
    serializeFixtureWire,
} from "./fixtures";

export type WebPreviewSeed = {
    userId: string;
    modernToken: string;
    legacyToken: string;
    disabledToken: string;
    visualModernToken: string;
    visualLegacyToken: string;
    title: string;
    visualTitle: string;
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

function toPrePublishedStateAnnotations(
    annotations: SerializedAnnotation[],
): SerializedAnnotation[] {
    return annotations.map((annotation) => {
        if (annotation.type !== "revision") return annotation;
        return {
            ...annotation,
            versions: annotation.versions.map((version) => ({
                index: version.index,
                text: version.text,
                ...(version.label ? { label: version.label } : {}),
                annotations: toPrePublishedStateAnnotations(version.annotations),
            })),
        };
    });
}

/** Create one owner plus modern, legacy, and disabled public-share rows. */
export async function seedWebPreview(config: SupabaseSeedConfig): Promise<WebPreviewSeed> {
    const runId = crypto.randomUUID();
    const authorName = "Omni E2E Author";
    let userId: string | undefined;

    try {
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
        userId = userPayload.id ?? userPayload.user?.id;
        if (!userId) throw new Error("Supabase admin create-user response did not include an id");

        const modernDocumentId = crypto.randomUUID();
        const legacyDocumentId = crypto.randomUUID();
        const disabledDocumentId = crypto.randomUUID();
        const visualModernDocumentId = crypto.randomUUID();
        const visualLegacyDocumentId = crypto.randomUUID();
        const modernToken = crypto.randomUUID();
        const legacyToken = crypto.randomUUID();
        const disabledToken = crypto.randomUUID();
        const visualModernToken = crypto.randomUUID();
        const visualLegacyToken = crypto.randomUUID();
        const title = "Omni browser round-trip";
        const visualTitle = "The Lantern Archive";
        const excerpt = "A real landing route backed by the local public-share RPC.";
        const publishedAt = "2026-07-09T12:34:56.000Z";
        const { state } = buildFixtureState();
        // Exercise the same flat producer used by GoLiveButton's fallback payload,
        // then remove metadata that did not exist before published_state.
        const flat = {
            content: state.doc.toString(),
            annotations: serializeAnnotations(
                state.doc.toString(),
                state.field(annotationField),
                state.field(versionGroupField),
            ),
        };
        const legacyAnnotations = toPrePublishedStateAnnotations(flat.annotations);
        const { state: visualState } = buildVisualFixtureState();
        const visualFlat = {
            content: visualState.doc.toString(),
            annotations: serializeAnnotations(
                visualState.doc.toString(),
                visualState.field(annotationField),
                visualState.field(versionGroupField),
            ),
        };
        const visualLegacyAnnotations = toPrePublishedStateAnnotations(visualFlat.annotations);

        await postRows(config, "sync_documents", [
            { id: modernDocumentId, owner_id: userId, title },
            { id: legacyDocumentId, owner_id: userId, title: `${title} (legacy)` },
            { id: disabledDocumentId, owner_id: userId, title: `${title} (disabled)` },
            { id: visualModernDocumentId, owner_id: userId, title: visualTitle },
            {
                id: visualLegacyDocumentId,
                owner_id: userId,
                title: `${visualTitle} (legacy)`,
            },
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
                published_annotations: legacyAnnotations,
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
            {
                document_id: visualModernDocumentId,
                share_token: visualModernToken,
                enabled: true,
                permission: "read",
                published_title: visualTitle,
                preview_text: visualFlat.content.slice(0, 160),
                published_content: visualFlat.content,
                published_annotations: visualFlat.annotations,
                published_state: serializeFixtureWire(visualState),
                author_name: authorName,
                published_at: new Date(VISUAL_FIXTURE_TIME).toISOString(),
            },
            {
                document_id: visualLegacyDocumentId,
                share_token: visualLegacyToken,
                enabled: true,
                permission: "read",
                published_title: `${visualTitle} (legacy)`,
                preview_text: visualFlat.content.slice(0, 160),
                published_content: visualFlat.content,
                published_annotations: visualLegacyAnnotations,
                published_state: null,
                author_name: authorName,
                published_at: new Date(VISUAL_FIXTURE_TIME).toISOString(),
            },
        ]);

        return {
            userId,
            modernToken,
            legacyToken,
            disabledToken,
            visualModernToken,
            visualLegacyToken,
            title,
            visualTitle,
            excerpt,
            authorName,
            content: flat.content,
        };
    } catch (error) {
        if (userId) {
            try {
                await cleanupWebPreview(config, userId);
            } catch (cleanupError) {
                throw new AggregateError(
                    [error, cleanupError],
                    "Web Preview seeding and fixture cleanup both failed",
                );
            }
        }
        throw error;
    }
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
