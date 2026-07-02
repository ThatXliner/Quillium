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
    editorMode: "markdown",
    docFontFamily: "",
    docFontSize: 18,
    uiFontFamily: "",
    customQuickActions: [],
    titleVisibility: "hover",
    autoVersionOnRevisionCreate: true,
    readonlyShareAutoUpdate: false,
    readonlyShareAutoUpdateDebounceMs: 5000,
};

vi.mock("$lib/settings.svelte", () => ({
    appSettings: mockAppSettings,
    applySettings: vi.fn(),
    persistSettings: vi.fn(),
}));
