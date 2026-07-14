/**
 * featureFlags.ts — Reactive PostHog feature-flag gates shared across the app.
 *
 * Gates default closed until PostHog has loaded flags. This avoids briefly
 * exposing unreleased UI and keeps features unavailable when flags fail to load.
 */
import posthog from "posthog-js";
import { readable } from "svelte/store";

export const NOVEL_NOVEMBER_FEATURE_FLAG = "novel-november";

export function isBooleanFeatureEnabled(value: boolean | string | undefined): boolean {
    return value === true;
}

export function resolveFeatureGate(
    value: boolean | string | undefined,
    errorsLoading = false,
): boolean {
    return !errorsLoading && isBooleanFeatureEnabled(value);
}

export const novelNovemberEnabled = readable(false, (set) => {
    return posthog.onFeatureFlags((_flags, _variants, context) => {
        set(
            resolveFeatureGate(
                posthog.getFeatureFlag(NOVEL_NOVEMBER_FEATURE_FLAG),
                context?.errorsLoading,
            ),
        );
    });
});
