import {
    ACCESS_CHANGED_CODE,
    CUSTOM_ACCESS,
    CUSTOM_CLIENT_LEFT,
    CUSTOM_COMMENT_RESULT,
    CUSTOM_OWNER_LEFT,
    type CustomMessage,
    LEGACY_OWNER_LEFT_REASON,
    MESSAGE_COMMENT,
    decodeCommentCommand,
    encodeCustomMessage,
} from "@quillium/share/collab-contract";
export {
    CUSTOM_CLIENT_LEFT,
    CUSTOM_OWNER_LEFT,
    MESSAGE_CUSTOM,
} from "@quillium/share/collab-contract";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import type { WebSocket as WsWebSocket } from "ws";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
/**
 * sync.ts -- Yjs sync protocol handler.
 *
 * Per D-71: Implements y-websocket server pattern.
 * Handles sync and awareness message types.
 *
 * Message types:
 * 0 = sync (Y.Doc state)
 * 1 = awareness (cursor/presence)
 * 3 = custom (owner disconnect, etc.)
 */
import * as Y from "yjs";

// Use ws package WebSocket type
type WebSocket = WsWebSocket;
import { randomUUID } from "node:crypto";
import { createLogger } from "../logger.js";
import { applyCommentCommand } from "./comments.js";
import { clearRoomState, getYjsRoom } from "./rooms.js";
import type { YjsClientData, YjsRoom } from "./types.js";

const logger = createLogger("yjs");

type Connection = {
    active: boolean;
    data: YjsClientData;
    awarenessId?: number;
    expiry?: ReturnType<typeof setTimeout>;
};
type RoomAccess = {
    epoch: string;
    generation: number;
    requests: Map<string, string>;
    connections: Map<WebSocket, Connection>;
};
const accessStates = new WeakMap<YjsRoom, RoomAccess>();

function roomAccess(room: YjsRoom): RoomAccess {
    let state = accessStates.get(room);
    if (!state) {
        state = { epoch: randomUUID(), generation: 0, requests: new Map(), connections: new Map() };
        accessStates.set(room, state);
    }
    return state;
}

function disconnectAccess(room: YjsRoom, ws: WebSocket, connection: Connection): void {
    connection.active = false;
    clearTimeout(connection.expiry);
    room.clients.delete(ws);
    ws.close(ACCESS_CHANGED_CODE, "Access changed. Open your invitation again.");
}

function canReceive(room: YjsRoom, ws: WebSocket): boolean {
    const connection = roomAccess(room).connections.get(ws);
    if (!connection?.active || ws.readyState !== 1) return false;
    if (connection.data.expiresAt && Date.parse(connection.data.expiresAt) <= Date.now()) {
        disconnectAccess(room, ws, connection);
        return false;
    }
    return true;
}

export function getAccessGeneration(room: YjsRoom): string {
    const state = roomAccess(room);
    return `${state.epoch}/${state.generation}`;
}

export function revokeGrantConnections(documentId: string, grantId: string): void {
    const room = getYjsRoom(documentId);
    if (!room) return;
    const state = roomAccess(room);
    state.generation++;
    for (const [ws, connection] of state.connections) {
        if (connection.data.grantId === grantId) disconnectAccess(room, ws, connection);
    }
}

// Message type constants
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;

/**
 * Setup Yjs connection for a WebSocket.
 * Sends initial sync step and registers message handler.
 *
 * @param ws - WebSocket connection
 * @param room - Yjs room
 * @param clientData - Authenticated client data
 * @param onUpdate - Callback when Y.Doc is updated (for persistence)
 */
export function setupYjsConnection(
    ws: WebSocket,
    room: YjsRoom,
    clientData: YjsClientData,
    onUpdate?: (update: Uint8Array) => void,
): void {
    const { ydoc, awareness, clients } = room;

    const access = roomAccess(room);
    const connection: Connection = { active: true, data: clientData };
    access.connections.set(ws, connection);
    if (clientData.expiresAt) {
        const remaining = Date.parse(clientData.expiresAt) - Date.now();
        if (remaining <= 0) {
            disconnectAccess(room, ws, connection);
            access.connections.delete(ws);
            return;
        }
        const expire = (): void => {
            const delay = Date.parse(clientData.expiresAt ?? "") - Date.now();
            if (delay <= 0) disconnectAccess(room, ws, connection);
            else connection.expiry = setTimeout(expire, Math.min(delay, 2_147_483_647));
        };
        expire();
    }
    clients.add(ws);
    ws.send(
        encodeCustomMessage({
            subtype: CUSTOM_ACCESS,
            payload: { role: clientData.role, roomEpoch: access.epoch },
        }),
    );

    // Track owner connection for D-57
    if (clientData.isOwner) {
        room.isOwnerConnected = true;
        room.ownerId = clientData.userId;
    }

    logger.info(
        `Client ${clientData.userId.slice(0, 8)}... joined room ${room.documentId.slice(0, 8)}...`,
    );

    // Send sync step 1 (state vector)
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(syncEncoder, ydoc);
    const syncMsg = encoding.toUint8Array(syncEncoder);
    logger.debug(`Sending sync step 1 to client, ${syncMsg.length} bytes`);
    if (clientData.isOwner || clientData.role === "editor") ws.send(syncMsg);

    // Also send sync step 2 (full doc state) immediately
    // This ensures the client receives the complete document state
    const sync2Encoder = encoding.createEncoder();
    encoding.writeVarUint(sync2Encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep2(sync2Encoder, ydoc);
    const sync2Msg = encoding.toUint8Array(sync2Encoder);
    logger.debug(`Sending sync step 2 to client, ${sync2Msg.length} bytes`);
    ws.send(sync2Msg);

    // Send current awareness states
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(
            awareness,
            Array.from(awareness.getStates().keys()),
        ),
    );
    if (encoding.length(awarenessEncoder) > 1) {
        ws.send(encoding.toUint8Array(awarenessEncoder));
    }

    // Handle Y.Doc updates (broadcast to other clients).
    //
    // This handler is registered per-connection. Because `ydoc.on("update")`
    // fires ALL registered handlers on every update, we must guard so that
    // only the handler for the ORIGIN client does the broadcast (otherwise
    // we'd echo the sender and skip the real recipients, or broadcast N
    // times instead of once).
    const commandOrigin = {};
    const updateHandler = (update: Uint8Array, origin: unknown) => {
        // Only the handler owned by the originating ws should broadcast.
        // Updates from other origins (e.g. server-initiated) still broadcast
        // via the first-registered handler; since all handlers share the
        // same room.clients set, pick the one whose ws matches origin, or
        // fall through for non-ws origins using only the first handler.
        if (origin !== ws && origin !== commandOrigin) return;

        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.writeUpdate(encoder, update);
        const message = encoding.toUint8Array(encoder);

        // Broadcast to all OTHER clients (everyone except the sender)
        for (const client of clients) {
            if ((client !== ws || origin === commandOrigin) && canReceive(room, client)) {
                client.send(message);
            }
        }

        // Trigger persistence callback once per update
        if (onUpdate) {
            onUpdate(update);
        }
    };
    ydoc.on("update", updateHandler);

    // Handle awareness updates (broadcast to all)
    const awarenessHandler = (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        _origin: unknown,
    ) => {
        const changedClients = added.concat(updated, removed);
        if (changedClients.length === 0) return;

        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
            encoder,
            awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients),
        );
        const message = encoding.toUint8Array(encoder);

        // Broadcast to all clients
        for (const client of clients) {
            if (canReceive(room, client)) {
                client.send(message);
            }
        }
    };
    awareness.on("update", awarenessHandler);

    // Handle incoming messages
    ws.on("message", (data: ArrayBuffer) => {
        try {
            if (!connection.active || !clients.has(ws)) return;
            if (clientData.expiresAt && Date.parse(clientData.expiresAt) <= Date.now()) {
                disconnectAccess(room, ws, connection);
                return;
            }
            handleMessage(ws, room, clientData, new Uint8Array(data), commandOrigin);
        } catch (e) {
            logger.error("Message handling error:", e);
        }
    });

    // Handle disconnect
    ws.on("close", () => {
        connection.active = false;
        clearTimeout(connection.expiry);
        access.connections.delete(ws);
        clients.delete(ws);
        ydoc.off("update", updateHandler);
        awareness.off("update", awarenessHandler);

        // Remove client's awareness state (fixes ghost cursor bug)
        if (connection.awarenessId !== undefined) {
            awarenessProtocol.removeAwarenessStates(
                awareness,
                [connection.awarenessId],
                "disconnect",
            );
        }

        // Broadcast client left
        broadcastCustomMessage(clients, {
            subtype: CUSTOM_CLIENT_LEFT,
            payload: { userId: clientData.userId },
        });

        logger.info(
            `Client ${clientData.userId.slice(0, 8)}... left room ${room.documentId.slice(0, 8)}...`,
        );

        // Handle owner disconnect (D-57, D-61)
        if (clientData.isOwner) {
            room.isOwnerConnected = false;
            logger.info(
                `Owner left, kicking all clients from room ${room.documentId.slice(0, 8)}...`,
            );

            // Send ownerLeft message to all remaining clients
            broadcastCustomMessage(clients, { subtype: CUSTOM_OWNER_LEFT, payload: {} });

            // Close all client connections
            for (const client of clients) {
                const peer = access.connections.get(client);
                if (peer) peer.active = false;
                client.close(1000, LEGACY_OWNER_LEFT_REASON);
            }
            clients.clear();
            access.epoch = randomUUID();
            access.generation++;
            access.requests.clear();

            // Per D-55/D-57: Live Room mode — owner's local SQLite is source of truth.
            // Clear Y.Doc and awareness so reconnecting owner gets fresh state.
            // This prevents stale content/cursors from previous session.
            clearRoomState(room);
        }
    });
}

/**
 * Handle incoming Yjs protocol message.
 */
function handleMessage(
    ws: WebSocket,
    room: YjsRoom,
    clientData: YjsClientData,
    data: Uint8Array,
    commandOrigin: object,
): void {
    const { ydoc, awareness } = room;
    const decoder = decoding.createDecoder(data);
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
        case MESSAGE_SYNC: {
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, MESSAGE_SYNC);

            // Read sync message and write response
            // Wrap in try-catch per T-07.5-07: malformed data mitigation
            try {
                const subtype = decoding.readVarUint(decoder);
                if (subtype === syncProtocol.messageYjsSyncStep1) {
                    syncProtocol.readSyncStep1(decoder, encoder, ydoc);
                } else if (
                    subtype === syncProtocol.messageYjsSyncStep2 ||
                    subtype === syncProtocol.messageYjsUpdate
                ) {
                    if (!clientData.isOwner && clientData.role !== "editor") {
                        const connection = roomAccess(room).connections.get(ws);
                        if (connection) disconnectAccess(room, ws, connection);
                        return;
                    }
                    syncProtocol.readSyncStep2(decoder, ydoc, ws);
                } else {
                    throw new Error("Unknown sync subtype");
                }
                const messageType = subtype;
                logger.debug(
                    `Received sync message type ${messageType}, response length: ${encoding.length(encoder)}`,
                );
            } catch (e) {
                logger.error("Malformed sync message, disconnecting client:", e);
                ws.close(1003, "Malformed sync message");
                return;
            }

            // Send response if any
            if (encoding.length(encoder) > 1) {
                logger.debug(`Sending sync response, ${encoding.length(encoder)} bytes`);
                ws.send(encoding.toUint8Array(encoder));
            }
            break;
        }

        case MESSAGE_COMMENT: {
            if (data.byteLength > 65536) {
                ws.close(1009, "Comment command too large");
                return;
            }
            let requestId: string | undefined;
            try {
                const command = decodeCommentCommand(decoder);
                requestId = command.requestId;
                if (!clientData.isOwner && clientData.role === "viewer")
                    throw new Error("Comment permission required");
                const access = roomAccess(room);
                if (command.roomEpoch !== access.epoch)
                    throw new Error("This Live Room session has ended");
                const key = `${clientData.userId}/${command.requestId}`;
                const serialized = JSON.stringify(command);
                const previous = access.requests.get(key);
                if (previous !== undefined && previous !== serialized)
                    throw new Error("Request ID already used");
                if (previous === undefined) {
                    if (access.requests.size >= 10000)
                        throw new Error("Comment limit reached for this session");
                    applyCommentCommand(ydoc, command, clientData.userId, commandOrigin);
                    access.requests.set(key, serialized);
                }
                ws.send(
                    encodeCustomMessage({
                        subtype: CUSTOM_COMMENT_RESULT,
                        payload: { requestId, ok: true },
                    }),
                );
            } catch (error) {
                if (requestId) {
                    ws.send(
                        encodeCustomMessage({
                            subtype: CUSTOM_COMMENT_RESULT,
                            payload: {
                                requestId,
                                ok: false,
                                error: error instanceof Error ? error.message : "Invalid comment",
                            },
                        }),
                    );
                } else {
                    ws.close(1003, "Invalid comment command");
                }
            }
            break;
        }

        case MESSAGE_AWARENESS: {
            // Wrap in try-catch per T-07.5-07: malformed data mitigation
            try {
                const payload = decoding.readVarUint8Array(decoder);
                const presence = decoding.createDecoder(payload);
                if (decoding.readVarUint(presence) !== 1)
                    throw new Error("Expected one presence identity");
                const id = decoding.readVarUint(presence);
                const clock = decoding.readVarUint(presence);
                const value: unknown = JSON.parse(decoding.readVarString(presence));
                if (decoding.hasContent(presence)) throw new Error("Trailing presence data");
                const access = roomAccess(room);
                const connection = access.connections.get(ws);
                if (!connection) return;
                if (connection.awarenessId !== undefined && connection.awarenessId !== id)
                    throw new Error("Presence identity changed");
                for (const [other, peer] of access.connections) {
                    if (other !== ws && peer.awarenessId === id)
                        throw new Error("Presence identity already belongs to another connection");
                }
                if (value !== null && (typeof value !== "object" || Array.isArray(value)))
                    throw new Error("Invalid presence");
                connection.awarenessId = id;
                const sanitized =
                    value === null
                        ? null
                        : {
                              ...value,
                              userId: clientData.userId,
                              role: clientData.role,
                              isOwner: clientData.isOwner,
                          };
                const encoded = encoding.createEncoder();
                encoding.writeVarUint(encoded, 1);
                encoding.writeVarUint(encoded, id);
                encoding.writeVarUint(encoded, clock);
                encoding.writeVarString(encoded, JSON.stringify(sanitized));
                awarenessProtocol.applyAwarenessUpdate(
                    awareness,
                    encoding.toUint8Array(encoded),
                    ws,
                );
            } catch (e) {
                logger.error("Malformed awareness message:", e);
                // Don't disconnect for awareness issues, just log
            }
            break;
        }

        default:
            logger.warn(`Unknown message type: ${messageType}`);
    }
}

/**
 * Broadcast custom message to all clients.
 */
function broadcastCustomMessage(clients: Set<WebSocket>, customMessage: CustomMessage): void {
    const message = encodeCustomMessage(customMessage);

    for (const client of clients) {
        if (client.readyState === 1) {
            client.send(message);
        }
    }
}
