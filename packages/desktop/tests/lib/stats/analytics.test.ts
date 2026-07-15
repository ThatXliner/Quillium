import type { EventRecord } from "$lib/db/types";
import { computeWritingAnalytics } from "$lib/stats/analytics";
import { describe, expect, it } from "vitest";

function event(id: number, createdAt: number, insert: string, origin = "type"): EventRecord {
    return {
        id,
        eventType: "doc_change",
        createdAt,
        payload: JSON.stringify({
            type: "doc_change",
            changes: [{ from: 0, to: 0, insert }],
            selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 },
            provenance: { origin },
        }),
    };
}

describe("computeWritingAnalytics", () => {
    it("groups words by local day and sessions", () => {
        const day = new Date(2026, 6, 10, 9).getTime();
        const analytics = computeWritingAnalytics(
            [
                event(1, day, "one two"),
                event(2, day + 10 * 60_000, "three"),
                event(3, day + 60 * 60_000, "four five"),
            ],
            day,
        );

        expect(analytics.totalWordsWritten).toBe(5);
        expect(analytics.sessionCount).toBe(2);
        expect(analytics.averageWordsPerSession).toBe(3);
        expect(analytics.daily[0]).toMatchObject({ words: 5, sessions: 2 });
        expect(analytics.mostProductiveHour).toBe(9);
    });

    it("calculates current and longest calendar-day streaks", () => {
        const now = new Date(2026, 6, 14, 18).getTime();
        const records = [9, 10, 11, 13, 14].map((date, index) =>
            event(index, new Date(2026, 6, date, 8).getTime(), "word"),
        );

        const analytics = computeWritingAnalytics(records, now);
        expect(analytics.currentStreak).toBe(2);
        expect(analytics.longestStreak).toBe(3);
    });

    it("ignores AI-only and restore events while tolerating malformed history", () => {
        const at = new Date(2026, 6, 14, 8).getTime();
        const malformed: EventRecord = { id: 3, eventType: "bad", payload: "{", createdAt: at };
        const analytics = computeWritingAnalytics(
            [
                event(1, at, "human words"),
                event(2, at, "generated words", "ai-revision"),
                malformed,
            ],
            at,
        );
        expect(analytics.totalWordsWritten).toBe(2);
    });
});
