/**
 * sync.test.ts — Tests the actual collab sync algorithm.
 *
 * Verifies that the relay correctly handles the @codemirror/collab protocol:
 * ChangeSet serialization round-trips, concurrent edit rejection + retry,
 * multi-client document convergence, and sequential edit chains.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type CollabServer } from "../src/server.js";
import { encode, decode, type ServerMessage, type ClientMessage, type SerializedUpdate } from "../src/protocol.js";
import { ChangeSet, Text } from "@codemirror/state";
import WebSocket from "ws";

let server: CollabServer;
const TEST_PORT = 9877; // Different from server.test.ts

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

function send(ws: WebSocket, msg: ClientMessage): void {
    ws.send(encode(msg));
}

function sendAndReceive(ws: WebSocket, msg: ClientMessage): Promise<ServerMessage> {
    return new Promise((resolve) => {
        ws.once("message", (data) => {
            resolve(decode(data.toString()) as ServerMessage);
        });
        ws.send(encode(msg));
    });
}

/** Push a ChangeSet and assert success. */
async function pushChanges(
    ws: WebSocket,
    version: number,
    changes: ChangeSet,
    clientID: string,
): Promise<void> {
    const response = await sendAndReceive(ws, {
        type: "pushUpdates",
        version,
        updates: [{ changes: changes.toJSON(), clientID }],
    });
    expect(response).toEqual({ type: "pushUpdates", ok: true });
}

/** Pull updates since a version. */
async function pullUpdates(ws: WebSocket, version: number): Promise<SerializedUpdate[]> {
    const response = await sendAndReceive(ws, { type: "pullUpdates", version });
    expect(response.type).toBe("pullUpdates");
    return (response as any).updates;
}

/** Apply serialized updates to a local Text, returning the new Text and version. */
function applyRemoteUpdates(
    text: Text,
    updates: SerializedUpdate[],
): Text {
    for (const u of updates) {
        const changes = ChangeSet.fromJSON(u.changes);
        text = changes.apply(text);
    }
    return text;
}

describe("sync algorithm", () => {
    it("round-trips a ChangeSet through the full pipeline", async () => {
        const docId = "sync-roundtrip";
        const ws = await connect(docId);

        // Server starts with empty doc. Insert "hello".
        const insert = ChangeSet.of([{ from: 0, insert: "hello" }], 0);
        await pushChanges(ws, 0, insert, "client-A");

        // Pull it back
        const updates = await pullUpdates(ws, 0);
        expect(updates).toHaveLength(1);

        // Deserialize and apply to a fresh empty Text
        let localText = Text.of([""]);
        localText = applyRemoteUpdates(localText, updates);
        expect(localText.toString()).toBe("hello");

        ws.close();
    });

    it("handles sequential edits from one client", async () => {
        const docId = "sync-sequential";
        const ws = await connect(docId);

        // Edit 1: insert "hello" into empty doc
        const edit1 = ChangeSet.of([{ from: 0, insert: "hello" }], 0);
        await pushChanges(ws, 0, edit1, "client-A");

        // Edit 2: append " world" (doc is now length 5)
        const edit2 = ChangeSet.of([{ from: 5, insert: " world" }], 5);
        await pushChanges(ws, 1, edit2, "client-A");

        // Edit 3: insert "!" at end (doc is now length 11)
        const edit3 = ChangeSet.of([{ from: 11, insert: "!" }], 11);
        await pushChanges(ws, 2, edit3, "client-A");

        // Pull all 3 and verify final state
        const updates = await pullUpdates(ws, 0);
        expect(updates).toHaveLength(3);

        let localText = Text.of([""]);
        localText = applyRemoteUpdates(localText, updates);
        expect(localText.toString()).toBe("hello world!");

        ws.close();
    });

    it("rejects concurrent edit at same base version", async () => {
        const docId = "sync-concurrent-reject";
        const ws1 = await connect(docId);
        const ws2 = await connect(docId);

        // Client A inserts "aaa" — accepted
        const editA = ChangeSet.of([{ from: 0, insert: "aaa" }], 0);
        await pushChanges(ws1, 0, editA, "client-A");

        // Client B tries to insert "bbb" at version 0 — should be rejected (stale)
        const response = await sendAndReceive(ws2, {
            type: "pushUpdates",
            version: 0,
            updates: [{ changes: ChangeSet.of([{ from: 0, insert: "bbb" }], 0).toJSON(), clientID: "client-B" }],
        });
        expect(response).toEqual({ type: "pushUpdates", ok: false });

        ws1.close();
        ws2.close();
    });

    it("concurrent clients converge after pull-rebase-retry", async () => {
        const docId = "sync-converge";
        const ws1 = await connect(docId);
        const ws2 = await connect(docId);

        // Client A inserts "hello" at version 0 — accepted
        const editA = ChangeSet.of([{ from: 0, insert: "hello" }], 0);
        await pushChanges(ws1, 0, editA, "client-A");

        // Client B was also at version 0, tries to insert "world" — rejected
        const editB_original = ChangeSet.of([{ from: 0, insert: "world" }], 0);
        const rejectResponse = await sendAndReceive(ws2, {
            type: "pushUpdates",
            version: 0,
            updates: [{ changes: editB_original.toJSON(), clientID: "client-B" }],
        });
        expect(rejectResponse).toEqual({ type: "pushUpdates", ok: false });

        // Client B pulls to get up to date
        const missed = await pullUpdates(ws2, 0);
        expect(missed).toHaveLength(1);

        // Client B applies remote changes locally
        let localB = Text.of([""]);
        localB = applyRemoteUpdates(localB, missed);
        expect(localB.toString()).toBe("hello");

        // Client B rebases: now insert " world" at end of "hello" (position 5)
        const editB_rebased = ChangeSet.of([{ from: 5, insert: " world" }], 5);
        await pushChanges(ws2, 1, editB_rebased, "client-B");

        // Both clients pull all updates and verify convergence
        const allUpdates = await pullUpdates(ws1, 0);
        expect(allUpdates).toHaveLength(2);

        let finalText = Text.of([""]);
        finalText = applyRemoteUpdates(finalText, allUpdates);
        expect(finalText.toString()).toBe("hello world");

        ws1.close();
        ws2.close();
    });

    it("three clients editing sequentially all converge", async () => {
        const docId = "sync-three-clients";
        const ws1 = await connect(docId);
        const ws2 = await connect(docId);
        const ws3 = await connect(docId);

        // Client A: "Once"
        await pushChanges(ws1, 0, ChangeSet.of([{ from: 0, insert: "Once" }], 0), "A");

        // Client B pulls, appends " upon"
        const u1 = await pullUpdates(ws2, 0);
        let textB = applyRemoteUpdates(Text.of([""]), u1);
        await pushChanges(ws2, 1, ChangeSet.of([{ from: 4, insert: " upon" }], 4), "B");

        // Client C pulls all, appends " a time"
        const u2 = await pullUpdates(ws3, 0);
        let textC = applyRemoteUpdates(Text.of([""]), u2);
        await pushChanges(ws3, 2, ChangeSet.of([{ from: 9, insert: " a time" }], 9), "C");

        // Everyone pulls and verifies
        const all = await pullUpdates(ws1, 0);
        const finalText = applyRemoteUpdates(Text.of([""]), all);
        expect(finalText.toString()).toBe("Once upon a time");
        expect(all).toHaveLength(3);

        ws1.close();
        ws2.close();
        ws3.close();
    });

    it("ChangeSet with deletion round-trips correctly", async () => {
        const docId = "sync-deletion";
        const ws = await connect(docId);

        // Insert "hello world"
        await pushChanges(ws, 0, ChangeSet.of([{ from: 0, insert: "hello world" }], 0), "A");

        // Delete " world" (positions 5-11)
        await pushChanges(ws, 1, ChangeSet.of([{ from: 5, to: 11 }], 11), "A");

        const updates = await pullUpdates(ws, 0);
        let text = Text.of([""]);
        text = applyRemoteUpdates(text, updates);
        expect(text.toString()).toBe("hello");

        ws.close();
    });

    it("ChangeSet with replacement round-trips correctly", async () => {
        const docId = "sync-replace";
        const ws = await connect(docId);

        // Insert "hello world"
        await pushChanges(ws, 0, ChangeSet.of([{ from: 0, insert: "hello world" }], 0), "A");

        // Replace "world" with "there" (positions 6-11)
        await pushChanges(ws, 1, ChangeSet.of([{ from: 6, to: 11, insert: "there" }], 11), "A");

        const updates = await pullUpdates(ws, 0);
        let text = Text.of([""]);
        text = applyRemoteUpdates(text, updates);
        expect(text.toString()).toBe("hello there");

        ws.close();
    });
});
