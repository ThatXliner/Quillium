/**
 * writingGoals.ts — Document-scoped writing goal persistence and progress tracking.
 *
 * Daily and weekly goals count words added (deletions do not take progress away).
 * Total goals follow the current document word count. Records live in localStorage
 * because goals are lightweight UI preferences rather than editor history.
 */

import { writable } from "svelte/store";

export type WritingGoalKind = "daily" | "weekly" | "total";

export type GoalProgress = {
    target: number;
    progress: number;
    periodKey: string;
    celebrated: boolean;
};

export type WritingGoalsState = {
    documentId: string | null;
    daily: GoalProgress;
    weekly: GoalProgress;
    total: GoalProgress;
    lastWordCount: number;
};

const STORAGE_PREFIX = "quillium-writing-goals:";

function localDayKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function localWeekKey(date: Date): string {
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayFromMonday = (monday.getDay() + 6) % 7;
    monday.setDate(monday.getDate() - dayFromMonday);
    return localDayKey(monday);
}

function emptyGoal(periodKey = ""): GoalProgress {
    return { target: 0, progress: 0, periodKey, celebrated: false };
}

function emptyState(): WritingGoalsState {
    return {
        documentId: null,
        daily: emptyGoal(),
        weekly: emptyGoal(),
        total: emptyGoal("total"),
        lastWordCount: 0,
    };
}

export const writingGoals = writable<WritingGoalsState>(emptyState());

function storageKey(documentId: string): string {
    return `${STORAGE_PREFIX}${encodeURIComponent(documentId)}`;
}

function normalizeTarget(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function normalizeProgress(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function normalizeGoal(value: unknown, periodKey: string): GoalProgress {
    const goal = value && typeof value === "object" ? (value as Partial<GoalProgress>) : {};
    return {
        target: normalizeTarget(goal.target),
        progress: normalizeProgress(goal.progress),
        periodKey: typeof goal.periodKey === "string" ? goal.periodKey : periodKey,
        celebrated: goal.celebrated === true,
    };
}

function load(documentId: string, wordCount: number, now: Date): WritingGoalsState {
    let parsed: Partial<WritingGoalsState> = {};
    try {
        const raw = localStorage.getItem(storageKey(documentId));
        if (raw) parsed = JSON.parse(raw) as Partial<WritingGoalsState>;
    } catch {}

    const state: WritingGoalsState = {
        documentId,
        daily: normalizeGoal(parsed.daily, localDayKey(now)),
        weekly: normalizeGoal(parsed.weekly, localWeekKey(now)),
        total: normalizeGoal(parsed.total, "total"),
        // The first observed count is the baseline for this editor session. This
        // prevents opening a document from counting its existing words as new work.
        lastWordCount: normalizeProgress(wordCount),
    };
    rollPeriods(state, now);
    state.total.progress = normalizeProgress(wordCount);
    return state;
}

function save(state: WritingGoalsState): void {
    if (!state.documentId) return;
    try {
        localStorage.setItem(storageKey(state.documentId), JSON.stringify(state));
    } catch {}
}

function rollPeriods(state: WritingGoalsState, now: Date): void {
    const dayKey = localDayKey(now);
    if (state.daily.periodKey !== dayKey) {
        state.daily = { ...emptyGoal(dayKey), target: state.daily.target };
    }

    const weekKey = localWeekKey(now);
    if (state.weekly.periodKey !== weekKey) {
        state.weekly = { ...emptyGoal(weekKey), target: state.weekly.target };
    }
}

export function activateWritingGoals(
    documentId: string | null,
    wordCount: number,
    now = new Date(),
): void {
    const state = documentId ? load(documentId, wordCount, now) : emptyState();
    writingGoals.set(state);
    if (documentId) save(state);
}

export function recordWritingGoalWords(wordCount: number, now = new Date()): WritingGoalKind[] {
    const reached: WritingGoalKind[] = [];
    writingGoals.update((state) => {
        if (!state.documentId) return state;

        rollPeriods(state, now);
        const currentCount = normalizeProgress(wordCount);
        const wordsAdded = Math.max(0, currentCount - state.lastWordCount);
        state.daily.progress += wordsAdded;
        state.weekly.progress += wordsAdded;
        state.total.progress = currentCount;
        state.lastWordCount = currentCount;

        for (const kind of ["daily", "weekly", "total"] as const) {
            const goal = state[kind];
            if (goal.target > 0 && goal.progress >= goal.target && !goal.celebrated) {
                goal.celebrated = true;
                reached.push(kind);
            }
        }

        save(state);
        return state;
    });
    return reached;
}

export function setWritingGoalTarget(kind: WritingGoalKind, target: number): void {
    writingGoals.update((state) => {
        if (!state.documentId) return state;
        const goal = state[kind];
        goal.target = normalizeTarget(target);
        // A changed target is a new milestone. Let the tracker celebrate it if
        // the writer has already earned it, while clearing a goal stays quiet.
        goal.celebrated = goal.target === 0;
        save(state);
        return state;
    });
}

export function goalPercent(goal: GoalProgress): number {
    if (goal.target <= 0) return 0;
    return Math.min(100, Math.round((goal.progress / goal.target) * 100));
}
