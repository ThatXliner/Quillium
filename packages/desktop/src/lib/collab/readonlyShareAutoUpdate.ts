/**
 * readonlyShareAutoUpdate.ts -- Bounds and helpers for OmniWeb preview auto-publishing.
 *
 * Shared by persisted app settings and the share UI so legacy or hand-edited
 * settings cannot produce overly eager Supabase writes.
 */

export const READONLY_SHARE_AUTO_UPDATE_DEFAULT_DEBOUNCE_MS = 5000;
export const READONLY_SHARE_AUTO_UPDATE_MIN_DEBOUNCE_MS = 2000;
export const READONLY_SHARE_AUTO_UPDATE_MAX_DEBOUNCE_MS = 30000;

export type ReadonlyShareAutoUpdateScheduleInput = {
    enabled: boolean;
    authenticated: boolean;
    shareId: string;
    shareEnabled: boolean;
    shareNeedsUpdate: boolean;
    shareBusy: boolean;
    shareLoading: boolean;
    currentFingerprint: string;
    lastFailedFingerprint: string;
};

export function normalizeReadonlyShareAutoUpdateDebounceMs(value: unknown): number {
    const numeric = typeof value === "number" ? value : Number(value);

    if (!Number.isFinite(numeric)) {
        return READONLY_SHARE_AUTO_UPDATE_DEFAULT_DEBOUNCE_MS;
    }

    return Math.min(
        READONLY_SHARE_AUTO_UPDATE_MAX_DEBOUNCE_MS,
        Math.max(READONLY_SHARE_AUTO_UPDATE_MIN_DEBOUNCE_MS, Math.round(numeric)),
    );
}

export function shouldScheduleReadonlyShareAutoUpdate(
    input: ReadonlyShareAutoUpdateScheduleInput,
): boolean {
    return (
        input.enabled &&
        input.authenticated &&
        input.shareId.length > 0 &&
        input.shareEnabled &&
        input.shareNeedsUpdate &&
        !input.shareBusy &&
        !input.shareLoading &&
        input.currentFingerprint.length > 0 &&
        input.currentFingerprint !== input.lastFailedFingerprint
    );
}
