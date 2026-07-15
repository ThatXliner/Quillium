/**
 * store.ts — Persistent achievement state and public recording hooks.
 *
 * Achievement data is device-wide and intentionally independent of document
 * persistence. localStorage keeps badges available before the Tauri database
 * has loaded and matches other device-level preferences in Quillium.
 */

import { appEventBus } from "$lib/events/appEventBus";
import { isNovelNovemberEnabled } from "$lib/featureFlags.svelte";
import { writable } from "svelte/store";
import {
    type AchievementState,
    type AchievementUpdate,
    emptyAchievementState,
    normalizeAchievementState,
    recordSprint,
    recordWriting,
} from "./tracker";

const STORAGE_KEY = "quillium-achievements";

function loadState(): AchievementState {
    try {
        if (typeof localStorage === "undefined") return emptyAchievementState();
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? normalizeAchievementState(JSON.parse(raw)) : emptyAchievementState();
    } catch {
        return emptyAchievementState();
    }
}

let state = loadState();
export const achievementState = writable<AchievementState>(state);

export function recordWritingActivity(wordCount: number, now = new Date()): void {
    if (!isNovelNovemberEnabled()) return;
    commit(recordWriting(state, wordCount, now));
}

/** Public completion hook for the writing-sprint workflow. */
export function recordCompletedSprint(now = new Date()): void {
    if (!isNovelNovemberEnabled()) return;
    commit(recordSprint(state, now));
}

function commit(update: AchievementUpdate): void {
    state = update.state;
    achievementState.set(state);
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}

    for (const achievement of update.newlyUnlocked) {
        appEventBus.emit({
            type: "achievement-unlocked",
            achievement: {
                id: achievement.id,
                title: achievement.title,
                description: achievement.description,
            },
        });
    }
}
