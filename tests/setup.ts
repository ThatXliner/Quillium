import { afterEach, beforeAll, vi } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";
import { randomFillSync } from "node:crypto";

// jsdom does not ship with WebCrypto; @tauri-apps/api uses crypto.getRandomValues
// internally for event IDs and IPC correlation tokens.
beforeAll(() => {
    Object.defineProperty(window, "crypto", {
        value: {
            getRandomValues: (buffer: Uint8Array) => randomFillSync(buffer),
        },
    });

    class MockIntersectionObserver {
        observe() {}
        disconnect() {}
        unobserve() {}
    }

    Object.defineProperty(globalThis, "IntersectionObserver", {
        value: MockIntersectionObserver,
        configurable: true,
    });

    if (!Element.prototype.animate) {
        Object.defineProperty(Element.prototype, "animate", {
            value: () => ({
                finished: Promise.resolve(),
                cancel() {},
                play() {},
                pause() {},
                reverse() {},
                addEventListener() {},
                removeEventListener() {},
            }),
            configurable: true,
        });
    }
});

// Reset all Tauri mocks between tests. Vitest reuses the jsdom window across
// tests in the same file, so without this, mockIPC handlers from one test
// bleed into the next.
afterEach(() => {
    clearMocks();
});

const mockAppSettings = {
    selectTextInNestedEditor: true,
    showNestedEditor: true,
    atomicRevisions: true,
    docFontFamily: "",
    docFontSize: 18,
    uiFontFamily: "",
    customQuickActions: [],
    titleVisibility: "hover",
};

vi.mock("$lib/settings.svelte", () => ({ appSettings: mockAppSettings }));
