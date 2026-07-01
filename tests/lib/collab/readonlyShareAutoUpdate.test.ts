import {
    READONLY_SHARE_AUTO_UPDATE_DEFAULT_DEBOUNCE_MS,
    READONLY_SHARE_AUTO_UPDATE_MAX_DEBOUNCE_MS,
    READONLY_SHARE_AUTO_UPDATE_MIN_DEBOUNCE_MS,
    normalizeReadonlyShareAutoUpdateDebounceMs,
    shouldScheduleReadonlyShareAutoUpdate,
} from "$lib/collab/readonlyShareAutoUpdate";
import { describe, expect, it } from "vitest";

describe("normalizeReadonlyShareAutoUpdateDebounceMs", () => {
    it("keeps valid debounce values", () => {
        expect(normalizeReadonlyShareAutoUpdateDebounceMs(7500)).toBe(7500);
    });

    it("falls back to the default for invalid values", () => {
        expect(normalizeReadonlyShareAutoUpdateDebounceMs(Number.NaN)).toBe(
            READONLY_SHARE_AUTO_UPDATE_DEFAULT_DEBOUNCE_MS,
        );
    });

    it("clamps stored values to the supported range", () => {
        expect(normalizeReadonlyShareAutoUpdateDebounceMs(100)).toBe(
            READONLY_SHARE_AUTO_UPDATE_MIN_DEBOUNCE_MS,
        );
        expect(normalizeReadonlyShareAutoUpdateDebounceMs(60000)).toBe(
            READONLY_SHARE_AUTO_UPDATE_MAX_DEBOUNCE_MS,
        );
    });
});

describe("shouldScheduleReadonlyShareAutoUpdate", () => {
    const ready = {
        enabled: true,
        authenticated: true,
        shareId: "doc-1",
        shareEnabled: true,
        shareNeedsUpdate: true,
        shareBusy: false,
        shareLoading: false,
        currentFingerprint: "draft-v2",
        lastFailedFingerprint: "",
    };

    it("schedules when auto-update is enabled and the published share is stale", () => {
        expect(shouldScheduleReadonlyShareAutoUpdate(ready)).toBe(true);
    });

    it("does not schedule while the share is unavailable or already busy", () => {
        expect(shouldScheduleReadonlyShareAutoUpdate({ ...ready, shareEnabled: false })).toBe(
            false,
        );
        expect(shouldScheduleReadonlyShareAutoUpdate({ ...ready, shareBusy: true })).toBe(false);
        expect(shouldScheduleReadonlyShareAutoUpdate({ ...ready, shareLoading: true })).toBe(false);
    });

    it("does not schedule when the user opted out or there are no unpublished changes", () => {
        expect(shouldScheduleReadonlyShareAutoUpdate({ ...ready, enabled: false })).toBe(false);
        expect(shouldScheduleReadonlyShareAutoUpdate({ ...ready, shareNeedsUpdate: false })).toBe(
            false,
        );
    });

    it("does not reschedule the same fingerprint after an automatic publish failure", () => {
        expect(
            shouldScheduleReadonlyShareAutoUpdate({
                ...ready,
                lastFailedFingerprint: ready.currentFingerprint,
            }),
        ).toBe(false);
    });
});
