import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Tauri invoke — settings.svelte.ts imports it at module level.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { aiProcessing, setAiProcessing, getAiAbortSignal, stopAllAi } from "$lib/ai/settings.svelte";

describe("stopAllAi", () => {
    beforeEach(() => {
        aiProcessing.active = false;
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

    it("dispatches quillium:stop-ai window event", () => {
        const handler = vi.fn();
        window.addEventListener("quillium:stop-ai", handler);

        stopAllAi();
        expect(handler).toHaveBeenCalledOnce();

        window.removeEventListener("quillium:stop-ai", handler);
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
});
