import { Awareness, removeAwarenessStates } from "y-protocols/awareness";
/**
 * rooms.ts -- Yjs room lifecycle management.
 *
 * Per D-71: Rooms hold Y.Doc instead of @codemirror/state Text.
 * Per D-37: Room cleanup delay (45 seconds after last client leaves).
 */
import type * as Y from "yjs";
import { createLogger } from "../logger.js";
import { flushDocumentUpdates } from "../persistence/debouncedUpdates.js";
import { clearYjsUpdates, loadYjsState, persistYjsState } from "../persistence/yjsUpdates.js";
import { migrateYjsDoc } from "./migrations.js";
import type { YjsRoom } from "./types.js";

const logger = createLogger("yjs/rooms");

/** Per D-37: Room cleanup delay (45 seconds) */
const ROOM_CLEANUP_DELAY_MS = 45_000;

type RoomSlot =
    | { kind: "opening"; ready: Promise<YjsRoom> }
    | { kind: "ready"; room: YjsRoom }
    | { kind: "cleaning"; room: YjsRoom; finished: Promise<void> };

const rooms = new Map<string, RoomSlot>();

export async function getOrCreateYjsRoom(documentId: string): Promise<YjsRoom> {
    while (true) {
        const slot = rooms.get(documentId);
        if (slot?.kind === "ready") {
            cancelRoomCleanup(slot.room);
            return slot.room;
        }
        if (slot?.kind === "opening") return slot.ready;
        if (slot?.kind === "cleaning") {
            await slot.finished;
            continue;
        }

        const opening: Extract<RoomSlot, { kind: "opening" }> = {
            kind: "opening",
            ready: Promise.resolve().then(async () => {
                let ydoc: Y.Doc | undefined;
                try {
                    ({ ydoc } = await loadYjsState(documentId));
                    const migration = migrateYjsDoc(ydoc);
                    if (migration.changed) {
                        const persisted = await persistYjsState(documentId, ydoc);
                        if (persisted.success) await clearYjsUpdates(documentId);
                        logger.info(
                            `Migrated room ${documentId.slice(0, 8)}... to Yjs schema v${migration.currentVersion}`,
                        );
                    }
                    const awareness = new Awareness(ydoc);
                    awareness.setLocalState(null);
                    const room: YjsRoom = {
                        documentId,
                        ydoc,
                        awareness,
                        clients: new Set(),
                        cleanupTimer: null,
                        isOwnerConnected: false,
                        ownerId: null,
                    };
                    rooms.set(documentId, { kind: "ready", room });
                    logger.info(`Created room ${documentId.slice(0, 8)}...`);
                    return room;
                } catch (error) {
                    ydoc?.destroy();
                    if (rooms.get(documentId) === opening) rooms.delete(documentId);
                    throw error;
                }
            }),
        };
        rooms.set(documentId, opening);
        return opening.ready;
    }
}

export function getYjsRoom(documentId: string): YjsRoom | undefined {
    const slot = rooms.get(documentId);
    return slot?.kind === "ready" ? slot.room : undefined;
}

export function scheduleRoomCleanup(room: YjsRoom): void {
    const current = rooms.get(room.documentId);
    if (current?.kind !== "ready" || current.room !== room) return;
    cancelRoomCleanup(room);

    room.cleanupTimer = setTimeout(() => {
        room.cleanupTimer = null;
        if (room.clients.size > 0 || rooms.get(room.documentId) !== current) return;

        const cleaning: Extract<RoomSlot, { kind: "cleaning" }> = {
            kind: "cleaning",
            room,
            finished: Promise.resolve().then(async () => {
                try {
                    await flushDocumentUpdates(room.documentId);
                    const persisted = await persistYjsState(room.documentId, room.ydoc);
                    if (!persisted.success) {
                        throw new Error(persisted.error ?? "Failed to persist room snapshot");
                    }
                    await clearYjsUpdates(room.documentId);
                    room.awareness.destroy();
                    room.ydoc.destroy();
                    if (rooms.get(room.documentId) === cleaning) rooms.delete(room.documentId);
                    logger.info(`Cleaned up room ${room.documentId.slice(0, 8)}...`);
                } catch (error) {
                    logger.error(`Cleanup failed for ${room.documentId.slice(0, 8)}...`, error);
                    if (rooms.get(room.documentId) === cleaning) {
                        rooms.set(room.documentId, { kind: "ready", room });
                        scheduleRoomCleanup(room);
                    }
                }
            }),
        };
        rooms.set(room.documentId, cleaning);
    }, ROOM_CLEANUP_DELAY_MS);
}

/**
 * Cancel pending room cleanup.
 */
export function cancelRoomCleanup(room: YjsRoom): void {
    if (room.cleanupTimer) {
        clearTimeout(room.cleanupTimer);
        room.cleanupTimer = null;
    }
}

/**
 * Get room count (for health check).
 */
export function getRoomCount(): number {
    return rooms.size;
}

/**
 * Clear room state (Y.Doc content and awareness).
 * Per D-55/D-57: Live Room mode — owner's local SQLite is source of truth.
 * Called when owner disconnects to prevent stale state on reconnect.
 */
export function clearRoomState(room: YjsRoom): void {
    const { ydoc, awareness } = room;

    // Clear all awareness states (removes ghost cursors)
    const allClientIds = Array.from(awareness.getStates().keys());
    if (allClientIds.length > 0) {
        removeAwarenessStates(awareness, allClientIds, "owner-disconnect");
    }

    // Clear Y.Doc content — owner will reseed on reconnect
    ydoc.transact(() => {
        const ytext = ydoc.getText("document");
        if (ytext.length > 0) {
            ytext.delete(0, ytext.length);
        }
        const ymap = ydoc.getMap("annotations");
        ymap.clear();
        ydoc.getMap("versionGroups").clear();
    }, "owner-disconnect");

    logger.info(`Cleared state for room ${room.documentId.slice(0, 8)}...`);
}

/**
 * Clear all rooms (for testing).
 */
export function _clearAllRooms(): void {
    for (const slot of rooms.values()) {
        if (slot.kind === "opening") continue;
        const { room } = slot;
        if (room.cleanupTimer) {
            clearTimeout(room.cleanupTimer);
        }
        room.awareness.destroy();
        room.ydoc.destroy();
    }
    rooms.clear();
}
