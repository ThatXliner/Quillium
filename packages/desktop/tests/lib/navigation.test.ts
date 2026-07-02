import { beforeEach, describe, expect, it, vi } from "vitest";

const {
    mockCapture,
    mockDeregisterOpenDoc,
    mockFlushMetaDebounces,
    mockFlushPersistQueue,
    mockGoto,
} = vi.hoisted(() => ({
    mockCapture: vi.fn(),
    mockDeregisterOpenDoc: vi.fn(),
    mockFlushMetaDebounces: vi.fn(),
    mockFlushPersistQueue: vi.fn(),
    mockGoto: vi.fn(),
}));

vi.mock("$app/navigation", () => ({ goto: mockGoto }));
vi.mock("$lib/db", () => ({ deregisterOpenDoc: mockDeregisterOpenDoc }));
vi.mock("$lib/editor/listeners", () => ({
    flushMetaDebounces: mockFlushMetaDebounces,
    flushPersistQueue: mockFlushPersistQueue,
}));
vi.mock("$lib/posthog", () => ({ default: { capture: mockCapture } }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
    getCurrentWebviewWindow: () => ({ label: "main-window" }),
}));

import { goToAuthorship, goToEditor, goToHistory, goToLibrary } from "$lib/navigation";

describe("navigation helpers", () => {
    beforeEach(() => {
        mockCapture.mockClear();
        mockDeregisterOpenDoc.mockReset();
        mockFlushMetaDebounces.mockClear();
        mockFlushPersistQueue.mockReset();
        mockGoto.mockReset();
        mockDeregisterOpenDoc.mockResolvedValue(undefined);
        mockFlushPersistQueue.mockResolvedValue(undefined);
        mockGoto.mockResolvedValue(undefined);
        document.documentElement.removeAttribute("data-direction");
    });

    it("flushes pending work and deregisters the window before going to the library", async () => {
        await goToLibrary();

        expect(document.documentElement.getAttribute("data-direction")).toBe("left");
        expect(mockCapture).toHaveBeenCalledWith("navigated_to_library");
        expect(mockDeregisterOpenDoc).toHaveBeenCalledWith("main-window");
        expect(mockFlushMetaDebounces).toHaveBeenCalledTimes(1);
        expect(mockFlushPersistQueue).toHaveBeenCalledTimes(1);
        expect(mockGoto).toHaveBeenCalledWith("/library");
        expect(mockFlushPersistQueue.mock.invocationCallOrder[0]).toBeLessThan(
            mockGoto.mock.invocationCallOrder[0],
        );
    });

    it.each([
        ["history", goToHistory, "navigated_to_history", "/history"],
        ["authorship", goToAuthorship, "navigated_to_authorship", "/authorship"],
    ])("flushes pending work before going to %s", async (_, action, event, path) => {
        await action();

        expect(document.documentElement.getAttribute("data-direction")).toBe("left");
        expect(mockCapture).toHaveBeenCalledWith(event);
        expect(mockFlushMetaDebounces).toHaveBeenCalledTimes(1);
        expect(mockFlushPersistQueue).toHaveBeenCalledTimes(1);
        expect(mockGoto).toHaveBeenCalledWith(path);
        expect(mockDeregisterOpenDoc).not.toHaveBeenCalled();
    });

    it("goes back to the editor without waiting on persistence helpers", async () => {
        await goToEditor();

        expect(document.documentElement.getAttribute("data-direction")).toBe("right");
        expect(mockCapture).toHaveBeenCalledWith("navigated_to_editor");
        expect(mockFlushMetaDebounces).not.toHaveBeenCalled();
        expect(mockFlushPersistQueue).not.toHaveBeenCalled();
        expect(mockGoto).toHaveBeenCalledWith("/");
    });
});
