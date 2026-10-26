import { randomFillSync } from "node:crypto";
import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach, beforeAll, vi } from "vitest";

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
    annotationPanelWidth: 280,
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
    persistUndoHistoryForNewDocuments: false,
};

vi.mock("$lib/settings.svelte", () => ({
    appSettings: mockAppSettings,
    ANNOTATION_PANEL_MIN_WIDTH: 180,
    ANNOTATION_PANEL_MAX_WIDTH: 420,
    ANNOTATION_PANEL_DEFAULT_WIDTH: 280,
    previewSettings: vi.fn(),
    getPersistUndoHistoryForNewDocuments: () => false,
    updateSettings: vi.fn((patch) => Object.assign(mockAppSettings, patch)),
}));
