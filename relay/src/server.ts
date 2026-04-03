import { WebSocketServer, type WebSocket } from "ws";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { URL } from "node:url";
import { Document } from "./document.js";
import { encode, decode, type ClientMessage, type ServerMessage } from "./protocol.js";
import { ChangeSet } from "@codemirror/state";
import type { AuthResult } from "./auth.js";

type ClientConnection = {
    ws: WebSocket;
    docId: string;
    auth: AuthResult | null;
};

export type ServerOptions = {
    port: number;
    /** Skip DB persistence (for testing). */
    skipDb?: boolean;
};

export type CollabServer = {
    start(): Promise<void>;
    stop(): Promise<void>;
};

export function createServer(options: ServerOptions): CollabServer {
    const documents = new Map<string, Document>();
    const clients = new Map<WebSocket, ClientConnection>();
    const skipAuth = process.env.RELAY_SKIP_AUTH === "1";

    let httpServer: HttpServer;
    let wss: WebSocketServer;

    function getOrCreateDocument(docId: string): Document {
        let doc = documents.get(docId);
        if (!doc) {
            doc = new Document("");
            documents.set(docId, doc);
        }
        return doc;
    }

    function handleMessage(ws: WebSocket, conn: ClientConnection, raw: string): void {
        let msg: ClientMessage;
        try {
            msg = decode(raw) as ClientMessage;
        } catch {
            return;
        }
        const doc = getOrCreateDocument(conn.docId);

        if (msg.type === "pullUpdates") {
            const updates = doc.getUpdatesSince(msg.version);
            if (updates.length > 0) {
                const response: ServerMessage = { type: "pullUpdates", updates };
                ws.send(encode(response));
            } else {
                // Long poll: wait for updates
                doc.addPendingPull(msg.version, () => {
                    const updates = doc.getUpdatesSince(msg.version);
                    const response: ServerMessage = { type: "pullUpdates", updates };
                    ws.send(encode(response));
                });
            }
        } else if (msg.type === "pushUpdates") {
            // Check permission: viewers and commenters can't push edits
            if (
                conn.auth &&
                (conn.auth.permission === "view" || conn.auth.permission === "comment")
            ) {
                ws.send(encode({ type: "pushUpdates", ok: false }));
                return;
            }

            let ok = true;
            for (const update of msg.updates) {
                try {
                    const changes = ChangeSet.fromJSON(update.changes);
                    const accepted = doc.applyUpdate(changes, update.clientID, msg.version);
                    if (!accepted) {
                        ok = false;
                        break;
                    }
                } catch {
                    ok = false;
                    break;
                }
            }
            ws.send(encode({ type: "pushUpdates", ok }));
        }
    }

    return {
        async start() {
            httpServer = createHttpServer();
            wss = new WebSocketServer({ server: httpServer });

            wss.on("connection", async (ws, req) => {
                // Extract docId from URL: /doc/:docId
                const url = new URL(req.url ?? "/", `http://localhost:${options.port}`);
                const match = url.pathname.match(/^\/doc\/(.+)$/);
                if (!match) {
                    ws.close(4000, "Invalid path");
                    return;
                }
                const docId = match[1];

                // Auth
                let auth: AuthResult | null = null;
                if (!skipAuth) {
                    const token = url.searchParams.get("token");
                    const shareToken = url.searchParams.get("share") ?? undefined;
                    if (!token) {
                        ws.close(4001, "Missing auth token");
                        return;
                    }
                    const { authenticate } = await import("./auth.js");
                    auth = await authenticate(docId, token, shareToken);
                    if (!auth) {
                        ws.close(4003, "Unauthorized");
                        return;
                    }
                }

                const conn: ClientConnection = { ws, docId, auth };
                clients.set(ws, conn);

                ws.on("message", (data) => {
                    handleMessage(ws, conn, data.toString());
                });

                ws.on("close", () => {
                    clients.delete(ws);
                });
            });

            return new Promise<void>((resolve) => {
                httpServer.listen(options.port, () => resolve());
            });
        },

        async stop() {
            for (const ws of wss.clients) {
                ws.close();
            }
            wss.close();
            return new Promise<void>((resolve) => {
                httpServer.close(() => resolve());
            });
        },
    };
}
