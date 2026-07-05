import {
    DEFAULT_RATE_LIMIT_BACKOFF_MS,
    UPDATE_CHECK_NOT_BEFORE_KEY,
    canCheckForUpdatesNow,
    deferUpdateChecksAfterRateLimit,
    deferUpdateChecksUntil,
    nextUpdateCheckAfterRateLimit,
} from "$lib/updater/schedule";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW = Date.UTC(2026, 3, 29, 12, 0, 0);

// Node 22+ ships an experimental built-in `localStorage` global that
// shadows jsdom's and throws unless `--localstorage-file` is set, so stub
// an in-memory implementation (matching tests/errorGuard.test.ts).
const store: Record<string, string> = {};

describe("update check schedule", () => {
    beforeEach(() => {
        for (const key of Object.keys(store)) delete store[key];
        vi.stubGlobal("localStorage", {
            getItem: (k: string) => store[k] ?? null,
            setItem: (k: string, v: string) => {
                store[k] = v;
            },
            removeItem: (k: string) => {
                delete store[k];
            },
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("allows checks when no not-before time is stored", () => {
        expect(canCheckForUpdatesNow(NOW)).toBe(true);
    });

    it("skips checks until the stored not-before time has passed", () => {
        deferUpdateChecksUntil(NOW + 1000, NOW);

        expect(canCheckForUpdatesNow(NOW)).toBe(false);
        expect(canCheckForUpdatesNow(NOW + 1000)).toBe(true);
        expect(localStorage.getItem(UPDATE_CHECK_NOT_BEFORE_KEY)).toBe(null);
    });

    it("does not shorten an existing deferral", () => {
        deferUpdateChecksUntil(NOW + 5000, NOW);
        deferUpdateChecksUntil(NOW + 1000, NOW);

        expect(localStorage.getItem(UPDATE_CHECK_NOT_BEFORE_KEY)).toBe(String(NOW + 5000));
    });

    it("uses x-ratelimit-reset when the error includes GitHub reset metadata", () => {
        const resetAt = NOW + 30_000;
        expect(
            nextUpdateCheckAfterRateLimit(
                `GitHub 403 Forbidden x-ratelimit-reset: ${Math.floor(resetAt / 1000)}`,
                NOW,
            ),
        ).toBe(resetAt);
    });

    it("uses retry-after seconds when present", () => {
        expect(nextUpdateCheckAfterRateLimit("429 Too Many Requests retry-after: 90", NOW)).toBe(
            NOW + 90_000,
        );
    });

    it("falls back to a one-hour rate-limit backoff", () => {
        expect(nextUpdateCheckAfterRateLimit("API rate limit exceeded", NOW)).toBe(
            NOW + DEFAULT_RATE_LIMIT_BACKOFF_MS,
        );
    });

    it("persists the rate-limit backoff", () => {
        deferUpdateChecksAfterRateLimit("API rate limit exceeded", NOW);

        expect(localStorage.getItem(UPDATE_CHECK_NOT_BEFORE_KEY)).toBe(
            String(NOW + DEFAULT_RATE_LIMIT_BACKOFF_MS),
        );
    });
});
