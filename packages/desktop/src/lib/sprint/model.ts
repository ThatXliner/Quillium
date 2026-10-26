/**
 * model.ts — Pure data model and calculations for timed writing sprints.
 *
 * Sprint state is intentionally document-agnostic: a sprint measures the live
 * editor word-count delta, while completed records are persisted per device.
 */

export type ActiveSprint = {
    id: string;
    startedAt: number;
    endsAt: number;
    durationMinutes: number;
    startingWords: number;
    wordGoal: number | null;
};

export type SprintRecord = {
    id: string;
    startedAt: number;
    endedAt: number;
    durationMinutes: number;
    wordsWritten: number;
    wordGoal: number | null;
    wordsPerMinute: number;
    completed: boolean;
};

export function createSprint(
    durationMinutes: number,
    wordGoal: number | null,
    startingWords: number,
    now: number,
    id: string,
): ActiveSprint {
    const safeDuration = Math.min(480, Math.max(1, Math.round(durationMinutes)));
    const safeGoal = wordGoal === null ? null : Math.max(1, Math.round(wordGoal));
    return {
        id,
        startedAt: now,
        endsAt: now + safeDuration * 60_000,
        durationMinutes: safeDuration,
        startingWords: Math.max(0, startingWords),
        wordGoal: safeGoal,
    };
}

export function finishSprint(
    sprint: ActiveSprint,
    currentWords: number,
    endedAt: number,
    completed = true,
): SprintRecord {
    const wordsWritten = Math.max(0, currentWords - sprint.startingWords);
    const elapsedMinutes = Math.max(1 / 60, (endedAt - sprint.startedAt) / 60_000);
    return {
        id: sprint.id,
        startedAt: sprint.startedAt,
        endedAt,
        durationMinutes: sprint.durationMinutes,
        wordsWritten,
        wordGoal: sprint.wordGoal,
        wordsPerMinute: Math.round(wordsWritten / elapsedMinutes),
        completed,
    };
}

export function formatCountdown(milliseconds: number): string {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function isActiveSprint(value: unknown): value is ActiveSprint {
    if (!value || typeof value !== "object") return false;
    const sprint = value as Partial<ActiveSprint>;
    return (
        typeof sprint.id === "string" &&
        typeof sprint.startedAt === "number" &&
        typeof sprint.endsAt === "number" &&
        typeof sprint.durationMinutes === "number" &&
        typeof sprint.startingWords === "number" &&
        (sprint.wordGoal === null || typeof sprint.wordGoal === "number")
    );
}

export function isSprintRecord(value: unknown): value is SprintRecord {
    if (!value || typeof value !== "object") return false;
    const record = value as Partial<SprintRecord>;
    return (
        typeof record.id === "string" &&
        typeof record.startedAt === "number" &&
        typeof record.endedAt === "number" &&
        typeof record.durationMinutes === "number" &&
        typeof record.wordsWritten === "number" &&
        (record.wordGoal === null || typeof record.wordGoal === "number") &&
        typeof record.wordsPerMinute === "number" &&
        typeof record.completed === "boolean"
    );
}
