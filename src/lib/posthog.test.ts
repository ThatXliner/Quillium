import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock posthog-js before importing our module
const { mockCapture, mockSetConfig, mockRegister, mockUnregister } = vi.hoisted(() => ({
    mockCapture: vi.fn(),
    mockSetConfig: vi.fn(),
    mockRegister: vi.fn(),
    mockUnregister: vi.fn(),
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
    },
}));
vi.mock("$app/environment", () => ({ dev: true }));
vi.mock("$env/static/public", () => ({
    PUBLIC_POSTHOG_KEY: "",
    PUBLIC_POSTHOG_HOST: "",
}));

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
    capture,
    DOCUMENT_CONTENT_SELECTOR,
    REDACTED_KEYS,
    // TODO(#191): re-enable when syncShareDocumentAnalytics is restored
    // syncShareDocumentAnalytics,
} from "$lib/posthog";

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

// TODO(#191): restore syncShareDocumentAnalytics tests when document sharing is re-enabled
// describe("syncShareDocumentAnalytics", () => { ... });
