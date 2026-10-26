import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

const { database, configuration } = vi.hoisted(() => ({
    database: { from: vi.fn() },
    configuration: { enabled: true },
}));

vi.mock("../auth/supabase.js", () => ({
    get supabase() {
        return configuration.enabled ? database : null;
    },
}));

import { loadYjsState } from "../persistence/yjsUpdates.js";
import { _clearAllRooms, getOrCreateYjsRoom, getRoomCount } from "../yjs/rooms.js";

describe("Yjs recovery boundary", () => {
    const snapshotRead = vi.fn();
    const updatesRead = vi.fn();
    const snapshotWrite = vi.fn();
    const updatesDelete = vi.fn();
    let snapshot: { state_update: string; state_vector: string };
    let updates: { id: number; update_data: string }[];

    beforeEach(() => {
        vi.resetAllMocks();
        configuration.enabled = true;
        const saved = new Y.Doc();
        saved.getText("document").insert(0, "saved");
        snapshot = {
            state_update: Buffer.from(Y.encodeStateAsUpdate(saved)).toString("base64"),
            state_vector: Buffer.from(Y.encodeStateVector(saved)).toString("base64"),
        };
        saved.getText("document").insert(5, " tail");
        updates = [
            { id: 3, update_data: Buffer.from(Y.encodeStateAsUpdate(saved)).toString("base64") },
        ];
        saved.destroy();
        snapshotRead.mockResolvedValue({ data: snapshot, error: null });
        updatesRead.mockImplementation(async (afterId: number, limit: number) => ({
            data: updates.filter((update) => update.id > afterId).slice(0, limit),
            error: null,
        }));
        snapshotWrite.mockResolvedValue({ error: null });
        updatesDelete.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
        database.from.mockImplementation((table: string) => {
            if (table === "yjs_documents") {
                return {
                    select: () => ({ eq: () => ({ maybeSingle: snapshotRead }) }),
                    upsert: snapshotWrite,
                };
            }
            if (table === "yjs_updates") {
                return {
                    select: () => ({
                        eq: () => ({
                            gt: (_column: string, afterId: number) => ({
                                order: () => ({
                                    limit: (limit: number) => updatesRead(afterId, limit),
                                }),
                            }),
                        }),
                    }),
                    delete: updatesDelete,
                };
            }
            throw new Error(`Unexpected table ${table}`);
        });
    });

    afterEach(() => {
        _clearAllRooms();
        vi.restoreAllMocks();
    });

    it.each([
        "snapshot error",
        "updates error",
        "snapshot rejection",
        "updates rejection",
        "late updates error",
        "late updates rejection",
        "late missing updates data",
        "late corrupt update",
        "missing updates data",
        "corrupt snapshot",
        "empty snapshot",
        "corrupt update",
        "missing configuration",
    ])("rejects %s without publishing or rewriting partial state", async (failure) => {
        if (failure === "snapshot error") {
            snapshotRead.mockResolvedValueOnce({ data: null, error: { message: "read failed" } });
        } else if (failure === "updates error") {
            updatesRead.mockResolvedValueOnce({ data: null, error: { message: "read failed" } });
        } else if (failure === "snapshot rejection") {
            snapshotRead.mockRejectedValueOnce(new Error("fetch failed"));
        } else if (failure === "updates rejection") {
            updatesRead.mockRejectedValueOnce(new Error("fetch failed"));
        } else if (failure.startsWith("late ")) {
            updatesRead.mockResolvedValueOnce({ data: updates, error: null });
            if (failure === "late updates error") {
                updatesRead.mockResolvedValueOnce({
                    data: null,
                    error: { message: "read failed" },
                });
            } else if (failure === "late updates rejection") {
                updatesRead.mockRejectedValueOnce(new Error("fetch failed"));
            } else if (failure === "late missing updates data") {
                updatesRead.mockResolvedValueOnce({ data: null, error: null });
            } else {
                updatesRead.mockResolvedValueOnce({
                    data: [{ id: 7, update_data: "AQ==" }],
                    error: null,
                });
            }
        } else if (failure === "missing updates data") {
            updatesRead.mockResolvedValueOnce({ data: null, error: null });
        } else if (failure === "corrupt snapshot" || failure === "empty snapshot") {
            snapshotRead.mockResolvedValueOnce({
                data: { ...snapshot, state_update: failure === "empty snapshot" ? "" : "AQ==" },
                error: null,
            });
        } else if (failure === "corrupt update") {
            updatesRead.mockResolvedValueOnce({
                data: [...updates, { id: 7, update_data: "AQ==" }],
                error: null,
            });
        } else {
            configuration.enabled = false;
        }
        const destroy = vi.spyOn(Y.Doc.prototype, "destroy");

        await expect(getOrCreateYjsRoom("doc-recovery")).rejects.toThrow();

        expect(getRoomCount()).toBe(0);
        expect(snapshotWrite).not.toHaveBeenCalled();
        expect(updatesDelete).not.toHaveBeenCalled();
        if (failure !== "missing configuration") expect(destroy).toHaveBeenCalledOnce();
        configuration.enabled = true;
        const room = await getOrCreateYjsRoom("doc-recovery");
        expect(room.ydoc.getText("document").toString()).toBe("saved tail");
        expect(snapshotWrite).toHaveBeenCalledOnce();
        expect(updatesDelete).toHaveBeenCalledOnce();
    });

    it("returns an empty document only when both reads succeed with no saved data", async () => {
        snapshotRead.mockResolvedValueOnce({ data: null, error: null });
        updatesRead.mockResolvedValueOnce({ data: [], error: null });

        const result = await loadYjsState("doc-new");

        expect(result.ydoc.getText("document").toString()).toBe("");
        expect(result.stateVector).toBeNull();
        expect(result.ydoc.isDestroyed).toBe(false);
        result.ydoc.destroy();
    });

    it("recovers updates when no snapshot has been written", async () => {
        snapshotRead.mockResolvedValueOnce({ data: null, error: null });

        const result = await loadYjsState("doc-updates-only");

        expect(result.ydoc.getText("document").toString()).toBe("saved tail");
        expect(result.stateVector).toBeNull();
        result.ydoc.destroy();
    });

    it("recovers every bounded page even when the server caps pages below the requested limit", async () => {
        snapshotRead.mockResolvedValueOnce({ data: null, error: null });
        const saved = new Y.Doc();
        updates = [];
        saved.on("update", (update: Uint8Array) => {
            updates.push({
                id: (updates.length + 1) * 3,
                update_data: Buffer.from(update).toString("base64"),
            });
        });
        for (const character of "all edits") {
            saved.getText("document").insert(saved.getText("document").length, character);
        }
        saved.destroy();
        updatesRead.mockImplementation(async (afterId: number, limit: number) => ({
            data: updates.filter((update) => update.id > afterId).slice(0, Math.min(limit, 2)),
            error: null,
        }));

        const result = await loadYjsState("doc-paged");

        expect(result.ydoc.getText("document").toString()).toBe("all edits");
        expect(updatesRead.mock.calls.every(([, limit]) => limit > 0 && limit <= 1_000)).toBe(true);
        result.ydoc.destroy();
    });
});
