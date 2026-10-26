/**
 * room.test.ts -- Tests for Yjs room lifecycle management.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import * as Y from "yjs";

vi.mock("../persistence/yjsUpdates.js", () => ({
    loadYjsState: vi.fn(async () => ({ ydoc: new Y.Doc(), stateVector: null })),
    persistYjsState: vi.fn(async () => ({ success: true })),
    clearYjsUpdates: vi.fn(async () => undefined),
}));

vi.mock("../persistence/debouncedUpdates.js", () => ({
    flushDocumentUpdates: vi.fn(async () => undefined),
}));

import { flushDocumentUpdates } from "../persistence/debouncedUpdates.js";
import { clearYjsUpdates, loadYjsState, persistYjsState } from "../persistence/yjsUpdates.js";
import {
    _clearAllRooms,
    cancelRoomCleanup,
    clearRoomState,
    getOrCreateYjsRoom,
    getRoomCount,
    getYjsRoom,
    scheduleRoomCleanup,
} from "../yjs/rooms.js";
function fakeWebSocket(): WebSocket {
    return {} as WebSocket;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve = (_value: T): void => {};
    const promise = new Promise<T>((complete) => {
        resolve = complete;
    });
    return { promise, resolve };
}

function makeLegacyYdoc(): Y.Doc {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("document");
    const annotations = ydoc.getMap<Y.Map<unknown>>("annotations");
    const revision = new Y.Map<unknown>();

    ydoc.transact(() => {
        ytext.insert(0, "hello");
        annotations.set("rev", revision);
        revision.set("id", "rev");
        revision.set("_type", "revision");
        revision.set(
            "startPos",
            Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(ytext, 0)),
        );
        revision.set(
            "endPos",
            Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(ytext, 5)),
        );
        revision.set("thread", new Y.Array());
        revision.set("annotations", new Y.Map());
        revision.set("activeVersionIndex", 0);

        const versions = new Y.Map<Y.Map<unknown>>();
        revision.set("versions", versions);
        const version = new Y.Map<unknown>();
        const versionText = new Y.Text();
        versions.set("0", version);
        version.set("text", versionText);
        versionText.insert(0, "hello");
        version.set("annotations", new Y.Map());
    }, "init");

    return ydoc;
}

describe("Yjs room manager", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
        _clearAllRooms();
    });

    afterEach(() => {
        vi.useRealTimers();
        _clearAllRooms();
    });

    it("creates a Yjs room and loads persisted state once", async () => {
        const room = await getOrCreateYjsRoom("doc-1");

        expect(room.documentId).toBe("doc-1");
        expect(room.clients.size).toBe(0);
        expect(room.isOwnerConnected).toBe(false);
        expect(getRoomCount()).toBe(1);
        expect(loadYjsState).toHaveBeenCalledTimes(1);
    });

    it("returns the same in-memory room on repeated calls", async () => {
        const room1 = await getOrCreateYjsRoom("doc-2");
        const room2 = await getOrCreateYjsRoom("doc-2");

        expect(room1).toBe(room2);
        expect(loadYjsState).toHaveBeenCalledTimes(1);
    });

    it("shares initialization between concurrent room acquisitions", async () => {
        const load = deferred<Awaited<ReturnType<typeof loadYjsState>>>();
        vi.mocked(loadYjsState).mockReturnValueOnce(load.promise);
        const first = getOrCreateYjsRoom("doc-concurrent");
        const second = getOrCreateYjsRoom("doc-concurrent");
        load.resolve({ ydoc: new Y.Doc(), stateVector: null });

        expect(await first).toBe(await second);
        expect(loadYjsState).toHaveBeenCalledTimes(1);
    });

    it("allows another acquisition after initialization fails", async () => {
        vi.mocked(loadYjsState).mockRejectedValueOnce(new Error("storage unavailable"));

        await expect(getOrCreateYjsRoom("doc-retry")).rejects.toThrow();
        const room = await getOrCreateYjsRoom("doc-retry");

        expect(room.ydoc.isDestroyed).toBe(false);
        expect(getYjsRoom("doc-retry")).toBe(room);
    });

    it("migrates and snapshots legacy Yjs schema on room creation", async () => {
        const legacyYdoc = makeLegacyYdoc();
        vi.mocked(loadYjsState).mockResolvedValueOnce({ ydoc: legacyYdoc, stateVector: null });

        const room = await getOrCreateYjsRoom("doc-legacy");

        const revision = room.ydoc.getMap<Y.Map<unknown>>("annotations").get("rev");
        if (!(revision instanceof Y.Map)) throw new Error("Expected migrated revision");
        expect(revision.get("activeVersionIndex")).toBeUndefined();
        expect(revision.get("activeVersionId")).toBe("legacy-0");
        expect(persistYjsState).toHaveBeenCalledWith("doc-legacy", legacyYdoc);
        expect(clearYjsUpdates).toHaveBeenCalledWith("doc-legacy");
    });

    it("getYjsRoom returns undefined for unknown rooms", () => {
        expect(getYjsRoom("missing-doc")).toBeUndefined();
    });

    it("cancels pending cleanup when the room is reused", async () => {
        vi.useFakeTimers();
        const room = await getOrCreateYjsRoom("doc-cleanup");

        scheduleRoomCleanup(room);
        expect(room.cleanupTimer).not.toBeNull();

        await getOrCreateYjsRoom("doc-cleanup");
        expect(room.cleanupTimer).toBeNull();
    });

    it("can cancel cleanup directly", async () => {
        vi.useFakeTimers();
        const room = await getOrCreateYjsRoom("doc-cancel");

        scheduleRoomCleanup(room);
        cancelRoomCleanup(room);

        expect(room.cleanupTimer).toBeNull();
    });

    it("flushes pending updates, snapshots, clears update log, and removes empty rooms on cleanup", async () => {
        vi.useFakeTimers();
        const room = await getOrCreateYjsRoom("doc-empty");
        room.ydoc.getText("document").insert(0, "hello");

        scheduleRoomCleanup(room);
        await vi.advanceTimersByTimeAsync(45_000);

        expect(flushDocumentUpdates).toHaveBeenCalledWith("doc-empty");
        expect(persistYjsState).toHaveBeenCalledWith("doc-empty", room.ydoc);
        expect(clearYjsUpdates).toHaveBeenCalledWith("doc-empty");
        expect(getYjsRoom("doc-empty")).toBeUndefined();
    });

    it("does not remove rooms that receive a client before cleanup fires", async () => {
        vi.useFakeTimers();
        const room = await getOrCreateYjsRoom("doc-active");
        room.clients.add(fakeWebSocket());
        vi.mocked(persistYjsState).mockClear();
        vi.mocked(clearYjsUpdates).mockClear();

        scheduleRoomCleanup(room);
        await vi.advanceTimersByTimeAsync(45_000);

        expect(persistYjsState).not.toHaveBeenCalled();
        expect(getYjsRoom("doc-active")).toBe(room);
    });

    it.each(["flush", "snapshot", "clear"])(
        "waits for cleanup during %s before admitting a rejoin",
        async (phase) => {
            vi.useFakeTimers();
            const room = await getOrCreateYjsRoom(`doc-rejoin-${phase}`);
            const barrier = deferred<void>();
            if (phase === "flush") {
                vi.mocked(flushDocumentUpdates).mockReturnValueOnce(barrier.promise);
            } else if (phase === "snapshot") {
                vi.mocked(persistYjsState).mockReturnValueOnce(
                    barrier.promise.then(() => ({ success: true })),
                );
            } else {
                vi.mocked(clearYjsUpdates).mockReturnValueOnce(barrier.promise);
            }
            scheduleRoomCleanup(room);
            await vi.advanceTimersByTimeAsync(45_000);

            let joined = false;
            const rejoin = getOrCreateYjsRoom(room.documentId).then((nextRoom) => {
                joined = true;
                nextRoom.clients.add(fakeWebSocket());
                nextRoom.ydoc.getText("document").insert(0, "after rejoin");
                return nextRoom;
            });
            await Promise.resolve();
            const admittedDuringCleanup = joined;
            barrier.resolve();
            const nextRoom = await rejoin;
            await vi.advanceTimersByTimeAsync(0);

            expect(admittedDuringCleanup).toBe(false);
            expect(nextRoom.ydoc.isDestroyed).toBe(false);
            expect(nextRoom.ydoc.getText("document").toString()).toBe("after rejoin");
            expect(getYjsRoom(room.documentId)).toBe(nextRoom);
        },
    );

    it.each(["flush", "snapshot-result", "snapshot-rejection", "clear"])(
        "retains the live document when cleanup fails at %s",
        async (phase) => {
            vi.useFakeTimers();
            const room = await getOrCreateYjsRoom(`doc-failure-${phase}`);
            room.ydoc.getText("document").insert(0, "keep this text");
            vi.mocked(clearYjsUpdates).mockClear();
            if (phase === "flush") {
                vi.mocked(flushDocumentUpdates).mockRejectedValueOnce(new Error("write failed"));
            } else if (phase === "snapshot-result") {
                vi.mocked(persistYjsState).mockResolvedValueOnce({ success: false });
            } else if (phase === "snapshot-rejection") {
                vi.mocked(persistYjsState).mockRejectedValueOnce(new Error("snapshot failed"));
            } else {
                vi.mocked(clearYjsUpdates).mockRejectedValueOnce(new Error("delete failed"));
            }

            scheduleRoomCleanup(room);
            await vi.advanceTimersByTimeAsync(45_000);

            expect(await getOrCreateYjsRoom(room.documentId)).toBe(room);
            expect(room.ydoc.isDestroyed).toBe(false);
            expect(room.ydoc.getText("document").toString()).toBe("keep this text");
            if (phase !== "clear") expect(clearYjsUpdates).not.toHaveBeenCalled();
        },
    );

    it("retries failed cleanup while retaining the document until storage recovers", async () => {
        vi.useFakeTimers();
        const room = await getOrCreateYjsRoom("doc-cleanup-retry");
        room.ydoc.getText("document").insert(0, "retained text");
        vi.mocked(persistYjsState).mockResolvedValueOnce({ success: false });
        vi.mocked(clearYjsUpdates).mockClear();
        scheduleRoomCleanup(room);
        await vi.advanceTimersByTimeAsync(45_000);

        expect(room.ydoc.isDestroyed).toBe(false);
        expect(clearYjsUpdates).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(45_000);

        expect(persistYjsState).toHaveBeenLastCalledWith(room.documentId, room.ydoc);
        expect(clearYjsUpdates).toHaveBeenCalledWith(room.documentId);
        expect(room.ydoc.isDestroyed).toBe(true);
        expect(getYjsRoom(room.documentId)).toBeUndefined();
    });

    it("clears document text, annotations, version groups, and awareness state", async () => {
        const room = await getOrCreateYjsRoom("doc-clear");
        room.ydoc.getText("document").insert(0, "hello");
        room.ydoc.getMap("annotations").set("a1", { text: "note" });
        room.ydoc.getMap("versionGroups").set("g1", { label: "Linked" });
        room.awareness.setLocalState({ user: "owner" });

        clearRoomState(room);

        expect(room.ydoc.getText("document").toString()).toBe("");
        expect(room.ydoc.getMap("annotations").size).toBe(0);
        expect(room.ydoc.getMap("versionGroups").size).toBe(0);
        expect(room.awareness.getStates().size).toBe(0);
    });
});
