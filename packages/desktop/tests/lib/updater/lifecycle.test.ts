import { collabSession, collabState } from "$lib/collab/store";
import { flushPersistenceForRestart } from "$lib/editor/listeners";
import { flushNestedEditorsForRestart } from "$lib/editor/plugins/annotations/NestedEditorController";
import { prepareWindowForRestart, startUpdateLifecycle } from "$lib/updater/lifecycle";
import { cancelRestart, restartIsPending } from "$lib/updater/restartState";
import { localStartup } from "$lib/updater/startup";
import { listen } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async (importOriginal) => {
    const original = await importOriginal<typeof import("@tauri-apps/api/core")>();
    return { ...original, isTauri: () => true };
});
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
    getCurrentWebviewWindow: () => ({ label: "main" }),
}));
vi.mock("$lib/editor/listeners", () => ({ flushPersistenceForRestart: vi.fn() }));
vi.mock("$lib/editor/plugins/annotations/NestedEditorController", () => ({
    flushNestedEditorsForRestart: vi.fn(),
}));

afterEach(() => {
    cancelRestart("attempt");
    vi.resetAllMocks();
    collabSession.set(null);
    collabState.set("disconnected");
});

describe("per-window restart acknowledgement", () => {
    it("waits for both save listeners before confirming the main window is ready", async () => {
        const calls: string[] = [];
        mockIPC((cmd) => {
            calls.push(cmd);
            return null;
        });
        let bindPrepare: (stop: () => void) => void = () => {};
        let bindCancel: (stop: () => void) => void = () => {};
        vi.mocked(listen)
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        bindPrepare = resolve;
                    }),
            )
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        bindCancel = resolve;
                    }),
            );
        localStartup.set("ready");
        const stop = startUpdateLifecycle();
        await Promise.resolve();
        expect(calls).toEqual([]);
        bindPrepare(() => {});
        await Promise.resolve();
        expect(calls).toEqual([]);
        bindCancel(() => {});
        await vi.waitFor(() => expect(calls).toEqual(["cmd_ota_ready"]));
        stop();
        localStartup.set("pending");
    });

    it("vetoes an active or connecting live room before freezing remote editor updates", async () => {
        const calls: unknown[] = [];
        mockIPC((_cmd, args) => {
            calls.push(args);
            return null;
        });
        collabState.set("connecting");
        await prepareWindowForRestart("attempt");
        expect(calls).toEqual([
            { attemptId: "attempt", error: "Leave the live writing session before restarting." },
        ]);
        expect(restartIsPending()).toBe(false);
        expect(flushPersistenceForRestart).not.toHaveBeenCalled();
    });

    it("acknowledges only after nested state and checked persistence have drained", async () => {
        const calls: unknown[] = [];
        mockIPC((cmd, args) => {
            calls.push({ cmd, args });
            return null;
        });
        vi.mocked(flushNestedEditorsForRestart).mockImplementation(() => {
            expect(restartIsPending()).toBe(true);
        });
        let release: () => void = () => {};
        vi.mocked(flushPersistenceForRestart).mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    release = resolve;
                }),
        );
        const save = prepareWindowForRestart("attempt");
        await vi.waitFor(() => expect(flushPersistenceForRestart).toHaveBeenCalledOnce());
        expect(calls).toEqual([]);
        release();
        await save;
        expect(calls).toEqual([
            { cmd: "cmd_update_save_result", args: { attemptId: "attempt", error: null } },
        ]);
        expect(restartIsPending()).toBe(true);
    });

    it("returns a save failure without exposing the writer's text", async () => {
        const calls: unknown[] = [];
        mockIPC((_cmd, args) => {
            calls.push(args);
            return null;
        });
        vi.mocked(flushPersistenceForRestart).mockRejectedValue(
            new Error("secret manuscript text"),
        );
        await prepareWindowForRestart("attempt");
        expect(calls).toEqual([
            {
                attemptId: "attempt",
                error: "This window could not save all changes. Restart was cancelled.",
            },
        ]);
        expect(restartIsPending()).toBe(true);
    });
});
