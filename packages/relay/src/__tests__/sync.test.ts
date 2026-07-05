import * as encoding from "lib0/encoding";
/**
 * sync.test.ts -- Tests for Yjs sync protocol handler.
 *
 * Verifies that updates from one client are broadcast to OTHER clients
 * (and not echoed back to the sender, and not dropped).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { Awareness } from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { MESSAGE_SYNC, setupYjsConnection } from "../yjs/sync.js";
import type { YjsClientData, YjsRoom } from "../yjs/types.js";

type FakeListener = (...args: unknown[]) => void;

/**
 * Minimal WebSocket mock that records sent messages and can simulate
 * incoming messages via `receive()`.
 */
class FakeWebSocket {
    public sent: Uint8Array[] = [];
    public readyState = 1; // OPEN
    private listeners: Record<string, FakeListener[]> = {};

    send(data: Uint8Array): void {
        this.sent.push(data);
    }

    close(): void {
        this.readyState = 3;
        this.emit("close");
    }

    on(event: string, cb: FakeListener): void {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(cb);
    }

    off(event: string, cb: FakeListener): void {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter((f) => f !== cb);
    }

    emit(event: string, ...args: unknown[]): void {
        for (const cb of this.listeners[event] || []) cb(...args);
    }

    /** Simulate incoming message from the wire. */
    receive(data: Uint8Array): void {
        this.emit("message", data);
    }
}

function asWebSocket(ws: FakeWebSocket): WebSocket {
    return ws as unknown as WebSocket;
}

function requireUpdate(update: Uint8Array | null): Uint8Array {
    expect(update).not.toBeNull();
    if (!update) throw new Error("Expected Yjs update");
    return update;
}

function buildUpdateMessage(update: Uint8Array): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    return encoding.toUint8Array(encoder);
}

function makeRoom(): YjsRoom {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    return {
        documentId: "test-doc",
        ydoc,
        awareness,
        clients: new Set(),
        cleanupTimer: null,
        isOwnerConnected: false,
        ownerId: null,
    };
}

function makeClient(userId: string, isOwner = false): YjsClientData {
    return {
        userId,
        documentId: "test-doc",
        isOwner,
        isAnonymous: false,
    };
}

describe("Yjs sync broadcast", () => {
    let room: YjsRoom;
    let wsA: FakeWebSocket;
    let wsB: FakeWebSocket;

    beforeEach(() => {
        room = makeRoom();
        wsA = new FakeWebSocket();
        wsB = new FakeWebSocket();
        setupYjsConnection(asWebSocket(wsA), room, makeClient("user-a", true));
        setupYjsConnection(asWebSocket(wsB), room, makeClient("user-b", false));
        // Clear initial sync step 1/2 messages from the setup phase
        wsA.sent = [];
        wsB.sent = [];
    });

    afterEach(() => {
        wsA.close();
        wsB.close();
        room.ydoc.destroy();
        room.awareness.destroy();
    });

    it("broadcasts A's update to B (not back to A)", () => {
        // Simulate: Client A types "hi" locally. Its Y.Doc produces an update,
        // which the client sends to the server as a sync message with the update.
        const clientYdoc = new Y.Doc();
        const clientYtext = clientYdoc.getText("document");
        let producedUpdate: Uint8Array | null = null;
        clientYdoc.on("update", (u) => {
            producedUpdate = u;
        });
        clientYtext.insert(0, "hi");

        // Client A sends that update to the server
        wsA.receive(buildUpdateMessage(requireUpdate(producedUpdate)));

        // B should have received the broadcast
        expect(wsB.sent.length).toBeGreaterThanOrEqual(1);

        // A should NOT have received an echo of its own update
        // (A may receive a trivial sync response with only a header, which is fine,
        // but it shouldn't receive the update broadcast payload itself.)
        const aReceivedBroadcast = wsA.sent.some((msg) => msg.length > 5);
        expect(aReceivedBroadcast).toBe(false);

        // The server's ydoc should reflect A's update
        expect(room.ydoc.getText("document").toString()).toBe("hi");
    });

    it("broadcasts B's update to A (not back to B)", () => {
        const clientYdoc = new Y.Doc();
        const clientYtext = clientYdoc.getText("document");
        let producedUpdate: Uint8Array | null = null;
        clientYdoc.on("update", (u) => {
            producedUpdate = u;
        });
        clientYtext.insert(0, "hello");

        wsB.receive(buildUpdateMessage(requireUpdate(producedUpdate)));

        expect(wsA.sent.length).toBeGreaterThanOrEqual(1);
        const bReceivedBroadcast = wsB.sent.some((msg) => msg.length > 5);
        expect(bReceivedBroadcast).toBe(false);
        expect(room.ydoc.getText("document").toString()).toBe("hello");
    });

    it("with 3 clients, A's update reaches B and C exactly once each", () => {
        const wsC = new FakeWebSocket();
        setupYjsConnection(asWebSocket(wsC), room, makeClient("user-c", false));
        wsA.sent = [];
        wsB.sent = [];
        wsC.sent = [];

        const clientYdoc = new Y.Doc();
        const clientYtext = clientYdoc.getText("document");
        let producedUpdate: Uint8Array | null = null;
        clientYdoc.on("update", (u) => {
            producedUpdate = u;
        });
        clientYtext.insert(0, "xyz");

        wsA.receive(buildUpdateMessage(requireUpdate(producedUpdate)));

        const bBroadcasts = wsB.sent.filter((m) => m.length > 5);
        const cBroadcasts = wsC.sent.filter((m) => m.length > 5);
        const aBroadcasts = wsA.sent.filter((m) => m.length > 5);

        expect(bBroadcasts.length).toBe(1);
        expect(cBroadcasts.length).toBe(1);
        expect(aBroadcasts.length).toBe(0);

        wsC.close();
    });

    it("calls persistence callback once per update (not once per client)", () => {
        // Each client registers with the same persistence callback in prod.
        // Ensure the callback fires EXACTLY ONCE per update, not once per
        // connected client (which would mean 3x writes to Supabase per edit).
        const onUpdate = vi.fn();
        const freshRoom = makeRoom();
        const wsX = new FakeWebSocket();
        const wsY = new FakeWebSocket();
        const wsZ = new FakeWebSocket();
        setupYjsConnection(asWebSocket(wsX), freshRoom, makeClient("x", true), onUpdate);
        setupYjsConnection(asWebSocket(wsY), freshRoom, makeClient("y", false), onUpdate);
        setupYjsConnection(asWebSocket(wsZ), freshRoom, makeClient("z", false), onUpdate);

        const clientYdoc = new Y.Doc();
        const clientYtext = clientYdoc.getText("document");
        let producedUpdate: Uint8Array | null = null;
        clientYdoc.on("update", (u) => {
            producedUpdate = u;
        });
        clientYtext.insert(0, "persist-me");

        wsX.receive(buildUpdateMessage(requireUpdate(producedUpdate)));

        expect(onUpdate).toHaveBeenCalledTimes(1);

        wsX.close();
        wsY.close();
        wsZ.close();
        freshRoom.ydoc.destroy();
        freshRoom.awareness.destroy();
    });
});
