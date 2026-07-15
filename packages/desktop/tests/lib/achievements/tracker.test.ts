import {
    currentWritingStreak,
    emptyAchievementState,
    normalizeAchievementState,
    recordSprint,
    recordWriting,
} from "$lib/achievements/tracker";
import { describe, expect, it } from "vitest";

function localDate(year: number, month: number, day: number): Date {
    return new Date(year, month - 1, day, 12);
}

describe("achievement tracker", () => {
    it("unlocks every crossed word milestone exactly once", () => {
        const first = recordWriting(emptyAchievementState(), 10_000, localDate(2026, 7, 1));

        expect(first.newlyUnlocked.map((achievement) => achievement.id)).toEqual([
            "words-1000",
            "words-5000",
            "words-10000",
        ]);

        const repeated = recordWriting(first.state, 12_000, localDate(2026, 7, 1));
        expect(repeated.newlyUnlocked).toEqual([]);
    });

    it("tracks consecutive local calendar days and unlocks streak badges", () => {
        let state = emptyAchievementState();
        state = recordWriting(state, 20, localDate(2026, 7, 10)).state;
        state = recordWriting(state, 30, localDate(2026, 7, 11)).state;
        const third = recordWriting(state, 40, localDate(2026, 7, 12));

        expect(currentWritingStreak(third.state, localDate(2026, 7, 12))).toBe(3);
        expect(third.newlyUnlocked.map((achievement) => achievement.id)).toContain("streak-3");
    });

    it("does not bridge a missed day", () => {
        let state = emptyAchievementState();
        state = recordWriting(state, 20, localDate(2026, 7, 10)).state;
        state = recordWriting(state, 30, localDate(2026, 7, 12)).state;

        expect(currentWritingStreak(state, localDate(2026, 7, 12))).toBe(1);
    });

    it("keeps yesterday's streak current until the writer misses today", () => {
        let state = emptyAchievementState();
        state = recordWriting(state, 20, localDate(2026, 7, 10)).state;
        state = recordWriting(state, 30, localDate(2026, 7, 11)).state;

        expect(currentWritingStreak(state, localDate(2026, 7, 12))).toBe(2);
        expect(currentWritingStreak(state, localDate(2026, 7, 13))).toBe(0);
    });

    it("unlocks sprint milestones through the completion hook", () => {
        let state = emptyAchievementState();
        const unlocked: string[] = [];
        for (let count = 0; count < 10; count += 1) {
            const update = recordSprint(state, localDate(2026, 7, 1));
            state = update.state;
            unlocked.push(...update.newlyUnlocked.map((achievement) => achievement.id));
        }

        expect(state.completedSprints).toBe(10);
        expect(unlocked).toEqual(["sprints-1", "sprints-10"]);
    });

    it("repairs malformed persisted state", () => {
        const state = normalizeAchievementState({
            maxDraftWordCount: -1,
            completedSprints: 2.8,
            writingDates: ["2026-07-01", "bad", "2026-07-01"],
            unlockedAt: { "words-1000": "yesterday", unknown: "today" },
        });

        expect(state).toMatchObject({
            maxDraftWordCount: 0,
            completedSprints: 2,
            writingDates: ["2026-07-01"],
            unlockedAt: { "words-1000": "yesterday" },
        });
    });
});
