import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Tauri invoke — settings.svelte.ts imports it at module level.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import {
    aiProcessing,
    beginAiTask,
    endAiTask,
    setAiProcessing,
    getAiAbortSignal,
    stopAllAi,
} from "$lib/ai/settings.svelte";
import { appEventBus } from "$lib/events/appEventBus";

describe("stopAllAi", () => {
    beforeEach(() => {
        stopAllAi();
    });

    it("sets aiProcessing.active to false", () => {
        setAiProcessing(true);
        expect(aiProcessing.active).toBe(true);

        stopAllAi();
        expect(aiProcessing.active).toBe(false);
    });

    it("aborts the current AbortController signal", () => {
        const signal = getAiAbortSignal();
        expect(signal.aborted).toBe(false);

        stopAllAi();
        expect(signal.aborted).toBe(true);
    });

    it("creates a fresh AbortController after stop", () => {
        const signal1 = getAiAbortSignal();
        stopAllAi();
        const signal2 = getAiAbortSignal();

        expect(signal1).not.toBe(signal2);
        expect(signal1.aborted).toBe(true);
        expect(signal2.aborted).toBe(false);
    });

    it("emits a stop-ai app event", () => {
        const handler = vi.fn();
        const unsub = appEventBus.on("stop-ai", handler);

        stopAllAi();
        expect(handler).toHaveBeenCalledOnce();
        unsub();
    });

    it("is safe to call when no AbortController exists", () => {
        // No getAiAbortSignal() call — no controller created yet.
        expect(() => stopAllAi()).not.toThrow();
        expect(aiProcessing.active).toBe(false);
    });

    it("is safe to call multiple times in a row", () => {
        setAiProcessing(true);
        const signal = getAiAbortSignal();

        stopAllAi();
        stopAllAi();

        expect(signal.aborted).toBe(true);
        expect(aiProcessing.active).toBe(false);
    });

    it("stays active until all task handles end", () => {
        const task1 = beginAiTask("one");
        const task2 = beginAiTask("two");

        expect(aiProcessing.active).toBe(true);
        endAiTask(task1);
        expect(aiProcessing.active).toBe(true);
        endAiTask(task2);
        expect(aiProcessing.active).toBe(false);
    });

    it("clears active task handles on stop", () => {
        beginAiTask("one");
        beginAiTask("two");
        expect(aiProcessing.active).toBe(true);

        stopAllAi();
        expect(aiProcessing.active).toBe(false);
    });
});
