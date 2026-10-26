/**
 * tracker.ts — Pure milestone evaluation for writing achievements.
 *
 * Dates are stored as local calendar keys rather than timestamps so streaks
 * follow the writer's day even around daylight-saving changes.
 */

import { ACHIEVEMENTS, type AchievementDefinition } from "./definitions";

export type AchievementState = {
    version: 1;
    maxDraftWordCount: number;
    writingDates: string[];
    completedSprints: number;
    unlockedAt: Record<string, string>;
};

export type AchievementUpdate = {
    state: AchievementState;
    newlyUnlocked: AchievementDefinition[];
};

export function emptyAchievementState(): AchievementState {
    return {
        version: 1,
        maxDraftWordCount: 0,
        writingDates: [],
        completedSprints: 0,
        unlockedAt: {},
    };
}

export function normalizeAchievementState(value: unknown): AchievementState {
    if (!value || typeof value !== "object") return emptyAchievementState();
    const candidate = value as Partial<AchievementState>;
    const writingDates = Array.isArray(candidate.writingDates)
        ? [
              ...new Set(
                  candidate.writingDates.filter((date): date is string => typeof date === "string"),
              ),
          ]
              .filter(isDateKey)
              .sort()
        : [];
    const unlockedAt =
        candidate.unlockedAt && typeof candidate.unlockedAt === "object"
            ? Object.fromEntries(
                  Object.entries(candidate.unlockedAt).filter(
                      ([id, date]) =>
                          ACHIEVEMENTS.some((achievement) => achievement.id === id) &&
                          typeof date === "string",
                  ),
              )
            : {};

    return {
        version: 1,
        maxDraftWordCount: toNonNegativeInteger(candidate.maxDraftWordCount),
        writingDates,
        completedSprints: toNonNegativeInteger(candidate.completedSprints),
        unlockedAt,
    };
}

export function localDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function currentWritingStreak(state: AchievementState, now = new Date()): number {
    const dates = new Set(state.writingDates);
    const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // A streak remains current through the following day: the writer has until
    // midnight to continue it. Once today's writing exists, count from today.
    if (!dates.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    while (dates.has(localDateKey(cursor))) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
}

export function recordWriting(
    previous: AchievementState,
    wordCount: number,
    now = new Date(),
): AchievementUpdate {
    const state = cloneState(previous);
    state.maxDraftWordCount = Math.max(state.maxDraftWordCount, toNonNegativeInteger(wordCount));
    const today = localDateKey(now);
    if (!state.writingDates.includes(today)) {
        state.writingDates = [...state.writingDates, today].sort();
    }
    return unlockEligible(state, now);
}

export function recordSprint(previous: AchievementState, now = new Date()): AchievementUpdate {
    const state = cloneState(previous);
    state.completedSprints += 1;
    return unlockEligible(state, now);
}

function unlockEligible(state: AchievementState, now: Date): AchievementUpdate {
    const streak = currentWritingStreak(state, now);
    const newlyUnlocked = ACHIEVEMENTS.filter((achievement) => {
        if (state.unlockedAt[achievement.id]) return false;
        if (achievement.category === "words") {
            return state.maxDraftWordCount >= achievement.threshold;
        }
        if (achievement.category === "streak") return streak >= achievement.threshold;
        return state.completedSprints >= achievement.threshold;
    });
    const timestamp = now.toISOString();
    for (const achievement of newlyUnlocked) state.unlockedAt[achievement.id] = timestamp;
    return { state, newlyUnlocked };
}

function cloneState(state: AchievementState): AchievementState {
    return {
        ...state,
        writingDates: [...state.writingDates],
        unlockedAt: { ...state.unlockedAt },
    };
}

function toNonNegativeInteger(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function isDateKey(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
