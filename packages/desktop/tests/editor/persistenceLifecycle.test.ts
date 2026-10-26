import { startPersistenceLifecycle } from "$lib/editor/persistenceLifecycle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    flush: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(),
    native: vi.fn(),
    log: vi.fn(),
}));
vi.mock("$lib/editor/listeners", () => ({
    flushPersistence: mocks.flush,
    flushPersistenceForClose: mocks.flush,
}));
vi.mock("$lib/appLog", () => ({ logAppEvent: mocks.log }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.native }));
vi.mock("@tauri-apps/api/window", () => ({
    getCurrentWindow: () => ({ onFocusChanged: mocks.focus, onCloseRequested: mocks.close }),
}));

let cleanup: (() => void) | undefined;
beforeEach(() => {
    vi.resetAllMocks();
    mocks.native.mockReturnValue(true);
    mocks.flush.mockResolvedValue(undefined);
    mocks.focus.mockResolvedValue(vi.fn());
    mocks.close.mockResolvedValue(vi.fn());
    mocks.log.mockResolvedValue(undefined);
});
afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.restoreAllMocks();
});

describe("persistence lifecycle", () => {
    it("flushes when native focus is lost and the document becomes hidden", async () => {
        cleanup = startPersistenceLifecycle();
        mocks.focus.mock.calls[0][0]({ payload: true });
        expect(mocks.flush).not.toHaveBeenCalled();
        mocks.focus.mock.calls[0][0]({ payload: false });
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
        document.dispatchEvent(new Event("visibilitychange"));
        expect(mocks.flush).toHaveBeenCalledTimes(2);
    });

    it("holds the native close handler until persistence finishes", async () => {
        let finish!: () => void;
        mocks.flush.mockReturnValue(
            new Promise<void>((resolve) => {
                finish = resolve;
            }),
        );
        cleanup = startPersistenceLifecycle();
        const event = { preventDefault: vi.fn() };
        let complete = false;
        const closing = mocks.close.mock.calls[0][0](event).then(() => {
            complete = true;
        });
        await Promise.resolve();
        expect(complete).toBe(false);
        finish();
        await closing;
        expect(complete).toBe(true);
        expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it("prevents close when saving fails", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        mocks.flush.mockRejectedValue(new Error("database unavailable"));
        cleanup = startPersistenceLifecycle();
        const event = { preventDefault: vi.fn() };
        await mocks.close.mock.calls[0][0](event);
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(mocks.log).toHaveBeenCalledWith("error", "persistence", expect.any(String), {
            error: "database unavailable",
        });
    });

    it("prevents duplicate native destruction while closing and after the flush succeeds", async () => {
        let finish!: () => void;
        mocks.flush.mockReturnValue(
            new Promise<void>((resolve) => {
                finish = resolve;
            }),
        );
        cleanup = startPersistenceLifecycle();
        const firstEvent = { preventDefault: vi.fn() };
        const repeatedEvent = { preventDefault: vi.fn() };
        const closing = mocks.close.mock.calls[0][0](firstEvent);
        await mocks.close.mock.calls[0][0](repeatedEvent);
        expect(repeatedEvent.preventDefault).toHaveBeenCalledOnce();
        expect(mocks.flush).toHaveBeenCalledOnce();
        finish();
        await closing;
        const afterFlushEvent = { preventDefault: vi.fn() };
        await mocks.close.mock.calls[0][0](afterFlushEvent);
        expect(afterFlushEvent.preventDefault).toHaveBeenCalledOnce();
        expect(firstEvent.preventDefault).not.toHaveBeenCalled();
        expect(mocks.flush).toHaveBeenCalledOnce();
    });

    it("allows a native close retry after its first flush fails", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        mocks.flush.mockRejectedValueOnce(new Error("disk full"));
        cleanup = startPersistenceLifecycle();
        const failedEvent = { preventDefault: vi.fn() };
        await mocks.close.mock.calls[0][0](failedEvent);
        const retryEvent = { preventDefault: vi.fn() };
        await mocks.close.mock.calls[0][0](retryEvent);
        expect(mocks.flush).toHaveBeenCalledTimes(2);
        expect(failedEvent.preventDefault).toHaveBeenCalledOnce();
        expect(retryEvent.preventDefault).not.toHaveBeenCalled();
    });

    it("cleans up asynchronous registrations after disposal", async () => {
        const stopFocus = vi.fn();
        const stopClose = vi.fn();
        mocks.focus.mockResolvedValue(stopFocus);
        mocks.close.mockResolvedValue(stopClose);
        cleanup = startPersistenceLifecycle();
        cleanup();
        await Promise.resolve();
        expect(stopFocus).toHaveBeenCalledOnce();
        expect(stopClose).toHaveBeenCalledOnce();
        document.dispatchEvent(new Event("visibilitychange"));
        expect(mocks.flush).not.toHaveBeenCalled();
        cleanup = undefined;
    });
});
