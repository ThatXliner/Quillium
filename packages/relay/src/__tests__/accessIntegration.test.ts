import { randomUUID } from "node:crypto";
import {
    CUSTOM_ACCESS,
    CUSTOM_COMMENT_RESULT,
    type CommentCommand,
    type LiveRole,
    decodeCustomMessage,
    encodeCommentCommand,
} from "@quillium/share/collab-contract";
import { type SupabaseClient, type User, createClient } from "@supabase/supabase-js";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type RawData, WebSocket } from "ws";
import * as sync from "y-protocols/sync";
import * as Y from "yjs";
import { z } from "zod";
import { createTestInvitationSink } from "../access/email.js";

const url = process.env.E2E_SUPABASE_URL;
const serviceKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
const publicKey = process.env.E2E_SUPABASE_PUBLISHABLE_KEY ?? process.env.E2E_SUPABASE_ANON_KEY;
const configured = Boolean(url && serviceKey && publicKey);
if (process.env.E2E_ACCESS_REQUIRED === "1" && !configured)
    throw new Error("Local Supabase credentials required");
if (url && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname))
    throw new Error("Access integration tests require disposable loopback Supabase");

const createdSchema = z.object({
    grant: z.object({ id: z.uuid(), role: z.enum(["viewer", "commenter", "editor"]) }),
    token: z.string(),
    joinUrl: z.string(),
});
type Actor = { user: User; token: string };
type Peer = { ws: WebSocket; messages: Uint8Array[] };

function bytes(data: RawData): Uint8Array {
    return data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : Buffer.isBuffer(data)
          ? new Uint8Array(data)
          : new Uint8Array(Buffer.concat(data));
}

function updateFrame(update: Uint8Array, step2 = false): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    encoding.writeVarUint(encoder, step2 ? sync.messageYjsSyncStep2 : sync.messageYjsUpdate);
    encoding.writeVarUint8Array(encoder, update);
    return encoding.toUint8Array(encoder);
}

function custom(peer: Peer, subtype: number) {
    for (const data of peer.messages) {
        const decoder = decoding.createDecoder(data);
        if (decoding.readVarUint(decoder) !== 3) continue;
        const message = decodeCustomMessage(decoder);
        if (message?.subtype === subtype) return message;
    }
    return undefined;
}

function syncCount(peer: Peer): number {
    return peer.messages.filter((data) => decoding.readVarUint(decoding.createDecoder(data)) === 0)
        .length;
}

async function until(predicate: () => boolean): Promise<void> {
    await vi.waitFor(() => expect(predicate()).toBe(true), { timeout: 4000, interval: 10 });
}

describe.skipIf(!configured)("production relay invitation boundary on real local Supabase", () => {
    let admin: SupabaseClient;
    let owner: Actor;
    let stranger: Actor;
    let invitee: Actor;
    let anonymous: Actor;
    const users: string[] = [];
    const peers: Peer[] = [];
    const sink = createTestInvitationSink();
    let relay: ReturnType<typeof import("../server.js").createRelayServer>;
    let rooms: typeof import("../yjs/rooms.js");
    let persistence: typeof import("../persistence/debouncedUpdates.js");
    let endpoint: string;
    let wsEndpoint: string;
    let documentId: string;
    let seed: Y.Doc;
    let ownerPeer: Peer;

    async function request(
        actor: Actor,
        path: string,
        method = "GET",
        body?: unknown,
    ): Promise<Response> {
        return fetch(`${endpoint}${path}`, {
            method,
            headers: { Authorization: `Bearer ${actor.token}`, "Content-Type": "application/json" },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
    }

    async function grant(role: LiveRole, email?: string) {
        const response = await request(owner, `/access/documents/${documentId}/grants`, "POST", {
            role,
            ...(email ? { email } : {}),
        });
        expect(response.status).toBe(201);
        return createdSchema.parse(await response.json());
    }

    function room() {
        const value = rooms.getYjsRoom(documentId);
        if (!value) throw new Error("Expected live room");
        return value;
    }

    async function connect(actor: Actor, invitation?: string, id = documentId): Promise<Peer> {
        const query = new URLSearchParams({
            auth: actor.token,
            ...(invitation ? { invitation } : {}),
        });
        const peer: Peer = { ws: new WebSocket(`${wsEndpoint}/${id}?${query}`), messages: [] };
        peers.push(peer);
        peer.ws.on("message", (data) => peer.messages.push(bytes(data)));
        peer.ws.on("error", () => {});
        await until(() => !!custom(peer, CUSTOM_ACCESS) || peer.ws.readyState === WebSocket.CLOSED);
        if (peer.ws.readyState === WebSocket.CLOSED)
            throw new Error("Peer rejected before access frame");
        return peer;
    }

    async function rejected(actor: Actor, invitation?: string, id = documentId): Promise<void> {
        const query = new URLSearchParams({
            auth: actor.token,
            ...(invitation ? { invitation } : {}),
        });
        const socket = new WebSocket(`${wsEndpoint}/${id}?${query}`);
        peers.push({ ws: socket, messages: [] });
        let status: number | undefined;
        socket.on("error", () => {});
        socket.on("unexpected-response", (_req, response) => {
            status = response.statusCode;
            response.resume();
            socket.terminate();
        });
        await until(() => status !== undefined || socket.readyState === WebSocket.CLOSED);
        expect(status).toBe(401);
    }

    async function persistedCount(): Promise<number> {
        await persistence.flushDocumentUpdates(documentId);
        const result = await admin
            .from("yjs_updates")
            .select("id", { count: "exact", head: true })
            .eq("document_id", documentId);
        if (result.error) throw result.error;
        return result.count ?? 0;
    }

    function nested(doc: Y.Doc): { text: Y.Text; annotations: Y.Map<unknown> } {
        const revision = doc.getMap("annotations").get("revision");
        if (!(revision instanceof Y.Map)) throw new Error("Missing revision");
        const versions = revision.get("versions");
        const version = versions instanceof Y.Map ? versions.get("v1") : undefined;
        if (!(version instanceof Y.Map)) throw new Error("Missing version");
        const text = version.get("text");
        const annotations = version.get("annotations");
        if (!(text instanceof Y.Text) || !(annotations instanceof Y.Map))
            throw new Error("Missing nested scope");
        return { text, annotations };
    }

    beforeAll(async () => {
        if (!url || !serviceKey || !publicKey) throw new Error("Missing test credentials");
        vi.stubEnv("SUPABASE_URL", url);
        vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", serviceKey);
        vi.stubEnv("ALLOWED_ORIGINS", "");
        admin = createClient(url, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
        async function actor(): Promise<Actor> {
            const email = `relay-${randomUUID()}@example.test`;
            const password = randomUUID();
            const created = await admin.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
            });
            if (created.error || !created.data.user)
                throw created.error ?? new Error("Local auth fixture failed");
            users.push(created.data.user.id);
            const client = createClient(url ?? "", publicKey ?? "", {
                auth: { persistSession: false, autoRefreshToken: false },
            });
            const signedIn = await client.auth.signInWithPassword({ email, password });
            if (signedIn.error || !signedIn.data.session)
                throw signedIn.error ?? new Error("Local login failed");
            return { user: created.data.user, token: signedIn.data.session.access_token };
        }
        owner = await actor();
        stranger = await actor();
        invitee = await actor();
        const anon = createClient(url, publicKey, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
        const signedIn = await anon.auth.signInAnonymously({
            options: { data: { display_name: "Local joiner", role: "owner" } },
        });
        if (signedIn.error || !signedIn.data.session || !signedIn.data.user)
            throw signedIn.error ?? new Error("Anonymous local auth failed");
        anonymous = { user: signedIn.data.user, token: signedIn.data.session.access_token };
        users.push(anonymous.user.id);
        const server = await import("../server.js");
        rooms = await import("../yjs/rooms.js");
        persistence = await import("../persistence/debouncedUpdates.js");
        relay = server.createRelayServer({ email: sink });
        await new Promise<void>((resolve) => relay.httpServer.listen(0, "127.0.0.1", resolve));
        const address = relay.httpServer.address();
        if (!address || typeof address === "string") throw new Error("Missing relay address");
        endpoint = `http://127.0.0.1:${address.port}`;
        wsEndpoint = endpoint.replace("http:", "ws:");
    }, 30_000);

    beforeEach(async () => {
        documentId = randomUUID();
        const inserted = await admin
            .from("sync_documents")
            .insert({ id: documentId, owner_id: owner.user.id, title: "Local invitation proof" });
        if (inserted.error) throw inserted.error;
        ownerPeer = await connect(owner);
        seed = new Y.Doc();
        const text = seed.getText("document");
        text.insert(0, "Protected root draft");
        const revision = new Y.Map<unknown>();
        const version = new Y.Map<unknown>();
        const versions = new Y.Map<unknown>();
        version.set("id", "v1");
        version.set("text", new Y.Text("Protected nested draft"));
        version.set("annotations", new Y.Map());
        versions.set("v1", version);
        revision.set("id", "revision");
        revision.set("_type", "revision");
        revision.set("status", "active");
        revision.set(
            "startPos",
            Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, 0)),
        );
        revision.set(
            "endPos",
            Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, 4)),
        );
        revision.set("thread", new Y.Array());
        revision.set("versions", versions);
        revision.set("order", Y.Array.from(["v1"]));
        revision.set("activeVersionId", "v1");
        seed.getMap("annotations").set("revision", revision);
        ownerPeer.ws.send(updateFrame(Y.encodeStateAsUpdate(seed)));
        await until(() => room().ydoc.getText("document").toString() === "Protected root draft");
        await persistedCount();
    });

    afterEach(async () => {
        for (const peer of peers.splice(0)) peer.ws.terminate();
        await until(() => !rooms.getYjsRoom(documentId)?.isOwnerConnected);
        await persistence.flushDocumentUpdates(documentId);
        seed.destroy();
        rooms._clearAllRooms();
        const deleted = await admin.from("sync_documents").delete().eq("id", documentId);
        if (deleted.error) throw deleted.error;
    });

    afterAll(async () => {
        if (relay) await relay.close();
        if (admin) for (const id of users) await admin.auth.admin.deleteUser(id);
        vi.unstubAllEnvs();
    });

    it.each(["viewer", "commenter"] as const)(
        "rejects hostile %s writes before persistence and broadcast",
        async (role) => {
            const invitation = await grant(role);
            for (const attack of [
                "root",
                "nested",
                "annotation",
                "metadata",
                "delete",
                "full-state",
                "deferred",
            ] as const) {
                const peer = await connect(anonymous, invitation.token);
                const attacker = new Y.Doc();
                Y.applyUpdate(attacker, Y.encodeStateAsUpdate(room().ydoc));
                const before = Buffer.from(Y.encodeStateAsUpdate(room().ydoc)).toString("base64");
                const count = await persistedCount();
                const ownerFrames = syncCount(ownerPeer);
                const vector = Y.encodeStateVector(attacker);
                let pendingDependency: Uint8Array | undefined;
                if (attack === "root") attacker.getText("document").insert(0, "FORBIDDEN");
                if (attack === "nested") nested(attacker).text.insert(0, "FORBIDDEN");
                if (attack === "annotation") attacker.getMap("annotations").delete("revision");
                if (attack === "metadata") attacker.getMap("__quillium").set("role", "owner");
                if (attack === "delete") attacker.getText("document").delete(0, 5);
                if (attack === "full-state")
                    attacker.getMap("versionGroups").set("forged", { role: "editor" });
                let update = Y.encodeStateAsUpdate(
                    attacker,
                    attack === "full-state" ? undefined : vector,
                );
                if (attack === "deferred") {
                    const delayed = new Y.Doc();
                    const updates: Uint8Array[] = [];
                    delayed.on("update", (item: Uint8Array) => updates.push(item));
                    delayed.getText("document").insert(0, "dependency");
                    delayed.getText("document").insert(0, "FORBIDDEN");
                    pendingDependency = updates[0];
                    const deferred = updates[1];
                    if (!deferred || !pendingDependency)
                        throw new Error("Expected deferred CRDT fixture");
                    update = deferred;
                    delayed.destroy();
                }
                peer.ws.send(updateFrame(update, attack === "full-state"));
                await until(() => peer.ws.readyState === WebSocket.CLOSED);
                expect(
                    Buffer.from(Y.encodeStateAsUpdate(room().ydoc)).toString("base64"),
                    attack,
                ).toBe(before);
                expect(await persistedCount(), attack).toBe(count);
                expect(syncCount(ownerPeer), attack).toBe(ownerFrames);
                if (pendingDependency) {
                    ownerPeer.ws.send(updateFrame(pendingDependency));
                    await until(() =>
                        room().ydoc.getText("document").toString().includes("dependency"),
                    );
                    expect(room().ydoc.getText("document").toString()).not.toContain("FORBIDDEN");
                }
                attacker.destroy();
            }
        },
        30_000,
    );

    it("accepts editor root and nested text plus annotation writes", async () => {
        const invitation = await grant("editor");
        const peer = await connect(anonymous, invitation.token);
        const editor = new Y.Doc();
        Y.applyUpdate(editor, Y.encodeStateAsUpdate(room().ydoc));
        const vector = Y.encodeStateVector(editor);
        editor.transact(() => {
            editor.getText("document").insert(0, "Edited ");
            nested(editor).text.insert(0, "Edited ");
            editor
                .getMap("versionGroups")
                .set("linked", { id: "linked", label: "Allowed", members: [] });
        });
        peer.ws.send(updateFrame(Y.encodeStateAsUpdate(editor, vector)));
        await until(() => nested(room().ydoc).text.toString().startsWith("Edited "));
        expect(room().ydoc.getText("document").toString()).toBe("Edited Protected root draft");
        expect(room().ydoc.getMap("versionGroups").has("linked")).toBe(true);
        expect(await persistedCount()).toBeGreaterThan(1);
        editor.destroy();
    });

    it("applies nested commenter commands with server authorship and rejects protected targets", async () => {
        const invitation = await grant("commenter");
        const peer = await connect(anonymous, invitation.token);
        const access = custom(peer, CUSTOM_ACCESS);
        if (access?.subtype !== CUSTOM_ACCESS) throw new Error("Missing role assignment");
        expect(access.payload.role).toBe("commenter");
        const scope = [{ annotationId: "revision", versionId: "v1" }];
        const text = nested(room().ydoc).text;
        const create: CommentCommand = {
            kind: "createComment",
            requestId: randomUUID(),
            roomEpoch: access.payload.roomEpoch,
            scope,
            start: Array.from(
                Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, 0)),
            ),
            end: Array.from(
                Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, 4)),
            ),
            message: "Nested note",
        };
        peer.ws.send(encodeCommentCommand(create));
        await until(() => nested(room().ydoc).annotations.size === 1);
        const node = Array.from(nested(room().ydoc).annotations.values())[0];
        if (!(node instanceof Y.Map)) throw new Error("Missing server comment");
        const thread = node.get("thread");
        if (!(thread instanceof Y.Array)) throw new Error("Missing server thread");
        expect(thread.toArray()).toEqual([
            expect.objectContaining({ author: anonymous.user.id, message: "Nested note" }),
        ]);
        peer.ws.send(encodeCommentCommand(create));
        const reply: CommentCommand = {
            kind: "replyToComment",
            requestId: randomUUID(),
            roomEpoch: access.payload.roomEpoch,
            scope,
            annotationId: String(node.get("id")),
            message: "Nested reply",
        };
        peer.ws.send(encodeCommentCommand(reply));
        await until(() => thread.length === 2);
        expect(nested(room().ydoc).annotations.size).toBe(1);
        peer.messages = [];
        peer.ws.send(
            encodeCommentCommand({
                ...reply,
                requestId: randomUUID(),
                scope: [],
                annotationId: "revision",
            }),
        );
        await until(() => !!custom(peer, CUSTOM_COMMENT_RESULT));
        expect(custom(peer, CUSTOM_COMMENT_RESULT)).toMatchObject({ payload: { ok: false } });
        expect(room().ydoc.getText("document").toString()).toBe("Protected root draft");
        expect(text.toString()).toBe("Protected nested draft");
        const viewerGrant = await grant("viewer");
        const viewer = await connect(anonymous, viewerGrant.token);
        const viewerAccess = custom(viewer, CUSTOM_ACCESS);
        if (viewerAccess?.subtype !== CUSTOM_ACCESS) throw new Error("Missing viewer role");
        viewer.ws.send(
            encodeCommentCommand({
                ...create,
                requestId: randomUUID(),
                roomEpoch: viewerAccess.payload.roomEpoch,
            }),
        );
        await until(() => !!custom(viewer, CUSTOM_COMMENT_RESULT));
        expect(custom(viewer, CUSTOM_COMMENT_RESULT)).toMatchObject({ payload: { ok: false } });
        expect(nested(room().ydoc).annotations.size).toBe(1);
    });

    it("rejects crafted commenter commands, cross-scope anchors, and earlier session replays", async () => {
        const invitation = await grant("commenter");
        for (const extra of [
            { _type: "revision" },
            { _type: "suggestion" },
            { role: "editor" },
            { author: owner.user.id },
        ]) {
            const peer = await connect(anonymous, invitation.token);
            const access = custom(peer, CUSTOM_ACCESS);
            if (access?.subtype !== CUSTOM_ACCESS) throw new Error("Missing commenter role");
            const text = room().ydoc.getText("document");
            const command = {
                kind: "createComment",
                requestId: randomUUID(),
                roomEpoch: access.payload.roomEpoch,
                scope: [],
                start: Array.from(
                    Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, 0)),
                ),
                end: Array.from(
                    Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, 2)),
                ),
                message: "Forbidden fields",
                ...extra,
            };
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, 4);
            encoding.writeVarString(encoder, JSON.stringify(command));
            const before = Buffer.from(Y.encodeStateAsUpdate(room().ydoc)).toString("base64");
            const count = await persistedCount();
            peer.ws.send(encoding.toUint8Array(encoder));
            await until(() => peer.ws.readyState === WebSocket.CLOSED);
            expect(Buffer.from(Y.encodeStateAsUpdate(room().ydoc)).toString("base64")).toBe(before);
            expect(await persistedCount()).toBe(count);
        }
        const peer = await connect(anonymous, invitation.token);
        const access = custom(peer, CUSTOM_ACCESS);
        if (access?.subtype !== CUSTOM_ACCESS) throw new Error("Missing commenter role");
        const root = room().ydoc.getText("document");
        const command: CommentCommand = {
            kind: "createComment",
            requestId: randomUUID(),
            roomEpoch: access.payload.roomEpoch,
            scope: [{ annotationId: "revision", versionId: "v1" }],
            start: Array.from(
                Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(root, 0)),
            ),
            end: Array.from(
                Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(root, 2)),
            ),
            message: "Wrong text scope",
        };
        peer.messages = [];
        peer.ws.send(encodeCommentCommand(command));
        await until(() => !!custom(peer, CUSTOM_COMMENT_RESULT));
        expect(custom(peer, CUSTOM_COMMENT_RESULT)).toMatchObject({ payload: { ok: false } });
        peer.messages = [];
        peer.ws.send(
            encodeCommentCommand({
                ...command,
                requestId: randomUUID(),
                scope: [],
                roomEpoch: randomUUID(),
            }),
        );
        await until(() => !!custom(peer, CUSTOM_COMMENT_RESULT));
        expect(custom(peer, CUSTOM_COMMENT_RESULT)).toMatchObject({ payload: { ok: false } });
        expect(nested(room().ydoc).annotations.size).toBe(0);
        expect(room().ydoc.getMap("annotations").size).toBe(1);
    });

    it("removes expired readers before an outbound update even when the expiry timer has not run", async () => {
        const deadline = Date.now() + 60_000;
        const created = await request(owner, `/access/documents/${documentId}/grants`, "POST", {
            role: "viewer",
            expiresAt: new Date(deadline).toISOString(),
        });
        expect(created.status).toBe(201);
        const invitation = createdSchema.parse(await created.json());
        const viewer = await connect(anonymous, invitation.token);
        const before = syncCount(viewer);
        const now = vi.spyOn(Date, "now").mockReturnValue(deadline + 1);
        const update = new Y.Doc();
        try {
            update.getText("document").insert(0, "Owner update after expiry");
            ownerPeer.ws.send(updateFrame(Y.encodeStateAsUpdate(update)));
            await until(() => viewer.ws.readyState === WebSocket.CLOSED);
            expect(syncCount(viewer)).toBe(before);
            expect(room().clients.size).toBe(1);
        } finally {
            now.mockRestore();
            update.destroy();
        }
    });

    it("binds email grants and rejects role escalation, UUID entry, invalid and expired tokens", async () => {
        if (!invitee.user.email) throw new Error("Missing local invitee address");
        const invitation = await grant("viewer", invitee.user.email);
        expect(sink.invitations.at(-1)?.joinUrl).toBe(invitation.joinUrl);
        const resolved = await request(invitee, "/access/invitations/resolve", "POST", {
            token: invitation.token,
        });
        expect(resolved.status).toBe(200);
        for (const actor of [anonymous, stranger]) {
            expect(
                (
                    await request(actor, "/access/invitations/resolve", "POST", {
                        token: invitation.token,
                    })
                ).status,
            ).toBe(403);
            await rejected(actor, invitation.token);
        }
        await rejected(anonymous);
        await rejected(anonymous, "a".repeat(43));
        await rejected(anonymous, invitation.token, randomUUID());
        expect(
            (
                await request(
                    stranger,
                    `/access/documents/${documentId}/grants/${invitation.grant.id}`,
                    "PATCH",
                    { role: "editor" },
                )
            ).status,
        ).toBe(403);
        const expiry = await grant("viewer");
        const updated = await admin
            .from("live_room_grants")
            .update({
                created_at: new Date(Date.now() - 120_000).toISOString(),
                expires_at: new Date(Date.now() - 60_000).toISOString(),
            })
            .eq("id", expiry.grant.id);
        if (updated.error) throw updated.error;
        const expired = await request(anonymous, "/access/invitations/resolve", "POST", {
            token: expiry.token,
        });
        expect(await expired.json()).toMatchObject({ code: "expired_invitation" });
        await rejected(anonymous, expiry.token);
    });

    it("downgrades and revokes connected grants before successful management responses", async () => {
        const invitation = await grant("editor");
        const editor = await connect(anonymous, invitation.token);
        const changed = await request(
            owner,
            `/access/documents/${documentId}/grants/${invitation.grant.id}`,
            "PATCH",
            { role: "viewer" },
        );
        expect(changed.status).toBe(200);
        await until(() => editor.ws.readyState === WebSocket.CLOSED);
        const downgraded = await connect(anonymous, invitation.token);
        expect(custom(downgraded, CUSTOM_ACCESS)).toMatchObject({ payload: { role: "viewer" } });
        const staleEditor = new Y.Doc();
        staleEditor.getText("document").insert(0, "Pending old editor update");
        const before = Buffer.from(Y.encodeStateAsUpdate(room().ydoc)).toString("base64");
        downgraded.ws.send(updateFrame(Y.encodeStateAsUpdate(staleEditor)));
        await until(() => downgraded.ws.readyState === WebSocket.CLOSED);
        expect(Buffer.from(Y.encodeStateAsUpdate(room().ydoc)).toString("base64")).toBe(before);
        staleEditor.destroy();
        const viewer = await connect(anonymous, invitation.token);
        const serverPeersBefore = room().clients.size;
        const revoked = await request(
            owner,
            `/access/documents/${documentId}/grants/${invitation.grant.id}`,
            "DELETE",
        );
        expect(revoked.status).toBe(200);
        expect(room().clients.size).toBe(serverPeersBefore - 1);
        const viewerFrames = syncCount(viewer);
        const updated = new Y.Doc();
        updated.getText("document").insert(0, "Owner still writes");
        ownerPeer.ws.send(updateFrame(Y.encodeStateAsUpdate(updated)));
        await until(() =>
            room().ydoc.getText("document").toString().includes("Owner still writes"),
        );
        await until(() => viewer.ws.readyState === WebSocket.CLOSED);
        expect(syncCount(viewer)).toBe(viewerFrames);
        const resolution = await request(anonymous, "/access/invitations/resolve", "POST", {
            token: invitation.token,
        });
        expect(await resolution.json()).toMatchObject({ code: "revoked_invitation" });
        await rejected(anonymous, invitation.token);
        updated.destroy();
    });

    it("ends joiners when the owner leaves and reports owner-offline on later resolution", async () => {
        const invitation = await grant("viewer");
        const viewer = await connect(anonymous, invitation.token);
        let closeReason = "";
        viewer.ws.on("close", (_code, reason) => {
            closeReason = reason.toString();
        });
        ownerPeer.ws.close();
        await until(() => viewer.ws.readyState === WebSocket.CLOSED);
        expect(closeReason).toBe("Owner left");
        expect(room().ydoc.getText("document").toString()).toBe("");
        const resolution = await request(anonymous, "/access/invitations/resolve", "POST", {
            token: invitation.token,
        });
        expect(resolution.status).toBe(409);
        expect(await resolution.json()).toMatchObject({ code: "owner_offline" });
        await rejected(anonymous, invitation.token);
    });
});
