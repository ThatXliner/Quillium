/**
 * featureFlags.svelte.ts — Shared reactive PostHog feature-flag state.
 *
 * Feature-gated code defaults closed until PostHog has loaded the flag set.
 */

import posthog, { isPostHogInitialised } from "$lib/posthog";

export const NOVEL_NOVEMBER_FEATURE_FLAG = "novel-november";

export const featureFlags = $state({
    novelNovember: false,
    loaded: false,
});

export function isNovelNovemberFlagEnabled(value: boolean | string | undefined): boolean {
    return value === true;
}

function refreshFeatureFlags(): void {
    featureFlags.novelNovember = isNovelNovemberFlagEnabled(
        posthog.getFeatureFlag(NOVEL_NOVEMBER_FEATURE_FLAG),
    );
    featureFlags.loaded = true;
}

/** Start the shared feature-flag subscription. Returns its cleanup callback. */
export function startFeatureFlagSync(): () => void {
    if (!isPostHogInitialised()) {
        featureFlags.novelNovember = false;
        featureFlags.loaded = true;
        return () => {};
    }
    refreshFeatureFlags();
    return posthog.onFeatureFlags(refreshFeatureFlags);
}
