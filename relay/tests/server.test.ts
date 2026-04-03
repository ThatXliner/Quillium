import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type CollabServer } from "../src/server.js";
import { encode, decode, type ServerMessage, type ClientMessage } from "../src/protocol.js";
import WebSocket from "ws";

/**
 * Integration test using a real WebSocket server.
 * Auth is bypassed by setting RELAY_SKIP_AUTH=1 in test env.
 */

let server: CollabServer;
const TEST_PORT = 9876;

beforeAll(async () => {
    process.env.RELAY_SKIP_AUTH = "1";
    server = createServer({ port: TEST_PORT, skipDb: true });
    await server.start();
});

afterAll(async () => {
    await server.stop();
    delete process.env.RELAY_SKIP_AUTH;
});

function connect(docId: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${TEST_PORT}/doc/${docId}`);
        ws.on("open", () => resolve(ws));
        ws.on("error", reject);
    });
}

function sendAndReceive(ws: WebSocket, msg: ClientMessage): Promise<ServerMessage> {
    return new Promise((resolve) => {
        ws.once("message", (data) => {
            resolve(decode(data.toString()) as ServerMessage);
        });
        ws.send(encode(msg));
    });
}

describe("WebSocket server", () => {
    it("accepts a connection and responds to pullUpdates", async () => {
        const ws = await connect("test-doc-1");

        // Push an update first so pulling at version 0 returns immediately
        const pushResponse = await sendAndReceive(ws, {
            type: "pushUpdates",
            version: 0,
            updates: [{ changes: [[0, "hello"]], clientID: "client-1" }],
        });
        expect(pushResponse).toEqual({ type: "pushUpdates", ok: true });

        // Now pull — should return the update immediately
        const response = await sendAndReceive(ws, {
            type: "pullUpdates",
            version: 0,
        });
        expect(response.type).toBe("pullUpdates");
        expect((response as any).updates).toHaveLength(1);
        expect((response as any).updates[0].clientID).toBe("client-1");

        // Pull at current version with no new updates — use long-poll test
        // by pulling at version 1 (current), which would block, so we skip that.
        ws.close();
    });

    it("accepts pushUpdates and broadcasts to other clients", async () => {
        const docId = "test-doc-2";
        const ws1 = await connect(docId);
        const ws2 = await connect(docId);

        // ws2 starts a long-poll pull
        const pullPromise = sendAndReceive(ws2, {
            type: "pullUpdates",
            version: 0,
        });

        // Small delay to ensure ws2's pull is registered
        await new Promise((r) => setTimeout(r, 50));

        // ws1 pushes an update — document starts empty, so insert "hello"
        // ChangeSet JSON for empty doc: ["hello"] means insert "hello"
        const pushResponse = await sendAndReceive(ws1, {
            type: "pushUpdates",
            version: 0,
            updates: [{ changes: [[0, "hello"]], clientID: "client-1" }],
        });
        expect(pushResponse).toEqual({ type: "pushUpdates", ok: true });

        // ws2 should receive the update via its pull
        const pullResponse = await pullPromise;
        expect(pullResponse.type).toBe("pullUpdates");
        expect((pullResponse as any).updates).toHaveLength(1);

        ws1.close();
        ws2.close();
    });

    it("rejects pushUpdates with stale version", async () => {
        const docId = "test-doc-3";
        const ws1 = await connect(docId);

        // Push first update at version 0 — insert "hello" into empty doc
        await sendAndReceive(ws1, {
            type: "pushUpdates",
            version: 0,
            updates: [{ changes: [[0, "hello"]], clientID: "client-1" }],
        });

        // Try to push at version 0 again (stale)
        const response = await sendAndReceive(ws1, {
            type: "pushUpdates",
            version: 0,
            updates: [{ changes: [[0, "world"]], clientID: "client-1" }],
        });
        expect(response).toEqual({ type: "pushUpdates", ok: false });

        ws1.close();
    });
});
