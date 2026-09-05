import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCapture, mockDeregisterOpenDoc, mockFlushPersistence, mockGoto } = vi.hoisted(() => ({
    mockCapture: vi.fn(),
    mockDeregisterOpenDoc: vi.fn(),
    mockFlushPersistence: vi.fn(),
    mockGoto: vi.fn(),
}));

vi.mock("$app/navigation", () => ({ goto: mockGoto }));
vi.mock("$lib/db", () => ({ deregisterOpenDoc: mockDeregisterOpenDoc }));
vi.mock("$lib/editor/listeners", () => ({
    flushPersistence: mockFlushPersistence,
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
        mockFlushPersistence.mockReset();
        mockGoto.mockReset();
        mockDeregisterOpenDoc.mockResolvedValue(undefined);
        mockFlushPersistence.mockResolvedValue(undefined);
        mockGoto.mockResolvedValue(undefined);
        document.documentElement.removeAttribute("data-direction");
    });

    it("flushes pending work and deregisters the window before going to the library", async () => {
        await goToLibrary();

        expect(document.documentElement.getAttribute("data-direction")).toBe("left");
        expect(mockCapture).toHaveBeenCalledWith("navigated_to_library");
        expect(mockDeregisterOpenDoc).toHaveBeenCalledWith("main-window");
        expect(mockFlushPersistence).toHaveBeenCalledTimes(1);
        expect(mockGoto).toHaveBeenCalledWith("/library");
        expect(mockFlushPersistence.mock.invocationCallOrder[0]).toBeLessThan(
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
        expect(mockFlushPersistence).toHaveBeenCalledTimes(1);
        expect(mockGoto).toHaveBeenCalledWith(path);
        expect(mockDeregisterOpenDoc).not.toHaveBeenCalled();
    });

    it("waits for persistence completion before navigating", async () => {
        let finish!: () => void;
        mockFlushPersistence.mockReturnValue(
            new Promise<void>((resolve) => {
                finish = resolve;
            }),
        );
        const navigation = goToLibrary();
        expect(mockGoto).not.toHaveBeenCalled();
        finish();
        await navigation;
        expect(mockGoto).toHaveBeenCalledWith("/library");
    });

    it("goes back to the editor without waiting on persistence helpers", async () => {
        await goToEditor();

        expect(document.documentElement.getAttribute("data-direction")).toBe("right");
        expect(mockCapture).toHaveBeenCalledWith("navigated_to_editor");
        expect(mockFlushPersistence).not.toHaveBeenCalled();
        expect(mockGoto).toHaveBeenCalledWith("/");
    });
});
