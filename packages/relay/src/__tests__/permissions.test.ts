import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import {
    CUSTOM_ACCESS,
    CUSTOM_COMMENT_RESULT,
    type CommentCommand,
    type LiveRole,
    decodeCustomMessage,
    encodeCommentCommand,
} from "@quillium/share/collab-contract";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { Awareness } from "y-protocols/awareness";
import * as sync from "y-protocols/sync";
import * as Y from "yjs";
import { setupYjsConnection } from "../yjs/sync.js";
import type { YjsRoom } from "../yjs/types.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const close of cleanup.splice(0)) await close();
});

async function fixture(role: LiveRole) {
    const doc = new Y.Doc();
    doc.getText("document").insert(0, "Protected draft");
    const room: YjsRoom = {
        documentId: randomUUID(),
        ydoc: doc,
        awareness: new Awareness(doc),
        clients: new Set(),
        cleanupTimer: null,
        isOwnerConnected: true,
        ownerId: "owner",
    };
    const persisted = vi.fn();
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await once(wss, "listening");
    let serverSocket: WebSocket | undefined;
    wss.on("connection", (socket) => {
        serverSocket = socket;
        setupYjsConnection(
            socket,
            room,
            {
                userId: "guest",
                documentId: room.documentId,
                isOwner: false,
                isAnonymous: true,
                role,
            },
            persisted,
        );
    });
    const client = new WebSocket(`ws://127.0.0.1:${(wss.address() as AddressInfo).port}`);
    const messages: Uint8Array[] = [];
    client.on("message", (data) => messages.push(new Uint8Array(data as Buffer)));
    await once(client, "open");
    cleanup.push(async () => {
        client.terminate();
        serverSocket?.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
        room.awareness.destroy();
        doc.destroy();
    });
    return { doc, room, client, messages, persisted };
}

function updateFrame(update: Uint8Array, step2 = false): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    encoding.writeVarUint(encoder, step2 ? sync.messageYjsSyncStep2 : sync.messageYjsUpdate);
    encoding.writeVarUint8Array(encoder, update);
    return encoding.toUint8Array(encoder);
}

function custom(messages: Uint8Array[], subtype: number) {
    for (const bytes of messages) {
        const decoder = decoding.createDecoder(bytes);
        if (decoding.readVarUint(decoder) !== 3) continue;
        const message = decodeCustomMessage(decoder);
        if (message?.subtype === subtype) return message;
    }
    return undefined;
}

async function until(predicate: () => boolean): Promise<void> {
    await vi.waitFor(() => expect(predicate()).toBe(true), { timeout: 2000, interval: 10 });
}

describe("trusted Live Room permissions over real sockets", () => {
    it.each(["viewer", "commenter"] as const)(
        "rejects %s text updates before broadcast or persistence",
        async (role) => {
            const { doc, client, persisted } = await fixture(role);
            const attacker = new Y.Doc();
            Y.applyUpdate(attacker, Y.encodeStateAsUpdate(doc));
            const vector = Y.encodeStateVector(attacker);
            attacker.getText("document").insert(0, "FORBIDDEN");
            client.send(updateFrame(Y.encodeStateAsUpdate(attacker, vector)));
            await until(() => client.readyState === WebSocket.CLOSED);
            expect(doc.getText("document").toString()).toBe("Protected draft");
            expect(persisted).not.toHaveBeenCalled();
            attacker.destroy();
        },
    );

    it.each([false, true])(
        "rejects full-state replay including nested text and metadata, sync step2=%s",
        async (step2) => {
            const { doc, client, persisted } = await fixture("viewer");
            const attacker = new Y.Doc();
            attacker.getMap("annotations").set(
                "revision",
                new Y.Map([
                    ["_type", "revision"],
                    ["text", new Y.Text("forbidden")],
                ]),
            );
            attacker.getMap("versionGroups").set("group", { role: "editor" });
            attacker.getMap("__quillium").set("owner", "guest");
            client.send(updateFrame(Y.encodeStateAsUpdate(attacker), step2));
            await until(() => client.readyState === WebSocket.CLOSED);
            expect(doc.getMap("annotations").size).toBe(0);
            expect(doc.getMap("versionGroups").size).toBe(0);
            expect(persisted).not.toHaveBeenCalled();
            attacker.destroy();
        },
    );

    it("rejects unresolved CRDT mutations before a later editor dependency can activate them", async () => {
        const { doc, client, persisted } = await fixture("commenter");
        const attacker = new Y.Doc();
        let dependency = new Uint8Array();
        let deferred = new Uint8Array();
        attacker.on("update", (update) => {
            if (!dependency.length) dependency = update;
            else deferred = update;
        });
        attacker.getText("document").insert(0, "dependency");
        attacker.getText("document").insert(0, "FORBIDDEN");
        client.send(updateFrame(deferred));
        await until(() => client.readyState === WebSocket.CLOSED);
        Y.applyUpdate(doc, dependency, "authorized-editor");
        expect(doc.getText("document").toString()).not.toContain("FORBIDDEN");
        expect(persisted).not.toHaveBeenCalled();
        attacker.destroy();
    });

    it("accepts editor text updates", async () => {
        const { doc, client, persisted } = await fixture("editor");
        const editor = new Y.Doc();
        editor.getText("document").insert(0, "Allowed");
        client.send(updateFrame(Y.encodeStateAsUpdate(editor)));
        await until(() => doc.getText("document").toString().includes("Allowed"));
        expect(persisted).toHaveBeenCalledTimes(1);
        editor.destroy();
    });

    it("creates and replies to comments with server authorship and deduplicates replay", async () => {
        const { doc, client, messages, persisted } = await fixture("commenter");
        await until(() => !!custom(messages, CUSTOM_ACCESS));
        const access = custom(messages, CUSTOM_ACCESS);
        if (access?.subtype !== CUSTOM_ACCESS) throw new Error("Missing access frame");
        const text = doc.getText("document");
        const command: CommentCommand = {
            kind: "createComment",
            requestId: randomUUID(),
            roomEpoch: access.payload.roomEpoch,
            scope: [],
            start: Array.from(
                Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, 0)),
            ),
            end: Array.from(
                Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, 4)),
            ),
            message: "A note",
        };
        client.send(encodeCommentCommand(command));
        await until(() => !!custom(messages, CUSTOM_COMMENT_RESULT));
        expect(doc.getMap("annotations").size).toBe(1);
        const node = Array.from(doc.getMap<Y.Map<unknown>>("annotations").values())[0];
        expect((node.get("thread") as Y.Array<unknown>).toArray()).toEqual([
            expect.objectContaining({ message: "A note", author: "guest" }),
        ]);
        client.send(encodeCommentCommand(command));
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(doc.getMap("annotations").size).toBe(1);
        client.send(
            encodeCommentCommand({
                kind: "replyToComment",
                requestId: randomUUID(),
                roomEpoch: access.payload.roomEpoch,
                scope: [],
                annotationId: String(node.get("id")),
                message: "A reply",
            }),
        );
        await until(() => (node.get("thread") as Y.Array<unknown>).length === 2);
        expect(doc.getText("document").toString()).toBe("Protected draft");
        expect(persisted).toHaveBeenCalledTimes(2);
    });
});
