import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    enabled: false,
    emit: vi.fn(),
}));

vi.mock("$lib/featureFlags.svelte", () => ({
    isNovelNovemberEnabled: () => mocks.enabled,
}));

vi.mock("$lib/events/appEventBus", () => ({
    appEventBus: { emit: mocks.emit },
}));

describe("achievement store feature gating", () => {
    beforeEach(() => {
        localStorage.clear();
        mocks.enabled = false;
        mocks.emit.mockClear();
        vi.resetModules();
    });

    it("does not record or unlock milestones while novel-november is disabled", async () => {
        const store = await import("$lib/achievements/store");
        store.recordWritingActivity(1_000, new Date(2026, 6, 1, 12));

        expect(get(store.achievementState).maxDraftWordCount).toBe(0);
        expect(localStorage.getItem("quillium-achievements")).toBeNull();
        expect(mocks.emit).not.toHaveBeenCalled();
    });

    it("records and unlocks milestones while novel-november is enabled", async () => {
        mocks.enabled = true;
        const store = await import("$lib/achievements/store");
        store.recordWritingActivity(1_000, new Date(2026, 6, 1, 12));

        expect(get(store.achievementState).maxDraftWordCount).toBe(1_000);
        expect(localStorage.getItem("quillium-achievements")).not.toBeNull();
        expect(mocks.emit).toHaveBeenCalledWith(
            expect.objectContaining({ type: "achievement-unlocked" }),
        );
    });
});
