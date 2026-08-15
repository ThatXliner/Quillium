import {
    DUPLICATE_DRAFT_WARNING_SNOOZE_MS,
    duplicateDraftWarningIsEnabled,
    duplicateDraftWarningSnoozeUntil,
} from "$lib/editor/plugins/annotations/duplicateDraftWarning";
import { describe, expect, it } from "vitest";

describe("duplicate draft warning timing", () => {
    it("hides the warning until the snooze expires", () => {
        const now = 1_000;
        const hiddenUntil = duplicateDraftWarningSnoozeUntil(now);

        expect(hiddenUntil).toBe(now + DUPLICATE_DRAFT_WARNING_SNOOZE_MS);
        expect(duplicateDraftWarningIsEnabled(true, hiddenUntil, now)).toBe(false);
        expect(duplicateDraftWarningIsEnabled(true, hiddenUntil, hiddenUntil)).toBe(true);
    });

    it("keeps a permanently disabled warning hidden", () => {
        expect(duplicateDraftWarningIsEnabled(false, 0, 10_000)).toBe(false);
    });
});
