import { beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("$lib/settings.svelte");

import { getPersistUndoHistoryForNewDocuments } from "$lib/settings.svelte";

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
