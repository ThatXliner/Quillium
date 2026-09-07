import { collegeActivation, enableCollegeForDocument } from "$lib/college/activation.svelte";
import { currentDocumentId } from "$lib/stores";
import { cleanup, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ActivationEffectsHarness from "./ActivationEffectsHarness.svelte";

const db = vi.hoisted(() => ({
    getCollegeDocumentEnabled: vi.fn(),
    setCollegeDocumentEnabled: vi.fn(),
}));

vi.mock("$lib/db", () => db);

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, resolve, reject };
}

async function waitForLoaded(documentId: string, enabled = false): Promise<void> {
    await waitFor(() => {
        expect(collegeActivation.documentId).toBe(documentId);
        expect(collegeActivation.loading).toBe(false);
        expect(collegeActivation.enabled).toBe(enabled);
    });
}

describe("College document activation state", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        currentDocumentId.set(null);
        collegeActivation.documentId = null;
        collegeActivation.enabled = false;
        collegeActivation.loading = false;
        collegeActivation.saving = false;
        collegeActivation.error = "";
        db.getCollegeDocumentEnabled.mockResolvedValue(false);
        db.setCollegeDocumentEnabled.mockResolvedValue(undefined);
    });

    afterEach(() => {
        cleanup();
        currentDocumentId.set(null);
    });

    it("discards a late load when switching from document A to B", async () => {
        const firstLoad = deferred<boolean>();
        db.getCollegeDocumentEnabled.mockImplementation((documentId: string) =>
            documentId === "document-a" ? firstLoad.promise : Promise.resolve(false),
        );
        currentDocumentId.set("document-a");
        render(ActivationEffectsHarness);
        await waitFor(() => expect(collegeActivation.loading).toBe(true));

        currentDocumentId.set("document-b");
        await waitForLoaded("document-b");

        firstLoad.resolve(true);
        await Promise.resolve();
        expect(collegeActivation.documentId).toBe("document-b");
        expect(collegeActivation.enabled).toBe(false);
        expect(collegeActivation.error).toBe("");
    });

    it("does not expose College when enabling fails", async () => {
        db.setCollegeDocumentEnabled.mockRejectedValueOnce(new Error("disk full"));
        currentDocumentId.set("document-a");
        render(ActivationEffectsHarness);
        await waitForLoaded("document-a");

        await expect(enableCollegeForDocument("document-a")).resolves.toBe(false);
        expect(collegeActivation.enabled).toBe(false);
        expect(collegeActivation.saving).toBe(false);
        expect(collegeActivation.error).toContain("disk full");
    });

    it("publishes a confirmed enable and reloads it after a document switch", async () => {
        let persisted = false;
        db.getCollegeDocumentEnabled.mockImplementation(async (documentId: string) =>
            documentId === "document-a" ? persisted : false,
        );
        db.setCollegeDocumentEnabled.mockImplementation(
            async (documentId: string, enabled: boolean) => {
                if (documentId === "document-a") persisted = enabled;
            },
        );
        currentDocumentId.set("document-a");
        render(ActivationEffectsHarness);
        await waitForLoaded("document-a");

        await expect(enableCollegeForDocument("document-a")).resolves.toBe(true);
        expect(collegeActivation.enabled).toBe(true);

        currentDocumentId.set("document-b");
        await waitForLoaded("document-b");
        currentDocumentId.set("document-a");
        await waitForLoaded("document-a", true);
        expect(db.setCollegeDocumentEnabled).toHaveBeenCalledWith("document-a", true);
    });

    it("does not publish a stale enable after switching documents", async () => {
        const write = deferred<void>();
        db.setCollegeDocumentEnabled.mockReturnValueOnce(write.promise);
        currentDocumentId.set("document-a");
        render(ActivationEffectsHarness);
        await waitForLoaded("document-a");

        const enabling = enableCollegeForDocument("document-a");
        await waitFor(() => expect(collegeActivation.saving).toBe(true));
        currentDocumentId.set("document-b");
        await waitForLoaded("document-b");

        write.resolve();
        await expect(enabling).resolves.toBe(false);
        expect(collegeActivation.documentId).toBe("document-b");
        expect(collegeActivation.enabled).toBe(false);
        expect(collegeActivation.error).toBe("");
    });

    it("waits for a pending enable before reloading a document", async () => {
        const write = deferred<void>();
        let persisted = false;
        db.getCollegeDocumentEnabled.mockImplementation(async (documentId: string) =>
            documentId === "document-a" ? persisted : false,
        );
        db.setCollegeDocumentEnabled.mockImplementation(async () => {
            await write.promise;
            persisted = true;
        });
        currentDocumentId.set("document-a");
        render(ActivationEffectsHarness);
        await waitForLoaded("document-a");

        const enabling = enableCollegeForDocument("document-a");
        await waitFor(() => expect(collegeActivation.saving).toBe(true));
        currentDocumentId.set("document-b");
        await waitForLoaded("document-b");
        currentDocumentId.set("document-a");
        await waitFor(() => {
            expect(collegeActivation.documentId).toBe("document-a");
            expect(collegeActivation.loading).toBe(true);
        });

        write.resolve();
        await expect(enabling).resolves.toBe(false);
        await waitForLoaded("document-a", true);
    });

    it("does not let a pending load overwrite a successful enable", async () => {
        const load = deferred<boolean>();
        db.getCollegeDocumentEnabled.mockReturnValueOnce(load.promise).mockResolvedValue(false);
        currentDocumentId.set("document-a");
        render(ActivationEffectsHarness);
        await waitFor(() => expect(collegeActivation.loading).toBe(true));

        await expect(enableCollegeForDocument("document-a")).resolves.toBe(true);
        expect(collegeActivation.enabled).toBe(true);
        load.resolve(false);
        await Promise.resolve();
        expect(collegeActivation.enabled).toBe(true);
        expect(collegeActivation.loading).toBe(false);
    });
});
