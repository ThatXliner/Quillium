import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock posthog-js before importing our module
const { mockCapture, mockSetConfig } = vi.hoisted(() => ({
    mockCapture: vi.fn(),
    mockSetConfig: vi.fn(),
}));
vi.mock("posthog-js", () => ({
    default: {
        init: vi.fn(),
        register: vi.fn(),
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

// Mock settings — start with private analytics ON
const mockSettings = vi.hoisted(() => ({
    privateDocumentAnalytics: true,
    analyticsEnabled: true,
}));
vi.mock("$lib/settings.svelte", () => ({
    appSettings: mockSettings,
}));

import { capture, REDACTED_KEYS, syncPrivateAnalytics } from "$lib/posthog";

describe("capture", () => {
    beforeEach(() => {
        mockCapture.mockClear();
        mockSettings.privateDocumentAnalytics = true;
    });

    it("strips redacted keys when privateDocumentAnalytics is true", () => {
        capture("dictionary_synonym_replaced", { synonym: "happy", extra: 42 });
        expect(mockCapture).toHaveBeenCalledWith("dictionary_synonym_replaced", { extra: 42 });
    });

    it("passes all properties when privateDocumentAnalytics is false", () => {
        mockSettings.privateDocumentAnalytics = false;
        capture("dictionary_synonym_replaced", { synonym: "happy", extra: 42 });
        expect(mockCapture).toHaveBeenCalledWith("dictionary_synonym_replaced", {
            synonym: "happy",
            extra: 42,
        });
    });

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

describe("syncPrivateAnalytics", () => {
    beforeEach(() => {
        mockSetConfig.mockClear();
    });

    it("sets maskTextSelector when enabled", () => {
        syncPrivateAnalytics(true);
        expect(mockSetConfig).toHaveBeenCalledWith({
            session_recording: { maskTextSelector: ".cm-content" },
        });
    });

    it("clears maskTextSelector when disabled", () => {
        syncPrivateAnalytics(false);
        expect(mockSetConfig).toHaveBeenCalledWith({
            session_recording: { maskTextSelector: undefined },
        });
    });
});
