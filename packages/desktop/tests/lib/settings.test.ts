import { beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("$lib/settings.svelte");

import {
    appSettings,
    getPersistUndoHistoryForNewDocuments,
    previewSettings,
    updateSettings,
} from "$lib/settings.svelte";

const STORAGE_KEY = "quillium-app-settings";

describe("getPersistUndoHistoryForNewDocuments", () => {
    beforeEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it("reads changes made after the settings module initialized", () => {
        expect(getPersistUndoHistoryForNewDocuments()).toBe(false);

        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ persistUndoHistoryForNewDocuments: true }),
        );
        expect(getPersistUndoHistoryForNewDocuments()).toBe(true);

        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ persistUndoHistoryForNewDocuments: false }),
        );
        expect(getPersistUndoHistoryForNewDocuments()).toBe(false);
    });

    it("defaults safely when persisted settings are missing, malformed, or non-boolean", () => {
        expect(getPersistUndoHistoryForNewDocuments()).toBe(false);

        localStorage.setItem(STORAGE_KEY, "not json");
        expect(getPersistUndoHistoryForNewDocuments()).toBe(false);

        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ persistUndoHistoryForNewDocuments: "true" }),
        );
        expect(getPersistUndoHistoryForNewDocuments()).toBe(false);
    });

    it("defaults safely when storage cannot be read", () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("storage unavailable");
        });

        expect(getPersistUndoHistoryForNewDocuments()).toBe(false);
    });
});

describe("settings commits", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        localStorage.clear();
        updateSettings({
            uiZoom: 1,
            docFontSize: 18,
            showWordCount: true,
            persistUndoHistoryForNewDocuments: false,
        });
    });

    it("applies and persists a partial update while retaining unrelated preferences", () => {
        updateSettings({ uiZoom: 1.2, docFontSize: 22, showWordCount: false });
        expect(document.documentElement.style.zoom).toBe("1.2");
        expect(document.documentElement.style.getPropertyValue("--doc-font-size")).toBe("22px");
        expect(appSettings.showWordCount).toBe(false);
        expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({
            uiZoom: 1.2,
            docFontSize: 22,
            showWordCount: false,
        });
        updateSettings({ uiZoom: 1.3 });
        expect(appSettings.docFontSize).toBe(22);
    });

    it("retains another window's undo policy when committing an unrelated change", () => {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                ...stored,
                persistUndoHistoryForNewDocuments: true,
                showWordCount: false,
            }),
        );
        expect(appSettings.persistUndoHistoryForNewDocuments).toBe(false);
        updateSettings({ uiZoom: 1.1 });
        expect(appSettings.persistUndoHistoryForNewDocuments).toBe(true);
        expect(appSettings.showWordCount).toBe(false);
        expect(getPersistUndoHistoryForNewDocuments()).toBe(true);
        updateSettings({ persistUndoHistoryForNewDocuments: false });
        expect(getPersistUndoHistoryForNewDocuments()).toBe(false);
    });

    it("previews and discards appearance without changing committed settings", () => {
        const saved = { ...appSettings };
        const persisted = localStorage.getItem(STORAGE_KEY);
        previewSettings({ ...saved, docFontSize: 24 });
        expect(document.documentElement.style.getPropertyValue("--doc-font-size")).toBe("24px");
        expect(appSettings.docFontSize).toBe(18);
        expect(localStorage.getItem(STORAGE_KEY)).toBe(persisted);
        previewSettings(saved);
        expect(document.documentElement.style.getPropertyValue("--doc-font-size")).toBe("18px");
    });

    it("normalizes committed sizes, debounce, reminders, and warning snooze", () => {
        updateSettings({
            uiZoom: 9,
            docFontSize: 1,
            annotationPanelWidth: 999,
            draftPanelWidth: -1,
            readonlyShareAutoUpdateDebounceMs: Number.NaN,
            writingReminderTimes: ["18:00", "bad", "09:00", "18:00"],
            writingReminderDays: [6, 0, 9, 0],
            duplicateDraftWarningHiddenUntil: Number.POSITIVE_INFINITY,
        });
        expect(appSettings).toMatchObject({
            uiZoom: 2,
            docFontSize: 14,
            annotationPanelWidth: 420,
            draftPanelWidth: 192,
            readonlyShareAutoUpdateDebounceMs: 5000,
            writingReminderTimes: ["09:00", "18:00"],
            writingReminderDays: [0, 6],
            duplicateDraftWarningHiddenUntil: 0,
        });
        updateSettings({
            uiZoom: 0,
            annotationPanelWidth: 0,
            writingReminderTimes: [],
            writingReminderDays: [],
            draftPanelWidth: 230.6,
        });
        expect(appSettings).toMatchObject({
            uiZoom: 0.5,
            annotationPanelWidth: 180,
            writingReminderTimes: ["09:00"],
            writingReminderDays: [0, 1, 2, 3, 4, 5, 6],
            draftPanelWidth: 231,
        });
        expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(appSettings);
    });

    it("keeps the current preferences usable when storage is unavailable", () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw Error("unavailable");
        });
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw Error("unavailable");
        });
        expect(() => updateSettings({ uiZoom: 1.4 })).not.toThrow();
        expect(appSettings.uiZoom).toBe(1.4);
        expect(appSettings.docFontSize).toBe(18);
        expect(document.documentElement.style.zoom).toBe("1.4");
    });
});
