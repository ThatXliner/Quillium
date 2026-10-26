import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { type SupabaseClient, type User, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createResendInvitationSender, createTestInvitationSink } from "./email.js";
import { CreateGrantSchema, LiveRoomAccessService } from "./grants.js";
import { createAccessHttpHandler } from "./http.js";

const url = process.env.E2E_SUPABASE_URL;
const serviceKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
const publishableKey =
    process.env.E2E_SUPABASE_PUBLISHABLE_KEY ?? process.env.E2E_SUPABASE_ANON_KEY;
const configured = Boolean(url && serviceKey && publishableKey);
if (process.env.E2E_ACCESS_REQUIRED === "1" && !configured)
    throw new Error("Local Supabase credentials required");
if (url && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) {
    throw new Error("Grant tests may run only against a local disposable Supabase stack");
}

describe("invitation input and transport", () => {
    it("accepts only invitation roles and rejects privilege-shaped extra fields", () => {
        expect(CreateGrantSchema.safeParse({ role: "owner" }).success).toBe(false);
        expect(
            CreateGrantSchema.safeParse({ role: "viewer", created_by: randomUUID() }).success,
        ).toBe(false);
        expect(CreateGrantSchema.parse({ role: "commenter", email: "WRITER@example.com" })).toEqual(
            {
                role: "commenter",
                email: "writer@example.com",
            },
        );
    });

    it("keeps local invitations in the test sink", async () => {
        const sink = createTestInvitationSink();
        const invitation = {
            to: "writer@example.com",
            joinUrl: "quillium://join/test",
            role: "viewer" as const,
            expiresAt: "2026-12-01T00:00:00Z",
        };
        await sink.send(invitation);
        expect(sink.invitations).toEqual([invitation]);
    });

    it("reports transport failures instead of claiming delivery", async () => {
        const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 503 }));
        const sender = createResendInvitationSender({
            apiKey: "test",
            from: "test@example.com",
            fetch: request,
        });
        await expect(
            sender.send({
                to: "writer@example.com",
                joinUrl: "quillium://join/test",
                role: "viewer",
                expiresAt: "2026-12-01T00:00:00Z",
            }),
        ).rejects.toThrow("delivery failed");
        expect(request).toHaveBeenCalledTimes(1);
    });
});

describe.skipIf(!configured)("Live Room grants on real local Supabase", () => {
    let admin: SupabaseClient;
    let owner: User;
    let stranger: User;
    let invitee: User;
    let anonymous: User;
    let ownerClient: SupabaseClient;
    let strangerClient: SupabaseClient;
    let ownerToken: string;
    let strangerToken: string;
    let documentId: string;
    let otherDocumentId: string;
    let clock = Date.now();
    const onGrantChanged = vi.fn();
    const sink = createTestInvitationSink();
    let service: LiveRoomAccessService;
    const users: string[] = [];

    beforeAll(async () => {
        if (!url || !serviceKey || !publishableKey)
            throw new Error("Missing local test credentials");
        admin = createClient(url, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
        async function userFixture(): Promise<{
            user: User;
            client: SupabaseClient;
            token: string;
        }> {
            const email = `grant-${randomUUID()}@example.test`;
            const password = randomUUID();
            const result = await admin.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
            });
            if (result.error || !result.data.user)
                throw result.error ?? new Error("Missing created user");
            users.push(result.data.user.id);
            const client = createClient(url ?? "", publishableKey ?? "", {
                auth: { persistSession: false, autoRefreshToken: false },
            });
            const signedIn = await client.auth.signInWithPassword({ email, password });
            if (signedIn.error || !signedIn.data.session)
                throw signedIn.error ?? new Error("Missing local session");
            return { user: result.data.user, client, token: signedIn.data.session.access_token };
        }
        ({ user: owner, client: ownerClient, token: ownerToken } = await userFixture());
        ({ user: stranger, client: strangerClient, token: strangerToken } = await userFixture());
        ({ user: invitee } = await userFixture());
        const anonymousClient = createClient(url, publishableKey, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
        const guest = await anonymousClient.auth.signInAnonymously();
        if (guest.error || !guest.data.user)
            throw guest.error ?? new Error("Anonymous authentication unavailable");
        anonymous = guest.data.user;
        users.push(anonymous.id);
        documentId = randomUUID();
        otherDocumentId = randomUUID();
        const inserted = await admin.from("sync_documents").insert([
            { id: documentId, owner_id: owner.id, title: "Grant boundary test" },
            { id: otherDocumentId, owner_id: stranger.id, title: "Unrelated document" },
        ]);
        if (inserted.error) throw inserted.error;
        service = new LiveRoomAccessService({
            supabase: admin,
            onGrantChanged,
            email: sink,
            now: () => clock,
        });
    }, 30_000);

    afterAll(async () => {
        if (admin) {
            await admin.from("sync_documents").delete().in("id", [documentId, otherDocumentId]);
            for (const id of users) await admin.auth.admin.deleteUser(id);
        }
    });

    it.each(["viewer", "commenter", "editor"] as const)(
        "creates and resolves a %s link for anonymous guests",
        async (role) => {
            const created = await service.create(owner, documentId, { role });
            expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
            expect(created.joinUrl).toBe(`quillium://join/${created.token}`);
            expect(await service.resolve(created.token, anonymous)).toEqual({
                documentId,
                grantId: created.grant.id,
                role,
                expiresAt: created.grant.expires_at,
            });
            const stored = await admin
                .from("live_room_grants")
                .select("token_hash")
                .eq("id", created.grant.id)
                .single();
            expect(stored.error).toBeNull();
            expect(stored.data?.token_hash).toMatch(/^[0-9a-f]{64}$/);
            expect(JSON.stringify(stored.data)).not.toContain(created.token);
        },
    );

    it("rejects owner impersonation and cross-document grant mutations", async () => {
        const created = await service.create(owner, documentId, { role: "viewer" });
        await expect(
            service.create(stranger, documentId, { role: "editor" }),
        ).rejects.toMatchObject({ code: "insufficient_permission" });
        await expect(service.list(stranger, documentId)).rejects.toMatchObject({
            code: "insufficient_permission",
        });
        await expect(
            service.changeRole(stranger, documentId, created.grant.id, "editor"),
        ).rejects.toMatchObject({ code: "insufficient_permission" });
        await expect(service.revoke(stranger, documentId, created.grant.id)).rejects.toMatchObject({
            code: "insufficient_permission",
        });
        await expect(
            service.revoke(stranger, otherDocumentId, created.grant.id),
        ).rejects.toMatchObject({ code: "invalid_invitation" });
        await expect(
            service.resolve(created.token, stranger, otherDocumentId),
        ).rejects.toMatchObject({ code: "invalid_invitation" });
        expect((await service.resolve(created.token, stranger)).role).toBe("viewer");
    });

    it("forbids direct table writes and hides invitation hashes from authenticated clients", async () => {
        const created = await service.create(owner, documentId, { role: "viewer" });
        const ownerRead = await ownerClient
            .from("live_room_grants")
            .select("id,role")
            .eq("id", created.grant.id);
        expect(ownerRead.error).toBeNull();
        expect(ownerRead.data).toEqual([{ id: created.grant.id, role: "viewer" }]);
        const strangerRead = await strangerClient
            .from("live_room_grants")
            .select("id,role")
            .eq("id", created.grant.id);
        expect(strangerRead.error).toBeNull();
        expect(strangerRead.data).toEqual([]);
        expect(
            (await ownerClient.from("live_room_grants").select("token_hash")).error,
        ).not.toBeNull();
        expect(
            (
                await ownerClient
                    .from("live_room_grants")
                    .update({ role: "editor" })
                    .eq("id", created.grant.id)
            ).error,
        ).not.toBeNull();
        expect(
            (
                await strangerClient
                    .from("live_room_grants")
                    .update({ created_by: stranger.id, document_id: otherDocumentId })
                    .eq("id", created.grant.id)
            ).error,
        ).not.toBeNull();
        expect(
            (await ownerClient.from("live_room_grants").delete().eq("id", created.grant.id)).error,
        ).not.toBeNull();
        expect((await service.resolve(created.token, stranger)).role).toBe("viewer");
    });

    it("delivers an email link to the test sink and requires the confirmed invited email", async () => {
        if (!invitee.email) throw new Error("Invitee has no email");
        const created = await service.create(owner, documentId, {
            role: "commenter",
            email: invitee.email.toUpperCase(),
        });
        expect(sink.invitations.at(-1)).toMatchObject({
            to: invitee.email,
            joinUrl: created.joinUrl,
            role: "commenter",
        });
        expect(created.grant.delivery_status).toBe("sent");
        expect((await service.resolve(created.token, invitee)).role).toBe("commenter");
        await expect(service.resolve(created.token, stranger)).rejects.toMatchObject({
            code: "insufficient_permission",
        });
        await expect(service.resolve(created.token, anonymous)).rejects.toMatchObject({
            code: "insufficient_permission",
        });
        await expect(
            service.resolve(created.token, { ...invitee, email_confirmed_at: undefined }),
        ).rejects.toMatchObject({ code: "insufficient_permission" });
    });

    it("revokes failed email deliveries and never reports them as sent", async () => {
        const failing = new LiveRoomAccessService({
            supabase: admin,
            onGrantChanged,
            email: {
                async send() {
                    throw new Error("Local transport failure");
                },
            },
        });
        await expect(
            failing.create(owner, documentId, { role: "viewer", email: "failed@example.test" }),
        ).rejects.toMatchObject({ code: "delivery_failed" });
        const failed = (await service.list(owner, documentId)).find(
            (grant) => grant.invited_email === "failed@example.test",
        );
        expect(failed).toMatchObject({ delivery_status: "failed", revoked_at: expect.any(String) });
    });

    it("changes a role and revokes a token before the mutation promise resolves", async () => {
        const created = await service.create(owner, documentId, { role: "editor" });
        onGrantChanged.mockClear();
        await service.changeRole(owner, documentId, created.grant.id, "viewer");
        expect(onGrantChanged).toHaveBeenLastCalledWith(documentId, created.grant.id);
        expect((await service.resolve(created.token, stranger)).role).toBe("viewer");
        await service.revoke(owner, documentId, created.grant.id);
        expect(onGrantChanged).toHaveBeenCalledTimes(2);
        await expect(service.resolve(created.token, stranger)).rejects.toMatchObject({
            code: "revoked_invitation",
        });
    });

    it("replaces only active link tokens and invalidates the old token", async () => {
        const created = await service.create(owner, documentId, { role: "commenter" });
        await expect(
            service.replaceLink(stranger, documentId, created.grant.id),
        ).rejects.toMatchObject({ code: "insufficient_permission" });
        onGrantChanged.mockClear();
        const replaced = await service.replaceLink(owner, documentId, created.grant.id);
        expect(replaced.token).not.toBe(created.token);
        expect(replaced.grant.id).toBe(created.grant.id);
        expect(replaced.grant.role).toBe("commenter");
        expect(onGrantChanged).toHaveBeenCalledWith(documentId, created.grant.id);
        await expect(service.resolve(created.token, anonymous)).rejects.toMatchObject({
            code: "invalid_invitation",
        });
        expect((await service.resolve(replaced.token, anonymous)).role).toBe("commenter");
        await service.revoke(owner, documentId, created.grant.id);
        await expect(
            service.replaceLink(owner, documentId, created.grant.id),
        ).rejects.toMatchObject({ code: "revoked_invitation" });
        if (!invitee.email) throw new Error("Invitee has no email");
        const email = await service.create(owner, documentId, {
            role: "viewer",
            email: invitee.email,
        });
        await expect(service.replaceLink(owner, documentId, email.grant.id)).rejects.toMatchObject({
            code: "invalid_request",
        });
    });

    it("rejects malformed, unknown, expired, and non-future invitation tokens", async () => {
        await expect(service.resolve("bad", anonymous)).rejects.toMatchObject({
            code: "invalid_invitation",
        });
        await expect(service.resolve("a".repeat(43), anonymous)).rejects.toMatchObject({
            code: "invalid_invitation",
        });
        const created = await service.create(owner, documentId, {
            role: "viewer",
            expiresAt: new Date(clock + 60_000).toISOString(),
        });
        clock += 61_000;
        await expect(service.resolve(created.token, anonymous)).rejects.toMatchObject({
            code: "expired_invitation",
        });
        await expect(
            service.create(owner, documentId, {
                role: "viewer",
                expiresAt: new Date(clock - 1).toISOString(),
            }),
        ).rejects.toMatchObject({ code: "invalid_request" });
        clock = Date.now();
    });

    it("verifies sessions and ownership at the actual HTTP boundary", async () => {
        const handler = createAccessHttpHandler({ supabase: admin, service });
        const server = createServer((req, res) => {
            void handler(req, res);
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/access/documents/${documentId}/grants`;
        try {
            expect((await fetch(endpoint)).status).toBe(401);
            expect(
                (await fetch(endpoint, { headers: { Authorization: "Bearer fabricated" } })).status,
            ).toBe(401);
            expect(
                (await fetch(endpoint, { headers: { Authorization: `Bearer ${strangerToken}` } }))
                    .status,
            ).toBe(403);
            const created = await fetch(endpoint, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${ownerToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ role: "viewer" }),
            });
            expect(created.status).toBe(201);
            const payload = await created.json();
            expect(payload.grant.role).toBe("viewer");
            expect(JSON.stringify(payload)).not.toContain("token_hash");
            const escalation = await fetch(`${endpoint}/${payload.grant.id}`, {
                method: "PATCH",
                headers: {
                    Authorization: `Bearer ${strangerToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ role: "editor" }),
            });
            expect(escalation.status).toBe(403);
        } finally {
            await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve())),
            );
        }
    });
});
