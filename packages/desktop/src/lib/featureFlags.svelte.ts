/**
 * featureFlags.svelte.ts — Shared PostHog gates for components and services.
 * Only literal true enables a feature; missing values and loading errors fail closed.
 */

import posthog from "$lib/posthog";
import { get, readonly, writable } from "svelte/store";

export const NOVEL_NOVEMBER_FEATURE_FLAG = "novel-november";
/**
 * Gates the authorship report, native menu item, and export until its
 * classifier and report builder have been reviewed.
 */
export const AUTHORSHIP_FEATURE_FLAG = "authorship-provenance";

const novelNovember = writable(false);
const authorship = writable(false);
export const novelNovemberEnabled = readonly(novelNovember);
export const authorshipEnabled = readonly(authorship);

let stopFeatureFlagSync: (() => void) | undefined;

function readFlag(key: string): boolean {
    try {
        return posthog.getFeatureFlag(key) === true;
    } catch {
        return false;
    }
}

function refreshFeatureFlags(errorsLoading = false): void {
    novelNovember.set(!errorsLoading && readFlag(NOVEL_NOVEMBER_FEATURE_FLAG));
    authorship.set(!errorsLoading && readFlag(AUTHORSHIP_FEATURE_FLAG));
}

export function isNovelNovemberEnabled(): boolean {
    return get(novelNovemberEnabled);
}

/** Start the app-wide feature-flag subscription. Safe to call more than once. */
export function startFeatureFlagSync(): () => void {
    if (!stopFeatureFlagSync) {
        refreshFeatureFlags();
        try {
            stopFeatureFlagSync =
                posthog.onFeatureFlags((_flags, _variants, context) => {
                    refreshFeatureFlags(context?.errorsLoading);
                }) ?? (() => {});
        } catch {
            refreshFeatureFlags(true);
        }
    }

    return () => {
        stopFeatureFlagSync?.();
        stopFeatureFlagSync = undefined;
    };
}

startFeatureFlagSync();
