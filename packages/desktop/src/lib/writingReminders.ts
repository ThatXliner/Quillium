/**
 * writingReminders.ts — Daily writing activity and native reminder scheduler.
 *
 * Reminder preferences and activity dates stay local. Native notifications are
 * emitted only while Quillium is running; the operating system owns presentation
 * and therefore respects Focus / Do Not Disturb settings.
 */

import { appSettings } from "$lib/settings.svelte";
import { isTauri } from "@tauri-apps/api/core";
import {
    isPermissionGranted,
    requestPermission,
    sendNotification,
} from "@tauri-apps/plugin-notification";
import { toast } from "svelte-sonner";

const ACTIVITY_STORAGE_KEY = "quillium-writing-activity-days";
const REMINDER_STATE_STORAGE_KEY = "quillium-writing-reminder-state";
const CHECK_INTERVAL_MS = 30_000;
const DUE_GRACE_MS = 15 * 60_000;
const SNOOZE_MS = 60 * 60_000;

export type WritingReminderPreferences = {
    enabled: boolean;
    times: string[];
    days: number[];
};

export function isWritingReminderAvailable(
    featureFlagEnabled: boolean,
    preferenceEnabled: boolean,
): boolean {
    return featureFlagEnabled && preferenceEnabled;
}

type ReminderState = {
    lastFiredSlot?: string;
    snoozedUntil?: number;
    snoozePending?: boolean;
};

let novelNovemberEnabled = false;
let timer: ReturnType<typeof setInterval> | undefined;

export function dateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function calculateWritingStreak(activityDays: string[], now: Date): number {
    const days = new Set(activityDays);
    const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (!days.has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);

    let streak = 0;
    while (days.has(dateKey(cursor))) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
}

export function reminderBody(streak: number): string {
    if (streak > 0) {
        return `Don't break your ${streak}-day streak — make time for your words today.`;
    }
    return "A few focused minutes are enough to keep your story moving.";
}

export function dueReminderSlot(
    preferences: WritingReminderPreferences,
    now: Date,
    lastFiredSlot?: string,
): string | undefined {
    if (!preferences.enabled || !preferences.days.includes(now.getDay())) return undefined;

    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const today = dateKey(now);
    for (const time of [...preferences.times].sort()) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) continue;
        const [hour, minute] = time.split(":").map(Number);
        const elapsedMs = (nowMinutes - (hour * 60 + minute)) * 60_000 + now.getSeconds() * 1000;
        const slot = `${today}/${time}`;
        if (elapsedMs >= 0 && elapsedMs <= DUE_GRACE_MS && slot !== lastFiredSlot) return slot;
    }
    return undefined;
}

function loadActivityDays(): string[] {
    try {
        const value = JSON.parse(localStorage.getItem(ACTIVITY_STORAGE_KEY) ?? "[]");
        return Array.isArray(value) ? value.filter((day) => typeof day === "string") : [];
    } catch {
        return [];
    }
}

function saveActivityDays(days: string[]): void {
    try {
        localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(days.slice(-400)));
    } catch {}
}

export function recordWritingActivity(at = new Date()): void {
    if (!novelNovemberEnabled || typeof localStorage === "undefined") return;
    const today = dateKey(at);
    const days = loadActivityDays();
    if (days.includes(today)) return;
    saveActivityDays([...days, today].sort());
}

function loadReminderState(): ReminderState {
    try {
        return JSON.parse(
            localStorage.getItem(REMINDER_STATE_STORAGE_KEY) ?? "{}",
        ) as ReminderState;
    } catch {
        return {};
    }
}

function saveReminderState(state: ReminderState): void {
    try {
        localStorage.setItem(REMINDER_STATE_STORAGE_KEY, JSON.stringify(state));
    } catch {}
}

function preferences(): WritingReminderPreferences {
    return {
        enabled: appSettings.writingRemindersEnabled,
        times: appSettings.writingReminderTimes,
        days: appSettings.writingReminderDays,
    };
}

async function showReminder(now: Date, state: ReminderState): Promise<void> {
    const streak = calculateWritingStreak(loadActivityDays(), now);
    const body = reminderBody(streak);
    try {
        if (isTauri() && (await isPermissionGranted())) {
            sendNotification({ title: "Time to write", body });
        }
    } catch (error) {
        // The in-app reminder still provides a usable fallback if the native
        // notification service is unavailable or was revoked by the OS.
        console.error("[writingReminders] native notification failed", error);
    }
    toast("Time to write", {
        description: body,
        duration: 20_000,
        closeButton: true,
        action: {
            label: "Snooze 1 hour",
            onClick: () => {
                saveReminderState({
                    ...state,
                    snoozedUntil: Date.now() + SNOOZE_MS,
                    snoozePending: true,
                });
            },
        },
        cancel: { label: "Dismiss", onClick: () => {} },
    });
}

export async function checkWritingReminders(now = new Date()): Promise<void> {
    if (!isWritingReminderAvailable(novelNovemberEnabled, appSettings.writingRemindersEnabled)) {
        return;
    }
    const state = loadReminderState();
    const nowMs = now.getTime();
    if (state.snoozedUntil && state.snoozedUntil > nowMs) return;

    if (state.snoozePending) {
        const next = { ...state, snoozePending: false, snoozedUntil: undefined };
        saveReminderState(next);
        await showReminder(now, next);
        return;
    }

    const slot = dueReminderSlot(preferences(), now, state.lastFiredSlot);
    if (!slot) return;
    const next = { ...state, lastFiredSlot: slot };
    saveReminderState(next);
    await showReminder(now, next);
}

export async function requestWritingReminderPermission(): Promise<boolean> {
    if (!isTauri()) return true;
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
}

export function setWritingReminderFeatureEnabled(enabled: boolean): void {
    novelNovemberEnabled = enabled;
    if (enabled) void checkWritingReminders();
}

export function startWritingReminderService(): () => void {
    if (timer) clearInterval(timer);
    timer = setInterval(() => void checkWritingReminders(), CHECK_INTERVAL_MS);
    void checkWritingReminders();
    return () => {
        if (timer) clearInterval(timer);
        timer = undefined;
    };
}
