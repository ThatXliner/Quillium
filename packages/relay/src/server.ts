/**
 * server.ts -- Native WebSocket server with Yjs sync protocol.
 *
 * Per D-71: Replace Socket.io with native WebSocket + Yjs.
 * Uses 'ws' package for WebSocket server.
 *
 * Connection flow:
 * 1. HTTP upgrade request with JWT in params
 * 2. Auth validation in upgrade handler
 * 3. WebSocket accepted, Yjs sync established
 */
import { type Server as HttpServer, type IncomingMessage, createServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import {
    type InvitationEmailSender,
    LiveRoomAccessService,
    createAccessHttpHandler,
    createResendInvitationSender,
} from "./access/index.js";
import { authenticateWebSocket } from "./auth/middleware.js";
import { supabase } from "./auth/supabase.js";
import { createLogger } from "./logger.js";
import { isOriginAllowed } from "./origins.js";
import { flushAllDocumentUpdates, queueYjsUpdate } from "./persistence/debouncedUpdates.js";
import { getOrCreateYjsRoom, getRoomCount, getYjsRoom, scheduleRoomCleanup } from "./yjs/rooms.js";
import { getAccessGeneration, revokeGrantConnections, setupYjsConnection } from "./yjs/sync.js";

const logger = createLogger("server");

/**
 * Create and configure the Yjs relay server.
 */
export function createRelayServer(options: { email?: InvitationEmailSender } = {}): {
    wss: WebSocketServer;
    httpServer: HttpServer;
    close: () => Promise<void>;
} {
    const email =
        options.email ??
        (process.env.INVITATION_RESEND_API_KEY && process.env.INVITATION_EMAIL_FROM
            ? createResendInvitationSender({
                  apiKey: process.env.INVITATION_RESEND_API_KEY,
                  from: process.env.INVITATION_EMAIL_FROM,
              })
            : undefined);
    const accessHandler = supabase
        ? createAccessHttpHandler({
              supabase,
              isRoomOpen: (documentId) => getYjsRoom(documentId)?.isOwnerConnected === true,
              service: new LiveRoomAccessService({
                  supabase,
                  onGrantChanged: revokeGrantConnections,
                  email,
              }),
          })
        : undefined;
    const httpServer = createServer((req, res) => {
        if (req.url?.startsWith("/access/")) {
            if (!accessHandler) {
                res.writeHead(503);
                res.end("Access unavailable");
                return;
            }
            void accessHandler(req, res).catch((error: unknown) => {
                logger.error("Access request failed", error);
                if (!res.headersSent) res.writeHead(503);
                res.end();
            });
            return;
        }
        // Health check endpoint
        if (req.url === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    status: "ok",
                    timestamp: Date.now(),
                    rooms: getRoomCount(),
                    protocol: "yjs",
                }),
            );
            return;
        }
        res.writeHead(404);
        res.end("Not found");
    });

    const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
    const upgradingSockets = new Set<Duplex>();
    const initializingConnections = new Set<Promise<void>>();
    let accepting = true;
    let closing: Promise<void> | null = null;

    // Handle WebSocket upgrade with auth
    httpServer.on("upgrade", async (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        upgradingSockets.add(socket);
        socket.once("close", () => upgradingSockets.delete(socket));
        try {
            if (!accepting) {
                socket.destroy();
                return;
            }
            if (!isOriginAllowed(request.headers.origin)) {
                socket.write("HTTP/1.1 403 Forbidden\r\n\r\nOrigin not allowed");
                socket.destroy();
                return;
            }

            if (!request.url) {
                socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
                socket.destroy();
                return;
            }

            // Parse URL for auth params
            const url = new URL(request.url, `http://${request.headers.host}`);
            const token = url.searchParams.get("auth");
            const documentId = url.pathname.slice(1); // /docId -> docId

            // Skip non-document paths
            if (!documentId || documentId === "health") {
                socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
                socket.destroy();
                return;
            }

            // Authenticate
            const authResult = await authenticateWebSocket(
                token,
                documentId,
                url.searchParams.get("invitation"),
            );
            if (!accepting || socket.destroyed) {
                socket.destroy();
                return;
            }

            if (!authResult.success || !authResult.data) {
                logger.info(`Auth failed: ${authResult.error}`);
                socket.write(`HTTP/1.1 401 Unauthorized\r\n\r\n${authResult.error || ""}`);
                socket.destroy();
                return;
            }

            // Upgrade to WebSocket
            wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
                upgradingSockets.delete(socket);
                const initialize = async (): Promise<void> => {
                    try {
                        const room = await getOrCreateYjsRoom(documentId);
                        if (!accepting || ws.readyState !== WebSocket.OPEN) {
                            if (room.clients.size === 0) scheduleRoomCleanup(room);
                            return;
                        }
                        const generation = getAccessGeneration(room);
                        const refreshed = await authenticateWebSocket(
                            token,
                            documentId,
                            url.searchParams.get("invitation"),
                        );
                        if (
                            !accepting ||
                            ws.readyState !== WebSocket.OPEN ||
                            !refreshed.success ||
                            !refreshed.data ||
                            generation !== getAccessGeneration(room)
                        ) {
                            ws.close(4003, "Access changed. Open your invitation again.");
                            if (room.clients.size === 0) scheduleRoomCleanup(room);
                            return;
                        }
                        setupYjsConnection(ws, room, refreshed.data, (update) => {
                            queueYjsUpdate(documentId, update);
                        });
                        ws.on("close", () => {
                            if (room.clients.size === 0) scheduleRoomCleanup(room);
                        });
                    } catch (error) {
                        logger.error(`Room initialization failed for ${documentId}`, error);
                        ws.close(1011, "Room initialization failed");
                    }
                };
                const initialization = initialize();
                initializingConnections.add(initialization);
                void initialization.finally(() => {
                    initializingConnections.delete(initialization);
                });
            });
        } catch (e) {
            logger.error("Upgrade error:", e);
            socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
            socket.destroy();
        }
    });

    const close = (): Promise<void> => {
        if (closing) return closing;
        accepting = false;
        for (const socket of upgradingSockets) socket.destroy();
        for (const client of wss.clients) {
            client.removeAllListeners("message");
            client.close(1001, "Server shutting down");
        }
        const socketsClosed = new Promise<void>((resolve, reject) => {
            wss.close((error) => (error ? reject(error) : resolve()));
        });
        const httpClosed = new Promise<void>((resolve, reject) => {
            httpServer.close((error) => (error ? reject(error) : resolve()));
        });
        closing = Promise.all([
            flushAllDocumentUpdates(),
            ...initializingConnections,
            socketsClosed,
            httpClosed,
        ]).then(() => undefined);
        return closing;
    };

    return { wss, httpServer, close };
}

// Export for types
export type { WebSocketServer, WebSocket };
