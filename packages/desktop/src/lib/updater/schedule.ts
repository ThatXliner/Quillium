import { errorText } from "./errors";

export const UPDATE_CHECK_NOT_BEFORE_KEY = "quillium_update_check_not_before";
export const DEFAULT_RATE_LIMIT_BACKOFF_MS = 60 * 60 * 1000;

function storedNotBefore(): number | null {
    try {
        const raw = localStorage.getItem(UPDATE_CHECK_NOT_BEFORE_KEY);
        if (!raw) return null;
        const timestamp = Number(raw);
        return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
    } catch {
        return null;
    }
}

export function canCheckForUpdatesNow(now = Date.now()): boolean {
    const notBefore = storedNotBefore();
    if (notBefore === null) return true;
    if (now < notBefore) return false;

    try {
        localStorage.removeItem(UPDATE_CHECK_NOT_BEFORE_KEY);
    } catch {}
    return true;
}

export function deferUpdateChecksUntil(notBefore: number, now = Date.now()) {
    if (!Number.isFinite(notBefore) || notBefore <= now) return;

    const existing = storedNotBefore();
    const next = existing === null ? notBefore : Math.max(existing, notBefore);
    try {
        localStorage.setItem(UPDATE_CHECK_NOT_BEFORE_KEY, String(Math.ceil(next)));
    } catch {}
}

function parseEpochMs(value: string): number | null {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
}

export function nextUpdateCheckAfterRateLimit(error: unknown, now = Date.now()): number {
    const text = errorText(error);
    const resetMatch = text.match(/x-ratelimit-reset["'\s:=]+(\d{10,13})/i);
    const resetAt = resetMatch ? parseEpochMs(resetMatch[1]) : null;
    if (resetAt && resetAt > now) return resetAt;

    const retryAfterSecondsMatch = text.match(/retry-after["'\s:=]+(\d+)/i);
    if (retryAfterSecondsMatch) {
        return now + Number(retryAfterSecondsMatch[1]) * 1000;
    }

    const retryAfterDateMatch = text.match(/retry-after["'\s:=]+([^"',}]+)/i);
    if (retryAfterDateMatch) {
        const retryAt = Date.parse(retryAfterDateMatch[1].trim());
        if (Number.isFinite(retryAt) && retryAt > now) return retryAt;
    }

    return now + DEFAULT_RATE_LIMIT_BACKOFF_MS;
}

export function deferUpdateChecksAfterRateLimit(error: unknown, now = Date.now()) {
    deferUpdateChecksUntil(nextUpdateCheckAfterRateLimit(error, now), now);
}
