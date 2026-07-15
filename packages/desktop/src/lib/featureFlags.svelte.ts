/**
 * featureFlags.svelte.ts — Shared reactive PostHog feature-flag state.
 *
 * Flags fail closed until PostHog explicitly enables them. Both the Svelte
 * store and rune state are exposed so existing components and services share
 * one PostHog subscription while the seasonal features are integrated.
 */

import posthog from "$lib/posthog";
import { writable } from "svelte/store";

export const NOVEL_NOVEMBER_FEATURE_FLAG = "novel-november";
export const NOVEL_NOVEMBER_FLAG = NOVEL_NOVEMBER_FEATURE_FLAG;

let novelNovember = false;
let stopFeatureFlagSync: () => void = () => {};
let featureFlagSyncStarted = false;

export const novelNovemberEnabled = writable(false);
export const featureFlags = $state({
    novelNovember: false,
    loaded: false,
});

export function isNovelNovemberFlagEnabled(value: boolean | string | undefined): boolean {
    return value === true;
}

export function refreshNovelNovemberFlag(): boolean {
    try {
        novelNovember = posthog.isFeatureEnabled(NOVEL_NOVEMBER_FEATURE_FLAG) === true;
    } catch {
        novelNovember = false;
    }
    featureFlags.novelNovember = novelNovember;
    featureFlags.loaded = true;
    novelNovemberEnabled.set(novelNovember);
    return novelNovember;
}

export function isNovelNovemberEnabled(): boolean {
    return novelNovember;
}

/** Start the app-wide feature-flag subscription. Safe to call more than once. */
export function startFeatureFlagSync(): () => void {
    if (!featureFlagSyncStarted) {
        featureFlagSyncStarted = true;
        try {
            stopFeatureFlagSync = posthog.onFeatureFlags(refreshNovelNovemberFlag) ?? (() => {});
            refreshNovelNovemberFlag();
        } catch {
            refreshNovelNovemberFlag();
        }
    }

    return () => {
        stopFeatureFlagSync();
        stopFeatureFlagSync = () => {};
        featureFlagSyncStarted = false;
    };
}

startFeatureFlagSync();
