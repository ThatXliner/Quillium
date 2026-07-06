import * as decoding from "lib0/decoding";
/**
 * owner.test.ts -- Tests for owner disconnect behavior in the Yjs relay.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import {
    CUSTOM_CLIENT_LEFT,
    CUSTOM_OWNER_LEFT,
    MESSAGE_CUSTOM,
    setupYjsConnection,
} from "../yjs/sync.js";
import type { YjsClientData, YjsRoom } from "../yjs/types.js";

type FakeListener = (...args: unknown[]) => void;

class FakeWebSocket {
    public sent: Uint8Array[] = [];
    public readyState = 1;
    public closeCode: number | null = null;
    public closeReason: string | null = null;
    private listeners: Record<string, FakeListener[]> = {};

    send(data: Uint8Array): void {
        this.sent.push(data);
    }

    close(code = 1000, reason = ""): void {
        this.closeCode = code;
        this.closeReason = reason;
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
}

function asWebSocket(ws: FakeWebSocket): WebSocket {
    return ws as unknown as WebSocket;
}

function makeRoom(): YjsRoom {
    const ydoc = new Y.Doc();
    return {
        documentId: "test-doc",
        ydoc,
        awareness: new Awareness(ydoc),
        clients: new Set(),
        cleanupTimer: null,
        isOwnerConnected: false,
        ownerId: null,
    };
}

function makeClient(userId: string, isOwner: boolean): YjsClientData {
    return {
        userId,
        documentId: "test-doc",
        isAnonymous: false,
        isOwner,
    };
}

function readCustomMessage(
    message: Uint8Array,
): { subtype: number; payload: Record<string, unknown> } | null {
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);

    if (messageType !== MESSAGE_CUSTOM) {
        return null;
    }

    const subtype = decoding.readVarUint(decoder);
    const payload = JSON.parse(decoding.readVarString(decoder)) as Record<string, unknown>;

    return { subtype, payload };
}

function customMessages(ws: FakeWebSocket) {
    return ws.sent.map(readCustomMessage).filter((message) => message !== null);
}

describe("owner disconnect", () => {
    let rooms: YjsRoom[] = [];

    afterEach(() => {
        for (const room of rooms) {
            room.ydoc.destroy();
            room.awareness.destroy();
        }
        rooms = [];
    });

    it("tracks owner presence while the owner is connected", () => {
        const room = makeRoom();
        rooms.push(room);
        const owner = new FakeWebSocket();

        setupYjsConnection(asWebSocket(owner), room, makeClient("owner-user", true));

        expect(room.isOwnerConnected).toBe(true);
        expect(room.ownerId).toBe("owner-user");

        owner.close();

        expect(room.isOwnerConnected).toBe(false);
    });

    it("sends ownerLeft and closes collaborators when the owner disconnects", () => {
        const room = makeRoom();
        rooms.push(room);
        const owner = new FakeWebSocket();
        const collaborator = new FakeWebSocket();

        setupYjsConnection(asWebSocket(owner), room, makeClient("owner-user", true));
        setupYjsConnection(asWebSocket(collaborator), room, makeClient("collaborator-user", false));
        owner.sent = [];
        collaborator.sent = [];

        owner.close();

        const messages = customMessages(collaborator);
        expect(messages.some((message) => message.subtype === CUSTOM_OWNER_LEFT)).toBe(true);
        expect(messages.some((message) => message.subtype === CUSTOM_CLIENT_LEFT)).toBe(true);
        expect(collaborator.closeCode).toBe(1000);
        expect(collaborator.closeReason).toBe("Owner left");
        expect(room.isOwnerConnected).toBe(false);
    });

    it("does not close the owner when a collaborator disconnects", () => {
        const room = makeRoom();
        rooms.push(room);
        const owner = new FakeWebSocket();
        const collaborator = new FakeWebSocket();

        setupYjsConnection(asWebSocket(owner), room, makeClient("owner-user", true));
        setupYjsConnection(asWebSocket(collaborator), room, makeClient("collaborator-user", false));
        owner.sent = [];

        collaborator.close();

        const messages = customMessages(owner);
        expect(messages.some((message) => message.subtype === CUSTOM_CLIENT_LEFT)).toBe(true);
        expect(messages.some((message) => message.subtype === CUSTOM_OWNER_LEFT)).toBe(false);
        expect(owner.readyState).toBe(1);
        expect(room.isOwnerConnected).toBe(true);
    });

    it("clears shared document state when the owner leaves", () => {
        const room = makeRoom();
        rooms.push(room);
        const owner = new FakeWebSocket();

        room.ydoc.getText("document").insert(0, "draft text");
        room.ydoc.getMap("annotations").set("a1", { text: "note" });

        setupYjsConnection(asWebSocket(owner), room, makeClient("owner-user", true));
        owner.close();

        expect(room.ydoc.getText("document").toString()).toBe("");
        expect(room.ydoc.getMap("annotations").size).toBe(0);
    });
});
