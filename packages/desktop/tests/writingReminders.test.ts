import {
    calculateWritingStreak,
    dateKey,
    dueReminderSlot,
    isWritingReminderAvailable,
    reminderBody,
} from "$lib/writingReminders";
import { describe, expect, it } from "vitest";

describe("writing reminders", () => {
    it("stays unavailable unless both the shared flag and preference are enabled", () => {
        expect(isWritingReminderAvailable(false, false)).toBe(false);
        expect(isWritingReminderAvailable(false, true)).toBe(false);
        expect(isWritingReminderAvailable(true, false)).toBe(false);
        expect(isWritingReminderAvailable(true, true)).toBe(true);
    });

    it("returns a selected reminder within the due-time grace window", () => {
        const now = new Date(2026, 10, 3, 9, 7, 0);
        const slot = dueReminderSlot(
            { enabled: true, times: ["09:00", "18:00"], days: [now.getDay()] },
            now,
        );

        expect(slot).toBe(`${dateKey(now)}/09:00`);
        expect(
            dueReminderSlot({ enabled: true, times: ["09:00"], days: [now.getDay()] }, now, slot),
        ).toBeUndefined();
    });

    it("does not fire on an unselected day or long after the preferred time", () => {
        const now = new Date(2026, 10, 3, 12, 0, 0);
        expect(
            dueReminderSlot({ enabled: true, times: ["09:00"], days: [now.getDay()] }, now),
        ).toBeUndefined();
        expect(
            dueReminderSlot(
                { enabled: true, times: ["12:00"], days: [(now.getDay() + 1) % 7] },
                now,
            ),
        ).toBeUndefined();
    });

    it("counts a streak ending today or yesterday", () => {
        const now = new Date(2026, 10, 5, 8, 0, 0);
        expect(calculateWritingStreak(["2026-11-02", "2026-11-03", "2026-11-04"], now)).toBe(3);
        expect(
            calculateWritingStreak(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"], now),
        ).toBe(4);
        expect(reminderBody(4)).toContain("4-day streak");
    });
});
