import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock posthog-js before importing our module
const {
    mockCapture,
    mockSetConfig,
    mockRegister,
    mockUnregister,
    mockIsFeatureEnabled,
    featureFlagCallbacks,
} = vi.hoisted(() => ({
    mockCapture: vi.fn(),
    mockSetConfig: vi.fn(),
    mockRegister: vi.fn(),
    mockUnregister: vi.fn(),
    mockIsFeatureEnabled: vi.fn(),
    featureFlagCallbacks: [] as Array<() => void>,
}));
vi.mock("posthog-js", () => ({
    default: {
        init: vi.fn(),
        register: mockRegister,
        unregister: mockUnregister,
        opt_out_capturing: vi.fn(),
        opt_in_capturing: vi.fn(),
        capture: mockCapture,
        set_config: mockSetConfig,
        isFeatureEnabled: mockIsFeatureEnabled,
        onFeatureFlags: vi.fn((callback: () => void) => {
            featureFlagCallbacks.push(callback);
            return () => {
                const index = featureFlagCallbacks.indexOf(callback);
                if (index >= 0) featureFlagCallbacks.splice(index, 1);
            };
        }),
    },
}));
vi.mock("$app/environment", () => ({ dev: true }));

// Mock settings — document sharing is disabled (TODO #192: re-enable shareDocumentAnalytics)
const mockSettings = vi.hoisted(() => ({
    // shareDocumentAnalytics: false,
    // shareDocumentKey: "",
    analyticsEnabled: true,
}));
vi.mock("$lib/settings.svelte", () => ({
    appSettings: mockSettings,
}));

import {
    DOCUMENT_CONTENT_SELECTOR,
    REDACTED_KEYS,
    capture,
    novelNovemberEnabled,
    // TODO(#191): re-enable when syncShareDocumentAnalytics is restored
    // syncShareDocumentAnalytics,
} from "$lib/posthog";
import { get } from "svelte/store";

describe("capture", () => {
    beforeEach(() => {
        mockCapture.mockClear();
        // TODO(#191): reset mockSettings.shareDocumentAnalytics = false when re-enabled
    });

    it("strips redacted keys (document sharing is always off)", () => {
        capture("dictionary_synonym_replaced", { synonym: "happy", extra: 42 });
        expect(mockCapture).toHaveBeenCalledWith("dictionary_synonym_replaced", { extra: 42 });
    });

    // TODO(#191): restore this test when shareDocumentAnalytics is re-enabled
    // it("passes all properties when shareDocumentAnalytics is true", () => { ... });

    it("does not mutate the original props object", () => {
        const props = { synonym: "happy", extra: 42 };
        capture("dictionary_synonym_replaced", props);
        expect(props).toEqual({ synonym: "happy", extra: 42 });
    });

    it("works with no properties", () => {
        capture("some_event");
        expect(mockCapture).toHaveBeenCalledWith("some_event", undefined);
    });

    it("passes through events with no redacted keys untouched", () => {
        capture("document_created", { count: 1 });
        expect(mockCapture).toHaveBeenCalledWith("document_created", { count: 1 });
    });
});

describe("novelNovemberEnabled", () => {
    beforeEach(() => {
        mockIsFeatureEnabled.mockReset();
        mockIsFeatureEnabled.mockReturnValue(false);
    });

    it("defaults closed when PostHog does not return literal true", () => {
        expect(get(novelNovemberEnabled)).toBe(false);
    });

    it("reacts to novel-november flag changes", () => {
        const values: boolean[] = [];
        const unsubscribe = novelNovemberEnabled.subscribe((value) => values.push(value));

        mockIsFeatureEnabled.mockReturnValue(true);
        for (const callback of featureFlagCallbacks) callback();

        expect(values.at(-1)).toBe(true);
        expect(mockIsFeatureEnabled).toHaveBeenCalledWith("novel-november");
        unsubscribe();
    });
});

// TODO(#191): restore syncShareDocumentAnalytics tests when document sharing is re-enabled
// describe("syncShareDocumentAnalytics", () => { ... });
