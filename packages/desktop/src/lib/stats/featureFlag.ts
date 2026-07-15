/** featureFlag.ts — Shared PostHog gate for NanoWriMo analytics features. */
import posthog from "$lib/posthog";

export const NOVEL_NOVEMBER_FEATURE_FLAG = "novel-november";

export function featureFlagEnablesWritingAnalytics(value: unknown): boolean {
    return value === true;
}

export function isWritingAnalyticsEnabled(): boolean {
    return featureFlagEnablesWritingAnalytics(posthog.getFeatureFlag(NOVEL_NOVEMBER_FEATURE_FLAG));
}

export function onWritingAnalyticsFlagChange(callback: (enabled: boolean) => void): () => void {
    const sync = () => callback(isWritingAnalyticsEnabled());
    sync();
    return posthog.onFeatureFlags(sync);
}
