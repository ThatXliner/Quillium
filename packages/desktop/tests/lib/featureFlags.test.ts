import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

type FlagCallback = (
    flags: string[],
    variants: Record<string, boolean | string>,
    context?: { errorsLoading?: boolean },
) => void;

const mocks = vi.hoisted(() => ({
    values: {} as Record<string, boolean | string | undefined>,
    callback: undefined as FlagCallback | undefined,
    getFeatureFlag: vi.fn(),
    unsubscribe: vi.fn(),
    onFeatureFlags: vi.fn(),
}));

vi.mock("$lib/posthog", () => ({
    default: {
        getFeatureFlag: mocks.getFeatureFlag,
        onFeatureFlags: mocks.onFeatureFlags,
    },
}));

import {
    AUTHORSHIP_FEATURE_FLAG,
    NOVEL_NOVEMBER_FEATURE_FLAG,
    authorshipEnabled,
    isNovelNovemberEnabled,
    novelNovemberEnabled,
    startFeatureFlagSync,
} from "$lib/featureFlags.svelte";

function publishFlags(errorsLoading = false): void {
    mocks.callback?.([], {}, { errorsLoading });
}

describe("shared PostHog feature gates", () => {
    beforeEach(() => {
        startFeatureFlagSync()();
        vi.resetAllMocks();
        mocks.values = {};
        mocks.getFeatureFlag.mockImplementation((key: string) => mocks.values[key]);
        mocks.onFeatureFlags.mockImplementation((callback: FlagCallback) => {
            mocks.callback = callback;
            return mocks.unsubscribe;
        });
        startFeatureFlagSync();
    });

    it("reads the configured PostHog keys", () => {
        expect(mocks.getFeatureFlag).toHaveBeenCalledWith("novel-november");
        expect(mocks.getFeatureFlag).toHaveBeenCalledWith("authorship-provenance");
    });

    it.each([undefined, false, "control", "true", true])(
        "enables gates only for literal true, received %s",
        (value) => {
            mocks.values[NOVEL_NOVEMBER_FEATURE_FLAG] = value;
            mocks.values[AUTHORSHIP_FEATURE_FLAG] = value;
            publishFlags();

            expect(get(novelNovemberEnabled)).toBe(value === true);
            expect(isNovelNovemberEnabled()).toBe(value === true);
            expect(get(authorshipEnabled)).toBe(value === true);
        },
    );

    it("shares updates with services and subscribers while keeping gates independent", () => {
        const values: boolean[] = [];
        const unsubscribe = novelNovemberEnabled.subscribe((value) => values.push(value));
        mocks.values[NOVEL_NOVEMBER_FEATURE_FLAG] = true;
        publishFlags();
        expect(isNovelNovemberEnabled()).toBe(true);
        expect(get(authorshipEnabled)).toBe(false);

        mocks.values[NOVEL_NOVEMBER_FEATURE_FLAG] = false;
        mocks.values[AUTHORSHIP_FEATURE_FLAG] = true;
        publishFlags();
        expect(values).toEqual([false, true, false]);
        expect(isNovelNovemberEnabled()).toBe(false);
        expect(get(authorshipEnabled)).toBe(true);
        unsubscribe();
    });

    it("closes previously enabled gates on loading errors and recovers on success", () => {
        mocks.values[NOVEL_NOVEMBER_FEATURE_FLAG] = true;
        mocks.values[AUTHORSHIP_FEATURE_FLAG] = true;
        publishFlags();
        publishFlags(true);
        expect(get(novelNovemberEnabled)).toBe(false);
        expect(get(authorshipEnabled)).toBe(false);

        publishFlags();
        expect(get(novelNovemberEnabled)).toBe(true);
        expect(get(authorshipEnabled)).toBe(true);
    });

    it("fails closed when reading flags throws", () => {
        mocks.values[NOVEL_NOVEMBER_FEATURE_FLAG] = true;
        mocks.values[AUTHORSHIP_FEATURE_FLAG] = true;
        publishFlags();
        mocks.getFeatureFlag.mockImplementation(() => {
            throw new Error("PostHog unavailable");
        });
        publishFlags();
        expect(get(novelNovemberEnabled)).toBe(false);
        expect(get(authorshipEnabled)).toBe(false);
    });

    it("keeps a single subscription and allows restarting after cleanup", () => {
        const stop = startFeatureFlagSync();
        startFeatureFlagSync();
        expect(mocks.onFeatureFlags).toHaveBeenCalledTimes(1);
        stop();
        expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
        startFeatureFlagSync();
        expect(mocks.onFeatureFlags).toHaveBeenCalledTimes(2);
    });

    it("fails closed when subscription setup throws and retries on the next start", () => {
        startFeatureFlagSync()();
        mocks.values[NOVEL_NOVEMBER_FEATURE_FLAG] = true;
        mocks.onFeatureFlags.mockImplementationOnce(() => {
            throw new Error("PostHog unavailable");
        });
        startFeatureFlagSync();
        expect(get(novelNovemberEnabled)).toBe(false);
        expect(get(authorshipEnabled)).toBe(false);
        startFeatureFlagSync();
        expect(get(novelNovemberEnabled)).toBe(true);
    });

    it("preserves an immediate loading error during subscription setup", () => {
        startFeatureFlagSync()();
        mocks.values[NOVEL_NOVEMBER_FEATURE_FLAG] = true;
        mocks.onFeatureFlags.mockImplementationOnce((callback: FlagCallback) => {
            callback([], {}, { errorsLoading: true });
            return mocks.unsubscribe;
        });
        startFeatureFlagSync();
        expect(get(novelNovemberEnabled)).toBe(false);
    });
});
