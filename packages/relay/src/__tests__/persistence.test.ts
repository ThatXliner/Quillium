/**
 * persistence.test.ts -- Tests for Yjs persistence and retry helpers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

vi.mock("../auth/supabase.js", () => ({
    supabaseConfigured: true,
    supabase: {
        from: vi.fn(),
    },
}));

import { supabase } from "../auth/supabase.js";
import {
    flushAllDocumentUpdates,
    flushDocumentUpdates,
    queueYjsUpdate,
} from "../persistence/debouncedUpdates.js";
import { BASE_DELAY_MS, MAX_DELAY_MS, MAX_RETRIES, withRetry } from "../persistence/retry.js";
import {
    clearYjsUpdates,
    loadYjsState,
    persistYjsState,
    persistYjsUpdate,
    persistYjsUpdates,
} from "../persistence/yjsUpdates.js";

type MockFunction = ReturnType<typeof vi.fn>;

interface MockSupabase {
    from: MockFunction;
}

function mockedSupabase(): MockSupabase {
    if (!supabase) throw new Error("Expected mocked Supabase client");
    return supabase as unknown as MockSupabase;
}

function requireUpdate(update: Uint8Array | null): Uint8Array {
    expect(update).not.toBeNull();
    if (!update) throw new Error("Expected Yjs update");
    return update;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve = (_value: T): void => {};
    const promise = new Promise<T>((complete) => {
        resolve = complete;
    });
    return { promise, resolve };
}

describe("Retry wrapper", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns success on first try", async () => {
        const operation = vi.fn().mockResolvedValue({ data: "result", error: null });

        const result = await withRetry(operation, "test-op");

        expect(result.success).toBe(true);
        expect(result.data).toBe("result");
        expect(operation).toHaveBeenCalledTimes(1);
    });

    it("retries transient errors", async () => {
        const operation = vi
            .fn()
            .mockResolvedValueOnce({ data: null, error: { message: "connection timeout" } })
            .mockResolvedValueOnce({ data: null, error: { message: "connection timeout" } })
            .mockResolvedValueOnce({ data: "result", error: null });

        const result = await withRetry(operation, "test-op");

        expect(result.success).toBe(true);
        expect(operation).toHaveBeenCalledTimes(3);
    });

    it("does not retry non-transient errors", async () => {
        const operation = vi.fn().mockResolvedValue({
            data: null,
            error: { message: "unique constraint violation" },
        });

        const result = await withRetry(operation, "test-op");

        expect(result.success).toBe(false);
        expect(operation).toHaveBeenCalledTimes(1);
    });

    it("exports expected backoff constants", () => {
        expect(MAX_RETRIES).toBe(3);
        expect(BASE_DELAY_MS).toBe(100);
        expect(MAX_DELAY_MS).toBe(2000);
    });
});

describe("Yjs persistence", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    afterEach(async () => {
        await flushAllDocumentUpdates();
        vi.useRealTimers();
    });

    it("persists full Yjs state snapshots", async () => {
        const upsert = vi.fn().mockResolvedValue({ error: null });
        mockedSupabase().from.mockReturnValue({ upsert });

        const ydoc = new Y.Doc();
        ydoc.getText("document").insert(0, "hello");

        const result = await persistYjsState("doc-123", ydoc);

        expect(result.success).toBe(true);
        expect(mockedSupabase().from).toHaveBeenCalledWith("yjs_documents");
        expect(upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                document_id: "doc-123",
                state_update: expect.any(String),
                state_vector: expect.any(String),
                updated_at: expect.any(String),
            }),
            { onConflict: "document_id" },
        );
    });

    it("persists a single incremental Yjs update", async () => {
        const insert = vi.fn().mockResolvedValue({ error: null });
        mockedSupabase().from.mockReturnValue({ insert });

        const result = await persistYjsUpdate("doc-123", new Uint8Array([1, 2, 3]));

        expect(result.success).toBe(true);
        expect(mockedSupabase().from).toHaveBeenCalledWith("yjs_updates");
        expect(insert).toHaveBeenCalledWith({
            document_id: "doc-123",
            update_data: Buffer.from([1, 2, 3]).toString("base64"),
            created_at: expect.any(String),
        });
    });

    it("persists batched incremental updates", async () => {
        const insert = vi.fn().mockResolvedValue({ error: null });
        mockedSupabase().from.mockReturnValue({ insert });

        const result = await persistYjsUpdates("doc-123", [
            new Uint8Array([1]),
            new Uint8Array([2]),
        ]);

        expect(result.success).toBe(true);
        expect(insert).toHaveBeenCalledWith([
            expect.objectContaining({ document_id: "doc-123", update_data: "AQ==" }),
            expect.objectContaining({ document_id: "doc-123", update_data: "Ag==" }),
        ]);
    });

    it("loads snapshot plus incremental updates into a Y.Doc", async () => {
        const snapshotDoc = new Y.Doc();
        snapshotDoc.getText("document").insert(0, "hello");
        const snapshotUpdate = Y.encodeStateAsUpdate(snapshotDoc);
        const snapshotVector = Y.encodeStateVector(snapshotDoc);

        const incrementalDoc = new Y.Doc();
        Y.applyUpdate(incrementalDoc, snapshotUpdate);
        let incrementalUpdate: Uint8Array | null = null;
        incrementalDoc.on("update", (update) => {
            incrementalUpdate = update;
        });
        incrementalDoc.getText("document").insert(5, " world");

        const snapshotQuery = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
                data: {
                    state_update: Buffer.from(snapshotUpdate).toString("base64"),
                    state_vector: Buffer.from(snapshotVector).toString("base64"),
                },
                error: null,
            }),
        };
        const updatesQuery = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gt: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi
                .fn()
                .mockResolvedValueOnce({
                    data: [
                        {
                            id: 1,
                            update_data: Buffer.from(requireUpdate(incrementalUpdate)).toString(
                                "base64",
                            ),
                        },
                    ],
                    error: null,
                })
                .mockResolvedValue({ data: [], error: null }),
        };

        mockedSupabase().from.mockImplementation((table: string) => {
            if (table === "yjs_documents") return snapshotQuery;
            if (table === "yjs_updates") return updatesQuery;
            throw new Error(`Unexpected table: ${table}`);
        });

        const result = await loadYjsState("doc-123");

        expect(result.ydoc.getText("document").toString()).toBe("hello world");
        expect(result.stateVector).toEqual(snapshotVector);
    });

    it("clears incremental update log after snapshot", async () => {
        const eq = vi.fn().mockResolvedValue({ error: null });
        const deleteFn = vi.fn().mockReturnValue({ eq });
        mockedSupabase().from.mockReturnValue({ delete: deleteFn });

        await clearYjsUpdates("doc-123");

        expect(mockedSupabase().from).toHaveBeenCalledWith("yjs_updates");
        expect(deleteFn).toHaveBeenCalled();
        expect(eq).toHaveBeenCalledWith("document_id", "doc-123");
    });

    it("debounces high-frequency update persistence and flushes manually", async () => {
        vi.useFakeTimers();
        const insert = vi.fn().mockResolvedValue({ error: null });
        mockedSupabase().from.mockReturnValue({ insert });

        queueYjsUpdate("doc-batch", new Uint8Array([1]));
        queueYjsUpdate("doc-batch", new Uint8Array([2]));

        expect(insert).not.toHaveBeenCalled();

        await flushDocumentUpdates("doc-batch");

        expect(insert).toHaveBeenCalledTimes(1);
        expect(insert).toHaveBeenCalledWith([
            expect.objectContaining({ update_data: "AQ==" }),
            expect.objectContaining({ update_data: "Ag==" }),
        ]);
    });

    it("rejects when Supabase refuses to clear the update log", async () => {
        const eq = vi.fn().mockResolvedValue({ error: { message: "delete refused" } });
        mockedSupabase().from.mockReturnValue({ delete: () => ({ eq }) });

        await expect(clearYjsUpdates("doc-123")).rejects.toThrow("delete refused");
    });

    it.each(["result", "rejection"])("retains failed updates after a %s failure", async (mode) => {
        const insert = vi.fn().mockResolvedValue({ error: null });
        if (mode === "result") {
            insert.mockResolvedValueOnce({ error: { message: "write failed" } });
        } else {
            insert.mockRejectedValueOnce(new Error("write failed"));
        }
        mockedSupabase().from.mockReturnValue({ insert });
        queueYjsUpdate("doc-retry", new Uint8Array([1]));

        const failure = await flushDocumentUpdates("doc-retry").catch((error: unknown) => error);
        await flushDocumentUpdates("doc-retry");

        expect(failure).toBeInstanceOf(Error);
        expect(insert).toHaveBeenCalledTimes(2);
        expect(insert).toHaveBeenLastCalledWith([expect.objectContaining({ update_data: "AQ==" })]);
    });

    it("retries a failed batch before updates received during its write", async () => {
        const write = deferred<{ error: { message: string } }>();
        const insert = vi
            .fn()
            .mockResolvedValue({ error: null })
            .mockReturnValueOnce(write.promise);
        mockedSupabase().from.mockReturnValue({ insert });
        queueYjsUpdate("doc-ordered", new Uint8Array([1]));
        const firstFlush = flushDocumentUpdates("doc-ordered").catch((error: unknown) => error);
        queueYjsUpdate("doc-ordered", new Uint8Array([2]));
        write.resolve({ error: { message: "write failed" } });
        await firstFlush;
        await flushDocumentUpdates("doc-ordered");

        expect(insert).toHaveBeenLastCalledWith([
            expect.objectContaining({ update_data: "AQ==" }),
            expect.objectContaining({ update_data: "Ag==" }),
        ]);
    });

    it("includes a debounce-started write and concurrent arrivals in the global drain", async () => {
        vi.useFakeTimers();
        const write = deferred<{ error: null }>();
        const insert = vi
            .fn()
            .mockResolvedValue({ error: null })
            .mockReturnValueOnce(write.promise);
        mockedSupabase().from.mockReturnValue({ insert });
        queueYjsUpdate("doc-inflight", new Uint8Array([1]));
        await vi.advanceTimersByTimeAsync(500);
        let drained = false;
        const drain = flushAllDocumentUpdates().then(() => {
            drained = true;
        });
        await Promise.resolve();
        await Promise.resolve();
        const completedBeforeWrite = drained;
        queueYjsUpdate("doc-inflight", new Uint8Array([2]));
        write.resolve({ error: null });
        await drain;

        expect(completedBeforeWrite).toBe(false);
        expect(insert).toHaveBeenCalledTimes(2);
        expect(insert).toHaveBeenLastCalledWith([expect.objectContaining({ update_data: "Ag==" })]);
    });

    it("serializes concurrent flushes without duplicating the write", async () => {
        const write = deferred<{ error: null }>();
        const insert = vi.fn().mockReturnValue(write.promise);
        mockedSupabase().from.mockReturnValue({ insert });
        queueYjsUpdate("doc-one-write", new Uint8Array([1]));
        const first = flushDocumentUpdates("doc-one-write");
        let secondFinished = false;
        const second = flushDocumentUpdates("doc-one-write").then(() => {
            secondFinished = true;
        });
        await Promise.resolve();
        const completedBeforeWrite = secondFinished;
        write.resolve({ error: null });
        await Promise.all([first, second]);

        expect(completedBeforeWrite).toBe(false);
        expect(insert).toHaveBeenCalledTimes(1);
    });

    it("includes documents queued while a global drain is in progress", async () => {
        const write = deferred<{ error: null }>();
        const insert = vi
            .fn()
            .mockResolvedValue({ error: null })
            .mockReturnValueOnce(write.promise);
        mockedSupabase().from.mockReturnValue({ insert });
        queueYjsUpdate("doc-first", new Uint8Array([1]));
        const drain = flushAllDocumentUpdates();
        queueYjsUpdate("doc-second", new Uint8Array([2]));
        write.resolve({ error: null });
        await drain;

        expect(insert).toHaveBeenCalledTimes(2);
        expect(insert).toHaveBeenLastCalledWith([
            expect.objectContaining({ document_id: "doc-second", update_data: "Ag==" }),
        ]);
    });

    it("waits for every document write before reporting a global drain failure", async () => {
        const write = deferred<{ error: null }>();
        const insert = vi
            .fn()
            .mockResolvedValue({ error: null })
            .mockResolvedValueOnce({ error: { message: "write failed" } })
            .mockReturnValueOnce(write.promise);
        mockedSupabase().from.mockReturnValue({ insert });
        queueYjsUpdate("doc-fails", new Uint8Array([1]));
        queueYjsUpdate("doc-pending", new Uint8Array([2]));
        let finished = false;
        const drain = flushAllDocumentUpdates().catch((error: unknown) => {
            finished = true;
            return error;
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        const completedBeforeWrite = finished;
        write.resolve({ error: null });
        const error = await drain;
        await flushAllDocumentUpdates();

        expect(completedBeforeWrite).toBe(false);
        expect(error).toBeInstanceOf(AggregateError);
        expect(insert).toHaveBeenCalledTimes(3);
    });
});
