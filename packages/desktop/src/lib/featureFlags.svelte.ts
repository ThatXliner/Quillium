/**
 * featureFlags.svelte.ts — Shared PostHog feature-flag state.
 *
 * Flags fail closed until PostHog has loaded their values. Keeping the shared
 * key here prevents UI visibility and behavior gates from drifting apart.
 */

import posthog from "$lib/posthog";
import { writable } from "svelte/store";

export const NOVEL_NOVEMBER_FLAG = "novel-november";

let novelNovember = false;
export const novelNovemberEnabled = writable(false);

export function refreshNovelNovemberFlag(): boolean {
    try {
        novelNovember = posthog.isFeatureEnabled(NOVEL_NOVEMBER_FLAG) === true;
    } catch {
        novelNovember = false;
    }
    novelNovemberEnabled.set(novelNovember);
    return novelNovember;
}

export function isNovelNovemberEnabled(): boolean {
    return novelNovember;
}

try {
    posthog.onFeatureFlags(refreshNovelNovemberFlag);
    refreshNovelNovemberFlag();
} catch {
    // PostHog is intentionally unavailable in dev and in builds without env vars.
}
