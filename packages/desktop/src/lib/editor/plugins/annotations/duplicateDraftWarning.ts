/**
 * duplicateDraftWarning.ts — Timing policy for the duplicate-draft confirmation.
 */

export const DUPLICATE_DRAFT_WARNING_SNOOZE_MS = 60 * 60 * 1000;

export function duplicateDraftWarningIsEnabled(
    warningEnabled: boolean,
    hiddenUntil: number,
    now = Date.now(),
): boolean {
    return warningEnabled && now >= hiddenUntil;
}

export function duplicateDraftWarningSnoozeUntil(now = Date.now()): number {
    return now + DUPLICATE_DRAFT_WARNING_SNOOZE_MS;
}
