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
    AUTHORSHIP_FEATURE_FLAG,
    authorshipEnabled,
    isAuthorshipEnabled,
    isNovelNovemberEnabled,
    novelNovemberEnabled,
    refreshAuthorshipFlag,
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

describe("authorship-provenance feature flag", () => {
    beforeEach(() => {
        mocks.enabled = false;
        refreshAuthorshipFlag();
    });

    it("uses the shared authorship-provenance flag key", () => {
        expect(AUTHORSHIP_FEATURE_FLAG).toBe("authorship-provenance");
    });

    it("fails closed when the shared PostHog flag is disabled", () => {
        expect(isAuthorshipEnabled()).toBe(false);
        expect(get(authorshipEnabled)).toBe(false);
    });

    it("reacts when PostHog loads an enabled flag value", () => {
        mocks.enabled = true;
        mocks.callback?.();

        expect(isAuthorshipEnabled()).toBe(true);
        expect(get(authorshipEnabled)).toBe(true);
    });
});
