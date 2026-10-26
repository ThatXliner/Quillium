/**
 * state.ts — Reactive sprint state with local, per-device persistence.
 *
 * Active state is persisted as well as history so closing or reloading the
 * window cannot silently reset a running sprint.
 */
import { get, writable } from "svelte/store";
import {
    type ActiveSprint,
    type SprintRecord,
    createSprint,
    finishSprint,
    isActiveSprint,
    isSprintRecord,
} from "./model";

const ACTIVE_STORAGE_KEY = "quillium_writing_sprint_active";
const HISTORY_STORAGE_KEY = "quillium_writing_sprint_history";
const MAX_HISTORY_ENTRIES = 100;

function readJson(key: string): unknown {
    if (typeof localStorage === "undefined") return null;
    try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : null;
    } catch {
        return null;
    }
}

function loadActiveSprint(): ActiveSprint | null {
    const value = readJson(ACTIVE_STORAGE_KEY);
    return isActiveSprint(value) ? value : null;
}

function loadSprintHistory(): SprintRecord[] {
    const value = readJson(HISTORY_STORAGE_KEY);
    return Array.isArray(value) ? value.filter(isSprintRecord).slice(0, MAX_HISTORY_ENTRIES) : [];
}

function persist(key: string, value: unknown): void {
    if (typeof localStorage === "undefined") return;
    try {
        if (value === null) {
            localStorage.removeItem(key);
        } else {
            localStorage.setItem(key, JSON.stringify(value));
        }
    } catch {
        // Sprint persistence should never interrupt writing when storage is unavailable.
    }
}

function newId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `sprint-${Date.now()}`;
}

export const activeSprint = writable<ActiveSprint | null>(loadActiveSprint());
export const sprintHistory = writable<SprintRecord[]>(loadSprintHistory());
export const sprintOpen = writable(false);
export const sprintSummary = writable<SprintRecord | null>(null);

export function startSprint(
    durationMinutes: number,
    wordGoal: number | null,
    startingWords: number,
    now = Date.now(),
): ActiveSprint {
    const sprint = createSprint(durationMinutes, wordGoal, startingWords, now, newId());
    activeSprint.set(sprint);
    sprintSummary.set(null);
    persist(ACTIVE_STORAGE_KEY, sprint);
    return sprint;
}

export function completeActiveSprint(
    currentWords: number,
    endedAt = Date.now(),
    completed = true,
): SprintRecord | null {
    const sprint = get(activeSprint);
    if (!sprint) return null;

    const record = finishSprint(sprint, currentWords, endedAt, completed);
    let nextHistory: SprintRecord[] = [];
    sprintHistory.update((history) => {
        nextHistory = [record, ...history].slice(0, MAX_HISTORY_ENTRIES);
        return nextHistory;
    });
    activeSprint.set(null);
    sprintSummary.set(record);
    persist(ACTIVE_STORAGE_KEY, null);
    persist(HISTORY_STORAGE_KEY, nextHistory);
    return record;
}

export function cancelActiveSprint(): void {
    activeSprint.set(null);
    persist(ACTIVE_STORAGE_KEY, null);
}

export function clearSprintHistory(): void {
    sprintHistory.set([]);
    persist(HISTORY_STORAGE_KEY, []);
}
