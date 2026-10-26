import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("writing sprint state", () => {
    beforeEach(() => {
        localStorage.clear();
        vi.resetModules();
    });

    it("persists an active sprint and restores it after a module reload", async () => {
        const state = await import("$lib/sprint/state");
        const sprint = state.startSprint(10, 250, 100, 1_000);

        expect(
            JSON.parse(localStorage.getItem("quillium_writing_sprint_active") ?? "null"),
        ).toEqual(sprint);

        vi.resetModules();
        const reloadedState = await import("$lib/sprint/state");
        expect(get(reloadedState.activeSprint)).toEqual(sprint);
    });

    it("stores completion metrics in history and clears active state", async () => {
        const state = await import("$lib/sprint/state");
        state.startSprint(10, 200, 100, 0);
        const record = state.completeActiveSprint(220, 5 * 60_000);

        expect(record).toMatchObject({
            durationMinutes: 10,
            wordsWritten: 120,
            wordGoal: 200,
            wordsPerMinute: 24,
            completed: true,
        });
        expect(get(state.activeSprint)).toBeNull();
        expect(get(state.sprintHistory)).toEqual([record]);
        expect(localStorage.getItem("quillium_writing_sprint_active")).toBeNull();
        expect(JSON.parse(localStorage.getItem("quillium_writing_sprint_history") ?? "[]")).toEqual(
            [record],
        );
    });

    it("ignores malformed persisted sprint data", async () => {
        localStorage.setItem("quillium_writing_sprint_active", '{"endsAt":"soon"}');
        localStorage.setItem("quillium_writing_sprint_history", '[{"wordsWritten":"many"}]');

        const state = await import("$lib/sprint/state");
        expect(get(state.activeSprint)).toBeNull();
        expect(get(state.sprintHistory)).toEqual([]);
    });
});
