import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    enabled: false,
    callback: undefined as (() => void) | undefined,
}));

vi.mock("$lib/posthog", () => ({
    default: {
        isFeatureEnabled: vi.fn(() => mocks.enabled),
        onFeatureFlags: vi.fn((callback: () => void) => {
            mocks.callback = callback;
        }),
    },
}));

import {
    isNovelNovemberEnabled,
    novelNovemberEnabled,
    refreshNovelNovemberFlag,
} from "$lib/featureFlags.svelte";

describe("novel-november feature flag", () => {
    beforeEach(() => {
        mocks.enabled = false;
        refreshNovelNovemberFlag();
    });

    it("fails closed when the shared PostHog flag is disabled", () => {
        expect(isNovelNovemberEnabled()).toBe(false);
        expect(get(novelNovemberEnabled)).toBe(false);
    });

    it("reacts when PostHog loads an enabled flag value", () => {
        mocks.enabled = true;
        mocks.callback?.();

        expect(isNovelNovemberEnabled()).toBe(true);
        expect(get(novelNovemberEnabled)).toBe(true);
    });
});
