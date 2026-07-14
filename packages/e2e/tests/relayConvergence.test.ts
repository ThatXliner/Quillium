/**
 * relayConvergence.test.ts — Boots the production Omni relay and verifies
 * two authenticated Yjs clients converge over real WebSocket framing.
 *
 * The suite is skipped unless the local Supabase credentials used by the
 * broader E2E package are present. No relay auth or persistence module is
 * mocked: access tokens are minted by Supabase Auth and updates are flushed to
 * the migrated local database.
 */
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import fc from "fast-check";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { describe, expect, it } from "vitest";
import { type RawData, WebSocket } from "ws";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { resolveWebPreviewEnvironment } from "./webPreviewEnv";

const environment = resolveWebPreviewEnvironment(process.env);
const RELAY_ORIGIN = Symbol("relay");
const MESSAGE_SYNC = 0;
const RELAY_FUZZ_SEED = 325_2026;
const RELAY_FUZZ_RUNS = 12;

type FuzzOperation = {
    peer: "A" | "B";
    positionBias: number;
    text: string;
};

const fuzzCharacterArbitrary = fc.constantFrom(...Array.from("abcdef XYZ\n"));
const fuzzOperationsArbitrary: fc.Arbitrary<FuzzOperation[]> = fc.array(
    fc.record({
        peer: fc.constantFrom("A" as const, "B" as const),
        positionBias: fc.integer({ min: 0, max: 100 }),
        text: fc.string({ unit: fuzzCharacterArbitrary, minLength: 1, maxLength: 8 }),
    }),
    { minLength: 1, maxLength: 16 },
);

type TestIdentity = {
    client: SupabaseClient;
    userId: string;
    accessToken: string;
};

type PersistedUpdate = {
    update_data: string;
};

function createTestClient(key: string): SupabaseClient {
    return createClient(environment.url, key, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            storageKey: `omni-relay-e2e-${randomUUID()}`,
        },
    });
}

async function createIdentity(
    admin: SupabaseClient,
    publicKey: string,
    label: string,
): Promise<TestIdentity> {
    const email = `omni-relay-${label}-${randomUUID()}@example.test`;
    const password = `E2e-${randomUUID()}!`;
    const client = createTestClient(publicKey);
    const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: `Relay ${label}` },
    });
    if (createError || !created.user) {
        throw new Error(`Could not create ${label} user: ${createError?.message ?? "no user"}`);
    }

    const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({
        email,
        password,
    });
    if (signInError || !signedIn.session) {
        await admin.auth.admin.deleteUser(created.user.id, false);
        throw new Error(`Could not sign in ${label} user: ${signInError?.message ?? "no session"}`);
    }

    return {
        client,
        userId: created.user.id,
        accessToken: signedIn.session.access_token,
    };
}

function asUint8Array(data: RawData): Uint8Array {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

async function waitFor(description: string, predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (!predicate()) {
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

class HeadlessYjsClient {
    readonly doc = new Y.Doc();
    readonly text = this.doc.getText("document");
    readonly annotations = this.doc.getMap<Y.Map<unknown>>("annotations");
    remoteUpdateCount = 0;
    synced = false;
    private readonly socket: WebSocket;

    constructor(url: string) {
        this.socket = new WebSocket(url);
        this.doc.on("update", (update: Uint8Array, origin: unknown) => {
            if (origin === RELAY_ORIGIN || this.socket.readyState !== WebSocket.OPEN) return;
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, MESSAGE_SYNC);
            syncProtocol.writeUpdate(encoder, update);
            this.socket.send(encoding.toUint8Array(encoder));
        });
        this.socket.on("message", (data) => this.receive(asUint8Array(data)));
    }

    async connect(): Promise<void> {
        if (this.socket.readyState !== WebSocket.OPEN) {
            await new Promise<void>((resolve, reject) => {
                const onOpen = () => {
                    cleanup();
                    resolve();
                };
                const onError = (error: Error) => {
                    cleanup();
                    reject(error);
                };
                const cleanup = () => {
                    this.socket.off("open", onOpen);
                    this.socket.off("error", onError);
                };
                this.socket.on("open", onOpen);
                this.socket.on("error", onError);
            });
        }
        await waitFor("initial Yjs sync", () => this.synced);
    }

    async close(): Promise<void> {
        if (this.socket.readyState === WebSocket.CLOSED) {
            this.doc.destroy();
            return;
        }
        await new Promise<void>((resolve) => {
            this.socket.once("close", () => resolve());
            this.socket.close();
        });
        this.doc.destroy();
    }

    private receive(message: Uint8Array): void {
        const decoder = decoding.createDecoder(message);
        if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;

        const inspectionDecoder = decoding.createDecoder(message);
        decoding.readVarUint(inspectionDecoder);
        const syncMessageType = decoding.readVarUint(inspectionDecoder);
        if (syncMessageType === syncProtocol.messageYjsUpdate) this.remoteUpdateCount += 1;
        if (syncMessageType === syncProtocol.messageYjsSyncStep2) this.synced = true;

        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, RELAY_ORIGIN);
        if (encoding.length(encoder) > 1 && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(encoding.toUint8Array(encoder));
        }
    }
}

function createComment({
    id,
    from,
    to,
    selectedText,
}: {
    id: string;
    from: number;
    to: number;
    selectedText: string;
}): Y.Map<unknown> {
    const comment = new Y.Map<unknown>();
    comment.set("id", id);
    comment.set("type", "comment");
    comment.set("from", from);
    comment.set("to", to);
    comment.set("selectedText", selectedText);
    return comment;
}

describe.skipIf(!environment.enabled)("Omni real-relay convergence", () => {
    it("converges two JWT-authenticated clients without echo and persists every update", async () => {
        process.env.SUPABASE_URL = environment.url;
        process.env.SUPABASE_SERVICE_ROLE_KEY = environment.serviceRoleKey;

        const [{ createRelayServer }, { flushAllDocumentUpdates }, { _clearAllRooms }] =
            await Promise.all([
                import("../../relay/src/server"),
                import("../../relay/src/persistence/debouncedUpdates"),
                import("../../relay/src/yjs/rooms"),
            ]);
        const admin = createTestClient(environment.serviceRoleKey);
        const documentId = randomUUID();
        const { wss, httpServer } = createRelayServer();
        let owner: TestIdentity | undefined;
        let collaborator: TestIdentity | undefined;
        let clientA: HeadlessYjsClient | undefined;
        let clientB: HeadlessYjsClient | undefined;

        try {
            owner = await createIdentity(admin, environment.publishableKey, "owner");
            collaborator = await createIdentity(admin, environment.publishableKey, "collaborator");
            const { error: documentError } = await owner.client.from("sync_documents").insert({
                id: documentId,
                owner_id: owner.userId,
                title: "Real relay E2E",
            });
            expect(documentError).toBeNull();

            await new Promise<void>((resolve, reject) => {
                httpServer.once("error", reject);
                httpServer.listen(0, "127.0.0.1", () => resolve());
            });
            const { port } = httpServer.address() as AddressInfo;
            const relayUrl = `ws://127.0.0.1:${port}/${documentId}`;

            clientA = new HeadlessYjsClient(
                `${relayUrl}?auth=${encodeURIComponent(owner.accessToken)}`,
            );
            await clientA.connect();
            clientB = new HeadlessYjsClient(
                `${relayUrl}?auth=${encodeURIComponent(collaborator.accessToken)}`,
            );
            await clientB.connect();

            const aRemoteBefore = clientA.remoteUpdateCount;
            const bRemoteBefore = clientB.remoteUpdateCount;
            clientA.doc.transact(() => {
                clientA?.text.insert(0, "Hello");
                clientA?.annotations.set(
                    "comment-a",
                    createComment({ id: "comment-a", from: 0, to: 5, selectedText: "Hello" }),
                );
            }, "client-a");

            await waitFor(
                "client A's update on client B",
                () => clientB?.text.toString() === "Hello",
            );
            expect(clientB.annotations.get("comment-a")?.get("selectedText")).toBe("Hello");
            expect(clientB.remoteUpdateCount - bRemoteBefore).toBe(1);
            expect(clientA.remoteUpdateCount - aRemoteBefore).toBe(0);

            const aRemoteAfterFirstEdit = clientA.remoteUpdateCount;
            const bRemoteAfterFirstEdit = clientB.remoteUpdateCount;
            clientB.doc.transact(() => {
                clientB?.text.insert(5, " world");
                clientB?.annotations.set(
                    "comment-b",
                    createComment({ id: "comment-b", from: 6, to: 11, selectedText: "world" }),
                );
            }, "client-b");

            await waitFor(
                "client B's update on client A",
                () => clientA?.text.toString() === "Hello world",
            );
            expect(clientA.annotations.get("comment-b")?.get("selectedText")).toBe("world");
            expect(clientA.remoteUpdateCount - aRemoteAfterFirstEdit).toBe(1);
            expect(clientB.remoteUpdateCount - bRemoteAfterFirstEdit).toBe(0);
            expect(Y.encodeStateVector(clientA.doc)).toEqual(Y.encodeStateVector(clientB.doc));

            await flushAllDocumentUpdates();
            const { data: persistedRows, error: persistenceError } = await admin
                .from("yjs_updates")
                .select("update_data")
                .eq("document_id", documentId)
                .order("created_at", { ascending: true });
            expect(persistenceError).toBeNull();
            expect(persistedRows).toHaveLength(2);

            const restored = new Y.Doc();
            for (const row of (persistedRows ?? []) as PersistedUpdate[]) {
                Y.applyUpdate(restored, new Uint8Array(Buffer.from(row.update_data, "base64")));
            }
            expect(restored.getText("document").toString()).toBe("Hello world");
            expect(restored.getMap("annotations").size).toBe(2);
            restored.destroy();
        } finally {
            await flushAllDocumentUpdates();
            if (clientB) await clientB.close().catch(() => undefined);
            if (clientA) await clientA.close().catch(() => undefined);
            _clearAllRooms();
            await new Promise<void>((resolve) => wss.close(() => resolve()));
            await new Promise<void>((resolve) => httpServer.close(() => resolve()));
            await admin.from("sync_documents").delete().eq("id", documentId);
            for (const identity of [owner, collaborator]) {
                if (!identity) continue;
                await identity.client.auth.signOut({ scope: "global" }).catch(() => undefined);
                await admin.auth.admin.deleteUser(identity.userId, false).catch(() => undefined);
            }
        }
    }, 30_000);

    it(`preserves relay invariants across ${RELAY_FUZZ_RUNS} seeded operation sequences`, async () => {
        process.env.SUPABASE_URL = environment.url;
        process.env.SUPABASE_SERVICE_ROLE_KEY = environment.serviceRoleKey;

        const [
            { createRelayServer },
            { flushAllDocumentUpdates },
            { _clearAllRooms },
            { loadYjsState },
        ] = await Promise.all([
            import("../../relay/src/server"),
            import("../../relay/src/persistence/debouncedUpdates"),
            import("../../relay/src/yjs/rooms"),
            import("../../relay/src/persistence/yjsUpdates"),
        ]);
        const admin = createTestClient(environment.serviceRoleKey);
        const { wss, httpServer } = createRelayServer();
        let owner: TestIdentity | undefined;
        let collaborator: TestIdentity | undefined;

        try {
            owner = await createIdentity(admin, environment.publishableKey, "fuzz-owner");
            collaborator = await createIdentity(
                admin,
                environment.publishableKey,
                "fuzz-collaborator",
            );
            const fuzzOwner = owner;
            const fuzzCollaborator = collaborator;
            await new Promise<void>((resolve, reject) => {
                httpServer.once("error", reject);
                httpServer.listen(0, "127.0.0.1", () => resolve());
            });
            const { port } = httpServer.address() as AddressInfo;

            await fc.assert(
                fc.asyncProperty(fuzzOperationsArbitrary, async (operations) => {
                    const documentId = randomUUID();
                    let clientA: HeadlessYjsClient | undefined;
                    let clientB: HeadlessYjsClient | undefined;

                    try {
                        const { error: documentError } = await fuzzOwner.client
                            .from("sync_documents")
                            .insert({
                                id: documentId,
                                owner_id: fuzzOwner.userId,
                                title: "Real relay fuzz E2E",
                            });
                        expect(documentError).toBeNull();

                        const relayUrl = `ws://127.0.0.1:${port}/${documentId}`;
                        clientA = new HeadlessYjsClient(
                            `${relayUrl}?auth=${encodeURIComponent(fuzzOwner.accessToken)}`,
                        );
                        await clientA.connect();
                        clientB = new HeadlessYjsClient(
                            `${relayUrl}?auth=${encodeURIComponent(fuzzCollaborator.accessToken)}`,
                        );
                        await clientB.connect();

                        for (const [index, operation] of operations.entries()) {
                            const sender = operation.peer === "A" ? clientA : clientB;
                            const receiver = operation.peer === "A" ? clientB : clientA;
                            const senderRemoteBefore = sender.remoteUpdateCount;
                            const receiverRemoteBefore = receiver.remoteUpdateCount;
                            const position = Math.floor(
                                (operation.positionBias * (sender.text.length + 1)) / 101,
                            );
                            const annotationId = `fuzz-${index}`;

                            sender.doc.transact(() => {
                                sender.text.insert(position, operation.text);
                                sender.annotations.set(
                                    annotationId,
                                    createComment({
                                        id: annotationId,
                                        from: position,
                                        to: position + operation.text.length,
                                        selectedText: operation.text,
                                    }),
                                );
                            }, `fuzz-client-${operation.peer}`);

                            await waitFor(`fuzz operation ${index} to converge`, () =>
                                receiver.annotations.has(annotationId),
                            );
                            expect(receiver.text.toString()).toBe(sender.text.toString());
                            expect(receiver.remoteUpdateCount - receiverRemoteBefore).toBe(1);
                            expect(sender.remoteUpdateCount - senderRemoteBefore).toBe(0);
                        }

                        expect(Y.encodeStateVector(clientA.doc)).toEqual(
                            Y.encodeStateVector(clientB.doc),
                        );
                        await flushAllDocumentUpdates();
                        const { data: persistedRows, error: persistenceError } = await admin
                            .from("yjs_updates")
                            .select("update_data")
                            .eq("document_id", documentId)
                            .order("created_at", { ascending: true });
                        expect(persistenceError).toBeNull();
                        expect(persistedRows).toHaveLength(operations.length);

                        const { ydoc: restored } = await loadYjsState(documentId);
                        expect(Y.encodeStateVector(restored)).toEqual(
                            Y.encodeStateVector(clientA.doc),
                        );
                        expect(restored.getMap("annotations").size).toBe(operations.length);
                        restored.destroy();
                    } finally {
                        await flushAllDocumentUpdates();
                        if (clientB) await clientB.close().catch(() => undefined);
                        if (clientA) await clientA.close().catch(() => undefined);
                        _clearAllRooms();
                        await admin.from("sync_documents").delete().eq("id", documentId);
                    }
                }),
                { seed: RELAY_FUZZ_SEED, numRuns: RELAY_FUZZ_RUNS },
            );
        } finally {
            _clearAllRooms();
            await new Promise<void>((resolve) => wss.close(() => resolve()));
            await new Promise<void>((resolve) => httpServer.close(() => resolve()));
            for (const identity of [owner, collaborator]) {
                if (!identity) continue;
                await identity.client.auth.signOut({ scope: "global" }).catch(() => undefined);
                await admin.auth.admin.deleteUser(identity.userId, false).catch(() => undefined);
            }
        }
    }, 60_000);
});
