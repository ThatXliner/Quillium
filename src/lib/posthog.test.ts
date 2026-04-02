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

// Mock settings — start with sharing OFF (default)
const mockSettings = vi.hoisted(() => ({
    shareDocumentAnalytics: false,
    shareDocumentKey: "",
    analyticsEnabled: true,
}));
vi.mock("$lib/settings.svelte", () => ({
    appSettings: mockSettings,
}));

import { capture, REDACTED_KEYS, syncShareDocumentAnalytics } from "$lib/posthog";

describe("capture", () => {
    beforeEach(() => {
        mockCapture.mockClear();
        mockSettings.shareDocumentAnalytics = false;
    });

    it("strips redacted keys when shareDocumentAnalytics is false", () => {
        capture("dictionary_synonym_replaced", { synonym: "happy", extra: 42 });
        expect(mockCapture).toHaveBeenCalledWith("dictionary_synonym_replaced", { extra: 42 });
    });

    it("passes all properties when shareDocumentAnalytics is true", () => {
        mockSettings.shareDocumentAnalytics = true;
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

describe("syncShareDocumentAnalytics", () => {
    beforeEach(() => {
        mockSetConfig.mockClear();
        mockRegister.mockClear();
        mockUnregister.mockClear();
    });

    it("clears masking and registers key when sharing with key", () => {
        syncShareDocumentAnalytics(true, "BUG-123");
        expect(mockSetConfig).toHaveBeenCalledWith({
            session_recording: { maskTextSelector: undefined },
        });
        expect(mockRegister).toHaveBeenCalledWith({ share_document_key: "BUG-123" });
    });

    it("sets masking and unregisters key when not sharing", () => {
        syncShareDocumentAnalytics(false, "");
        expect(mockSetConfig).toHaveBeenCalledWith({
            session_recording: { maskTextSelector: ".cm-content" },
        });
        expect(mockUnregister).toHaveBeenCalledWith("share_document_key");
    });

    it("unregisters key when sharing but key is empty", () => {
        syncShareDocumentAnalytics(true, "  ");
        expect(mockUnregister).toHaveBeenCalledWith("share_document_key");
    });
});
