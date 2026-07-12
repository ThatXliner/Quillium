/**
 * supabaseContract.test.ts — Exercises the production Omni Web Preview share
 * repository against a migrated Supabase stack, including authenticated RLS
 * writes and the anonymous public-read boundary.
 *
 * The suite is skipped unless these credentials are present:
 *   E2E_SUPABASE_URL
 *   E2E_SUPABASE_SERVICE_ROLE_KEY
 *   E2E_SUPABASE_ANON_KEY (or E2E_SUPABASE_PUBLISHABLE_KEY)
 */
import { randomUUID } from "node:crypto";
import type { SerializedAnnotation } from "@quillium/share";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createShareRepository } from "../../desktop/src/lib/collab/shareRepository";
import { buildFixtureState, serializeFixtureWire } from "./fixtures";

const SUPABASE_URL = process.env.E2E_SUPABASE_URL?.replace(/\/$/, "");
const SERVICE_ROLE_KEY = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
const PUBLIC_KEY = process.env.E2E_SUPABASE_ANON_KEY ?? process.env.E2E_SUPABASE_PUBLISHABLE_KEY;
const enabled = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && PUBLIC_KEY);

type PublicShareRow = {
    published_title: string;
    preview_text: string;
    published_content: string;
    published_annotations: SerializedAnnotation[] | null;
    published_state: Record<string, unknown> | null;
    author_name: string | null;
    published_at: string | null;
};

function createTestClient(key: string): SupabaseClient {
    return createClient(SUPABASE_URL as string, key, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
        },
    });
}

async function loadPublicShare(client: SupabaseClient, token: string): Promise<PublicShareRow[]> {
    const { data, error } = await client.rpc("get_public_share_by_token", {
        p_share_token: token,
    });
    if (error) throw new Error(`Failed to load public share: ${error.message}`);
    return (data ?? []) as PublicShareRow[];
}

async function cleanupBestEffort(
    admin: SupabaseClient,
    authenticated: SupabaseClient,
    documentId: string,
    userId: string | undefined,
): Promise<void> {
    await Promise.allSettled([
        admin.from("shares").delete().eq("document_id", documentId),
        admin.from("sync_documents").delete().eq("id", documentId),
    ]);

    // Deleting a user does not revoke an issued access token, so revoke the
    // session first. The user deletion then cascades through its profile and
    // any owner-scoped rows that survived the explicit cleanup above.
    await authenticated.auth.signOut({ scope: "global" }).catch(() => undefined);
    if (userId) {
        await admin.auth.admin.deleteUser(userId, false).catch(() => undefined);
    }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe.skipIf(!enabled)("Supabase Omni Web Preview contract", () => {
    it("runs the production publish/get/disable path across RLS and the public RPC", async () => {
        const admin = createTestClient(SERVICE_ROLE_KEY as string);
        const authenticated = createTestClient(PUBLIC_KEY as string);
        const publicClient = createTestClient(PUBLIC_KEY as string);
        const repository = createShareRepository(authenticated);
        const documentId = randomUUID();
        const email = `omni-web-preview-${randomUUID()}@example.test`;
        const password = `E2e-${randomUUID()}!`;
        let userId: string | undefined;

        try {
            const { data: created, error: createError } = await admin.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
                user_metadata: { display_name: "Omni E2E Author" },
            });
            expect(createError).toBeNull();
            expect(created.user).not.toBeNull();
            userId = created.user?.id;
            if (!userId) throw new Error("Supabase did not return the created test user");

            const { data: signedIn, error: signInError } =
                await authenticated.auth.signInWithPassword({ email, password });
            expect(signInError).toBeNull();
            expect(signedIn.user?.id).toBe(userId);

            // The auth trigger creates public.users. Reading and updating it as
            // the signed-in user exercises the profile SELECT/UPDATE policies.
            const { data: profiles, error: profileError } = await authenticated
                .from("users")
                .select("id, display_name")
                .eq("id", userId);
            expect(profileError).toBeNull();
            expect(profiles).toEqual([{ id: userId, display_name: "Omni E2E Author" }]);

            const { data: updatedProfiles, error: profileUpdateError } = await authenticated
                .from("users")
                .update({ display_name: "Omni E2E Author" })
                .eq("id", userId)
                .select("id, display_name");
            expect(profileUpdateError).toBeNull();
            expect(updatedProfiles).toEqual(profiles);

            // `authenticated` alone is not authorization: the document owner
            // must match auth.uid().
            const forgedOwner = await authenticated.from("sync_documents").insert({
                id: randomUUID(),
                owner_id: randomUUID(),
                title: "Not mine",
            });
            expect(forgedOwner.status).toBe(403);
            expect(forgedOwner.error).not.toBeNull();

            const { state } = buildFixtureState();
            const wire = serializeFixtureWire(state);
            const annotations: SerializedAnnotation[] = [
                {
                    id: "3",
                    type: "comment",
                    from: 0,
                    to: 3,
                    selectedText: "The",
                    thread: [{ author: "Reviewer", message: "Strong opener.", time: 1 }],
                },
            ];

            // This is the exact repository call made by the desktop wrapper.
            const published = await repository.publishReadonlyShare({
                documentId,
                ownerId: userId,
                title: "E2E fixture",
                content: state.doc.toString(),
                annotations,
                state: wire,
                authorName: "Omni E2E Author",
            });
            expect(published.shareToken).toMatch(UUID_PATTERN);
            expect(published).toMatchObject({
                enabled: true,
                publishedTitle: "E2E fixture",
                previewText: "The quick brown fox",
                publishedContent: state.doc.toString(),
                publishedAnnotations: annotations,
                publishedState: wire,
                authorName: "Omni E2E Author",
            });
            expect(published.publishedAt).not.toBeNull();

            const ownerVisibleShare = await repository.getReadonlyShare(documentId);
            expect(ownerVisibleShare).toEqual(published);

            const { data: registeredDocument, error: registeredDocumentError } = await authenticated
                .from("sync_documents")
                .select("id, owner_id, title")
                .eq("id", documentId)
                .single();
            expect(registeredDocumentError).toBeNull();
            expect(registeredDocument).toEqual({
                id: documentId,
                owner_id: userId,
                title: "E2E fixture",
            });

            // Anonymous callers cannot query the table directly; only the
            // narrow SECURITY DEFINER RPC exposes enabled snapshots.
            const directAnonRead = await publicClient
                .from("shares")
                .select("document_id")
                .eq("document_id", documentId);
            expect([401, 403]).toContain(directAnonRead.status);
            expect(directAnonRead.error).not.toBeNull();

            const initialPublicRows = await loadPublicShare(publicClient, published.shareToken);
            expect(initialPublicRows).toHaveLength(1);
            expect(initialPublicRows[0]).toMatchObject({
                published_title: published.publishedTitle,
                preview_text: published.previewText,
                published_content: published.publishedContent,
                published_annotations: annotations,
                published_state: wire,
                author_name: published.authorName,
                published_at: published.publishedAt,
            });

            const updatedState = state.update({
                changes: { from: state.doc.length, insert: "!" },
            }).state;
            const updatedWire = serializeFixtureWire(updatedState);
            const updatedAnnotations: SerializedAnnotation[] = [
                {
                    ...annotations[0],
                    thread: [
                        ...annotations[0].thread,
                        { author: "Author", message: "Thank you.", time: 2 },
                    ],
                },
            ];

            const republished = await repository.publishReadonlyShare({
                documentId,
                ownerId: userId,
                title: "Republished fixture",
                content: updatedState.doc.toString(),
                annotations: updatedAnnotations,
                state: updatedWire,
                authorName: "Omni E2E Author",
            });
            expect(republished.shareToken).toBe(published.shareToken);
            expect(await repository.getReadonlyShare(documentId)).toEqual(republished);

            const updatedPublicRows = await loadPublicShare(publicClient, published.shareToken);
            expect(updatedPublicRows).toHaveLength(1);
            expect(updatedPublicRows[0]).toMatchObject({
                published_title: "Republished fixture",
                preview_text: "The quick brown fox!",
                published_content: updatedState.doc.toString(),
                published_annotations: updatedAnnotations,
                published_state: updatedWire,
                author_name: "Omni E2E Author",
                published_at: republished.publishedAt,
            });

            const { data: disabled, error: disableFlagError } = await authenticated
                .from("shares")
                .update({ enabled: false })
                .eq("document_id", documentId)
                .select("enabled")
                .single<{ enabled: boolean }>();
            expect(disableFlagError).toBeNull();
            expect(disabled?.enabled).toBe(false);
            expect(await loadPublicShare(publicClient, published.shareToken)).toEqual([]);

            const { error: reenableError } = await authenticated
                .from("shares")
                .update({ enabled: true })
                .eq("document_id", documentId);
            expect(reenableError).toBeNull();
            expect(await loadPublicShare(publicClient, published.shareToken)).toHaveLength(1);

            // Desktop's "disable" operation deletes the share. Verify both the
            // owner repository and public RPC can no longer observe it.
            expect(await repository.disableReadonlyShare(documentId)).toBeNull();
            expect(await repository.getReadonlyShare(documentId)).toBeNull();
            expect(await loadPublicShare(publicClient, published.shareToken)).toEqual([]);
        } finally {
            await cleanupBestEffort(admin, authenticated, documentId, userId);
        }
    }, 30_000);
});
