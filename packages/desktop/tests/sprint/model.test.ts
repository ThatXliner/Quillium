import {
    createSprint,
    finishSprint,
    formatCountdown,
    isActiveSprint,
    isSprintRecord,
} from "$lib/sprint/model";
import { describe, expect, it } from "vitest";

describe("writing sprint model", () => {
    it("creates a bounded sprint with an optional goal", () => {
        expect(createSprint(20, 500, 120, 1_000, "sprint-1")).toEqual({
            id: "sprint-1",
            startedAt: 1_000,
            endsAt: 1_201_000,
            durationMinutes: 20,
            startingWords: 120,
            wordGoal: 500,
        });
        expect(createSprint(0, null, -2, 0, "minimum").durationMinutes).toBe(1);
        expect(createSprint(1_000, null, 0, 0, "maximum").durationMinutes).toBe(480);
    });

    it("computes non-negative words and WPM from elapsed time", () => {
        const sprint = createSprint(20, 500, 100, 0, "sprint-1");
        expect(finishSprint(sprint, 300, 10 * 60_000)).toMatchObject({
            wordsWritten: 200,
            wordsPerMinute: 20,
            completed: true,
        });
        expect(finishSprint(sprint, 50, 60_000).wordsWritten).toBe(0);
    });

    it("formats a countdown with ceiling semantics", () => {
        expect(formatCountdown(60_001)).toBe("1:01");
        expect(formatCountdown(60_000)).toBe("1:00");
        expect(formatCountdown(-1)).toBe("0:00");
    });

    it("rejects malformed persisted data", () => {
        const active = createSprint(10, null, 0, 0, "sprint-1");
        const record = finishSprint(active, 10, 60_000);
        expect(isActiveSprint(active)).toBe(true);
        expect(isSprintRecord(record)).toBe(true);
        expect(isActiveSprint({ ...active, endsAt: "soon" })).toBe(false);
        expect(isSprintRecord({ ...record, completed: "yes" })).toBe(false);
    });
});
