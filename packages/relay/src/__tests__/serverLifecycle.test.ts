import { once } from "node:events";
import * as encoding from "lib0/encoding";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

vi.mock("../auth/middleware.js", () => ({
    authenticateWebSocket: vi.fn(),
}));
vi.mock("../persistence/yjsUpdates.js", () => ({
    loadYjsState: vi.fn(),
    persistYjsState: vi.fn(),
    persistYjsUpdates: vi.fn(),
    clearYjsUpdates: vi.fn(),
}));

import { authenticateWebSocket } from "../auth/middleware.js";
import { flushDocumentUpdates } from "../persistence/debouncedUpdates.js";
import {
    clearYjsUpdates,
    loadYjsState,
    persistYjsState,
    persistYjsUpdates,
} from "../persistence/yjsUpdates.js";
import { createRelayServer } from "../server.js";
import {
    _clearAllRooms,
    cancelRoomCleanup,
    getYjsRoom,
    scheduleRoomCleanup,
} from "../yjs/rooms.js";
import { MESSAGE_SYNC } from "../yjs/sync.js";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve = (_value: T): void => {};
    const promise = new Promise<T>((complete) => {
        resolve = complete;
    });
    return { promise, resolve };
}

const documentId = "123e4567-e89b-12d3-a456-426614174000";
const authenticated = {
    success: true,
    data: { userId: "writer", documentId, isOwner: false, isAnonymous: false },
};

describe("relay connection lifecycle", () => {
    const servers: ReturnType<typeof createRelayServer>[] = [];
    const clients: WebSocket[] = [];

    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(authenticateWebSocket).mockResolvedValue(authenticated);
        vi.mocked(loadYjsState).mockImplementation(async () => ({
            ydoc: new Y.Doc(),
            stateVector: null,
        }));
        vi.mocked(persistYjsState).mockResolvedValue({ success: true });
        vi.mocked(persistYjsUpdates).mockResolvedValue({ success: true });
        vi.mocked(clearYjsUpdates).mockResolvedValue();
    });

    afterEach(async () => {
        vi.useRealTimers();
        for (const client of clients.splice(0)) client.terminate();
        await Promise.all(servers.splice(0).map((server) => server.close()));
        _clearAllRooms();
    });

    async function start(): Promise<{
        server: ReturnType<typeof createRelayServer>;
        connect: (roomId?: string) => WebSocket;
    }> {
        const server = createRelayServer();
        servers.push(server);
        await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
        const address = server.httpServer.address();
        if (!address || typeof address === "string") throw new Error("Missing server address");
        return {
            server,
            connect: (roomId = documentId) => {
                const client = new WebSocket(`ws://127.0.0.1:${address.port}/${roomId}?auth=token`);
                client.on("error", () => {});
                clients.push(client);
                return client;
            },
        };
    }

    it("closes the WebSocket when room initialization fails and permits a retry", async () => {
        vi.mocked(loadYjsState).mockRejectedValueOnce(new Error("load failed"));
        const { connect } = await start();
        const client = connect();
        const [code] = await once(client, "close");

        expect(code).toBe(1011);
        const retry = connect();
        await once(retry, "message");
        expect(getYjsRoom(documentId)?.clients.size).toBe(1);
    });

    it("does not register a client that closed during room initialization", async () => {
        const load = deferred<Awaited<ReturnType<typeof loadYjsState>>>();
        vi.mocked(loadYjsState).mockReturnValueOnce(load.promise);
        const { connect } = await start();
        const client = connect();
        await once(client, "open");
        const closed = once(client, "close");
        client.close();
        await closed;
        load.resolve({ ydoc: new Y.Doc(), stateVector: null });

        await vi.waitFor(() => expect(getYjsRoom(documentId)).toBeDefined());
        expect(getYjsRoom(documentId)?.clients.size).toBe(0);
        expect(getYjsRoom(documentId)?.cleanupTimer).not.toBeNull();
    });

    it("does not admit a connection whose authentication finishes during shutdown", async () => {
        const auth = deferred<Awaited<ReturnType<typeof authenticateWebSocket>>>();
        vi.mocked(authenticateWebSocket).mockReturnValueOnce(auth.promise);
        const { server, connect } = await start();
        const client = connect();
        await vi.waitFor(() => expect(authenticateWebSocket).toHaveBeenCalled());

        await server.close();
        auth.resolve(authenticated);
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(loadYjsState).not.toHaveBeenCalled();
        expect(server.wss.clients.size).toBe(0);
        expect(client.readyState).toBe(WebSocket.CLOSED);
    });

    it("waits for initialization without registering a client during shutdown", async () => {
        const load = deferred<Awaited<ReturnType<typeof loadYjsState>>>();
        vi.mocked(loadYjsState).mockReturnValueOnce(load.promise);
        const { server, connect } = await start();
        const client = connect();
        await once(client, "open");

        let finished = false;
        const closed = server.close().then(() => {
            finished = true;
        });
        await once(client, "close");
        expect(finished).toBe(false);
        load.resolve({ ydoc: new Y.Doc(), stateVector: null });
        await closed;

        expect(getYjsRoom(documentId)?.clients.size).toBe(0);
        expect(server.wss.clients.size).toBe(0);
    });

    it("drains accepted edits while a peer has not answered shutdown and ignores later messages", async () => {
        const write = deferred<Awaited<ReturnType<typeof persistYjsUpdates>>>();
        vi.mocked(persistYjsUpdates)
            .mockResolvedValueOnce({ success: false, error: "temporary write failure" })
            .mockReturnValueOnce(write.promise);
        const { server, connect } = await start();
        const client = connect();
        await once(client, "message");
        const ydoc = new Y.Doc();
        ydoc.getText("document").insert(0, "accepted edit");
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(ydoc));
        client.send(encoding.toUint8Array(encoder));
        await vi.waitFor(() => {
            expect(getYjsRoom(documentId)?.ydoc.getText("document").toString()).toBe(
                "accepted edit",
            );
        });
        await expect(flushDocumentUpdates(documentId)).rejects.toThrow("temporary write failure");
        const peer = Array.from(server.wss.clients)[0];
        if (!peer) throw new Error("Expected server connection");
        client.pause();
        let finished = false;
        const closed = server.close().then(() => {
            finished = true;
        });
        const persisted = new Y.Doc();
        try {
            const lateMessage = once(peer, "message");
            ydoc.getText("document").insert(13, " ignored");
            const lateEncoder = encoding.createEncoder();
            encoding.writeVarUint(lateEncoder, MESSAGE_SYNC);
            syncProtocol.writeUpdate(lateEncoder, Y.encodeStateAsUpdate(ydoc));
            client.send(encoding.toUint8Array(lateEncoder));
            await lateMessage;

            await vi.waitFor(() => expect(persistYjsUpdates).toHaveBeenCalledTimes(2));
            expect(peer.readyState).toBe(WebSocket.CLOSING);
            expect(client.readyState).toBe(WebSocket.OPEN);
            expect(finished).toBe(false);
            expect(getYjsRoom(documentId)?.ydoc.getText("document").toString()).toBe(
                "accepted edit",
            );
            for (const [, updates] of vi.mocked(persistYjsUpdates).mock.calls) {
                for (const update of updates) Y.applyUpdate(persisted, update);
            }
            expect(persisted.getText("document").toString()).toBe("accepted edit");
        } finally {
            write.resolve({ success: true });
            client.resume();
            await closed;
            ydoc.destroy();
            persisted.destroy();
        }
    });

    it("drains accepted edits while another room is still initializing", async () => {
        vi.mocked(persistYjsUpdates).mockResolvedValueOnce({
            success: false,
            error: "temporary write failure",
        });
        const { server, connect } = await start();
        const established = connect();
        await once(established, "message");
        const ydoc = new Y.Doc();
        ydoc.getText("document").insert(0, "accepted before shutdown");
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(ydoc));
        established.send(encoding.toUint8Array(encoder));
        await vi.waitFor(() => {
            expect(getYjsRoom(documentId)?.ydoc.getText("document").toString()).toBe(
                "accepted before shutdown",
            );
        });
        await expect(flushDocumentUpdates(documentId)).rejects.toThrow("temporary write failure");

        const load = deferred<Awaited<ReturnType<typeof loadYjsState>>>();
        vi.mocked(loadYjsState).mockReturnValueOnce(load.promise);
        const pendingDocumentId = "123e4567-e89b-12d3-a456-426614174001";
        const initializing = connect(pendingDocumentId);
        await once(initializing, "open");
        await vi.waitFor(() => expect(loadYjsState).toHaveBeenCalledWith(pendingDocumentId));
        let finished = false;
        const closed = server.close().then(() => {
            finished = true;
        });
        const persisted = new Y.Doc();
        try {
            await vi.waitFor(() => expect(persistYjsUpdates).toHaveBeenCalledTimes(2));
            expect(finished).toBe(false);
            expect(getYjsRoom(pendingDocumentId)).toBeUndefined();
            for (const [, updates] of vi.mocked(persistYjsUpdates).mock.calls.slice(1)) {
                for (const update of updates) Y.applyUpdate(persisted, update);
            }
            expect(persisted.getText("document").toString()).toBe("accepted before shutdown");
        } finally {
            load.resolve({ ydoc: new Y.Doc(), stateVector: null });
            await closed;
            ydoc.destroy();
            persisted.destroy();
        }
        expect(getYjsRoom(pendingDocumentId)?.clients.size).toBe(0);
    });

    it("delays a real WebSocket rejoin until room compaction finishes", async () => {
        const { connect } = await start();
        const first = connect();
        await once(first, "message");
        const room = getYjsRoom(documentId);
        if (!room) throw new Error("Expected room");
        const closed = once(first, "close");
        first.close();
        await closed;
        await vi.waitFor(() => expect(room.clients.size).toBe(0));
        cancelRoomCleanup(room);
        const clear = deferred<void>();
        vi.mocked(clearYjsUpdates).mockReturnValueOnce(clear.promise);
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        scheduleRoomCleanup(room);
        await vi.advanceTimersByTimeAsync(45_000);
        vi.useRealTimers();
        const rejoin = connect();
        let received = false;
        const synced = once(rejoin, "message").then(() => {
            received = true;
        });
        await once(rejoin, "open");
        expect(received).toBe(false);
        clear.resolve();
        await synced;

        const nextRoom = getYjsRoom(documentId);
        expect(nextRoom?.ydoc.isDestroyed).toBe(false);
        expect(nextRoom?.clients.size).toBe(1);
        expect(nextRoom).not.toBe(room);
    });
});
