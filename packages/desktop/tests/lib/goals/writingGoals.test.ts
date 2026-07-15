import {
    activateWritingGoals,
    recordWritingGoalWords,
    setWritingGoalTarget,
    writingGoals,
} from "$lib/goals/writingGoals";
import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";

const MORNING = new Date(2026, 6, 14, 9);

describe("writing goals", () => {
    beforeEach(() => {
        localStorage.clear();
        activateWritingGoals(null, 0, MORNING);
    });

    it("tracks positive word additions without subtracting deletions", () => {
        activateWritingGoals("doc-1", 500, MORNING);
        setWritingGoalTarget("daily", 100);

        recordWritingGoalWords(540, MORNING);
        recordWritingGoalWords(520, MORNING);
        recordWritingGoalWords(550, MORNING);

        expect(get(writingGoals).daily.progress).toBe(70);
        expect(get(writingGoals).total.progress).toBe(550);
    });

    it("persists goals separately for each document", () => {
        activateWritingGoals("doc-1", 100, MORNING);
        setWritingGoalTarget("total", 1_000);
        activateWritingGoals("doc-2", 200, MORNING);
        setWritingGoalTarget("total", 2_000);

        activateWritingGoals("doc-1", 100, MORNING);
        expect(get(writingGoals).total.target).toBe(1_000);
        activateWritingGoals("doc-2", 200, MORNING);
        expect(get(writingGoals).total.target).toBe(2_000);
    });

    it("rolls daily progress over while retaining the target", () => {
        activateWritingGoals("doc-1", 100, MORNING);
        setWritingGoalTarget("daily", 50);
        recordWritingGoalWords(130, MORNING);

        const tomorrow = new Date(2026, 6, 15, 9);
        recordWritingGoalWords(140, tomorrow);

        expect(get(writingGoals).daily).toMatchObject({ target: 50, progress: 10 });
    });

    it("reports a reached goal only once", () => {
        activateWritingGoals("doc-1", 100, MORNING);
        setWritingGoalTarget("daily", 10);

        expect(recordWritingGoalWords(110, MORNING)).toEqual(["daily"]);
        expect(recordWritingGoalWords(120, MORNING)).toEqual([]);
    });
});
