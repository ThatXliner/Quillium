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
/**
 * Gates the authorship-provenance report (`/authorship`, its native menu item,
 * and the report export). The classifier and report builder behind it have not
 * been reviewed, and the feature's whole value is being trustworthy about who
 * wrote what, so it stays off until it has been.
 */
export const AUTHORSHIP_FEATURE_FLAG = "authorship-provenance";

let novelNovember = false;
let authorship = false;
let stopFeatureFlagSync: () => void = () => {};
let featureFlagSyncStarted = false;

export const novelNovemberEnabled = writable(false);
export const authorshipEnabled = writable(false);
export const featureFlags = $state({
    novelNovember: false,
    authorship: false,
    loaded: false,
});

export function isNovelNovemberFlagEnabled(value: boolean | string | undefined): boolean {
    return value === true;
}

function readFlag(key: string): boolean {
    try {
        return posthog.isFeatureEnabled(key) === true;
    } catch {
        return false;
    }
}

export function refreshNovelNovemberFlag(): boolean {
    novelNovember = readFlag(NOVEL_NOVEMBER_FEATURE_FLAG);
    featureFlags.novelNovember = novelNovember;
    featureFlags.loaded = true;
    novelNovemberEnabled.set(novelNovember);
    return novelNovember;
}

export function refreshAuthorshipFlag(): boolean {
    authorship = readFlag(AUTHORSHIP_FEATURE_FLAG);
    featureFlags.authorship = authorship;
    featureFlags.loaded = true;
    authorshipEnabled.set(authorship);
    return authorship;
}

/** Re-read every gate. This is what the PostHog subscription calls. */
export function refreshFeatureFlags(): void {
    refreshNovelNovemberFlag();
    refreshAuthorshipFlag();
}

export function isNovelNovemberEnabled(): boolean {
    return novelNovember;
}

export function isAuthorshipEnabled(): boolean {
    return authorship;
}

/** Start the app-wide feature-flag subscription. Safe to call more than once. */
export function startFeatureFlagSync(): () => void {
    if (!featureFlagSyncStarted) {
        featureFlagSyncStarted = true;
        try {
            stopFeatureFlagSync = posthog.onFeatureFlags(refreshFeatureFlags) ?? (() => {});
            refreshFeatureFlags();
        } catch {
            refreshFeatureFlags();
        }
    }

    return () => {
        stopFeatureFlagSync();
        stopFeatureFlagSync = () => {};
        featureFlagSyncStarted = false;
    };
}

startFeatureFlagSync();
