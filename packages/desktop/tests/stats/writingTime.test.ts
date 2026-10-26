/**
 * writingTime.test.ts — Writing-session, idle, and calendar-summary coverage.
 */

import type { ChangeOrigin, DocChangeEvent } from "$lib/db/events";
import type { EventRecord } from "$lib/db/types";
import { computeWritingTime, formatWritingDuration } from "$lib/stats/writingTime";
import { describe, expect, it } from "vitest";

function edit(id: number, createdAt: number, origin: ChangeOrigin = "type"): EventRecord {
    const payload: DocChangeEvent = {
        type: "doc_change",
        changes: [{ from: 0, to: 0, insert: "x" }],
        selection: { ranges: [{ anchor: 1, head: 1 }], main: 0 },
        provenance: { origin },
    };
    return { id, eventType: "doc_change", payload: JSON.stringify(payload), createdAt };
}

describe("computeWritingTime", () => {
    it("keeps a live session ticking until the idle threshold", () => {
        const now = new Date(2026, 6, 14, 12).getTime();
        const stats = computeWritingTime([edit(1, now - 60_000), edit(2, now - 10_000)], now);

        expect(stats.latestSession).toMatchObject({
            startedAt: now - 60_000,
            endedAt: now,
            durationMs: 60_000,
            editCount: 2,
            isActive: true,
        });
        expect(stats.today.activeWritingMs).toBe(60_000);
    });

    it("splits sessions and stops counting after two minutes idle", () => {
        const now = new Date(2026, 6, 14, 12).getTime();
        const stats = computeWritingTime(
            [edit(1, now - 600_000), edit(2, now - 590_000), edit(3, now - 60_000)],
            now,
        );

        expect(stats.today.sessionCount).toBe(2);
        expect(stats.today.activeWritingMs).toBe(190_000);
        expect(stats.latestSession?.isActive).toBe(true);
    });

    it("keeps a completed session capped at the idle threshold", () => {
        const now = new Date(2026, 6, 14, 12).getTime();
        const stats = computeWritingTime([edit(1, now - 600_000)], now);

        expect(stats.latestSession).toMatchObject({
            durationMs: 120_000,
            isActive: false,
        });
        expect(stats.today.activeWritingMs).toBe(120_000);
    });

    it("does not count AI revisions, restores, or annotation-only events", () => {
        const now = new Date(2026, 6, 14, 12).getTime();
        const annotation = {
            id: 3,
            eventType: "annotation_add",
            payload: JSON.stringify({ type: "annotation_add", annotation: {} }),
            createdAt: now - 5_000,
        };
        const stats = computeWritingTime(
            [edit(1, now - 30_000, "ai-revision"), edit(2, now - 20_000, "restore"), annotation],
            now,
        );

        expect(stats.latestSession).toBeNull();
        expect(stats.allTime.editCount).toBe(0);
    });

    it("clips sessions to local daily, weekly, and monthly boundaries", () => {
        const now = new Date(2026, 6, 14, 12).getTime(); // Tuesday
        const yesterday = new Date(2026, 6, 13, 12).getTime();
        const lastWeek = new Date(2026, 6, 12, 12).getTime();
        const lastMonth = new Date(2026, 5, 30, 12).getTime();
        const stats = computeWritingTime(
            [
                edit(1, lastMonth),
                edit(2, lastWeek),
                edit(3, yesterday),
                edit(4, yesterday + 60_000),
                edit(5, now - 60_000),
            ],
            now,
        );

        expect(stats.today.sessionCount).toBe(1);
        expect(stats.week.sessionCount).toBe(2);
        expect(stats.month.sessionCount).toBe(3);
        expect(stats.allTime.sessionCount).toBe(4);
    });
});

describe("formatWritingDuration", () => {
    it("formats short, minute, and hour durations", () => {
        expect(formatWritingDuration(30_000)).toBe("< 1m");
        expect(formatWritingDuration(5 * 60_000)).toBe("5m");
        expect(formatWritingDuration(90 * 60_000)).toBe("1h 30m");
    });
});
