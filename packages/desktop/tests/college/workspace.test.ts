import { newCollegeSetup } from "$lib/college/presets";
import { collegeState } from "$lib/college/state.svelte";
import {
    applyCollegeToExistingTab,
    beginCollegeTabPick,
    cancelCollegeTabPick,
    collegeWorkspace,
} from "$lib/college/workspace.svelte";
import { currentDocumentId, currentTabId } from "$lib/stores";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
    getCollegeTabSetup: vi.fn(),
    setCollegeTabSetup: vi.fn(),
}));
const stopAllAi = vi.hoisted(() => vi.fn());

vi.mock("$lib/db", () => db);
vi.mock("$lib/ai/settings.svelte", () => ({ stopAllAi }));

function setup() {
    return newCollegeSetup("uc-piq");
}

function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
} {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
}

beforeEach(() => {
    currentDocumentId.set("doc-1");
    currentTabId.set("tab-1");
    collegeState.documentId = "doc-1";
    collegeState.tabId = "tab-1";
    collegeState.setup = null;
    collegeState.status = "ready";
    collegeState.error = "";
    collegeState.saving = false;
    collegeState.hostEnabled = true;
    collegeWorkspace.documentId = null;
    collegeWorkspace.setup = null;
    collegeWorkspace.saving = false;
    collegeWorkspace.error = "";
    db.getCollegeTabSetup.mockReset();
    db.setCollegeTabSetup.mockReset();
    db.setCollegeTabSetup.mockResolvedValue(undefined);
    stopAllAi.mockClear();
});

describe("College workspace", () => {
    it("captures a cloned single-prompt setup and rejects invalid ownership", () => {
        const selected = setup();
        beginCollegeTabPick("doc-1", selected);
        selected.school = "Changed after capture";

        expect(collegeWorkspace.documentId).toBe("doc-1");
        expect(collegeWorkspace.setup?.school).toBe("");
        expect(collegeWorkspace.error).toBe("");

        expect(() => beginCollegeTabPick("doc-2", setup())).toThrow(/another document/i);
        collegeState.hostEnabled = false;
        expect(() => beginCollegeTabPick("doc-1", setup())).toThrow(/disabled/i);
    });

    it("cancels a pending selection without aborting a started durable write", async () => {
        const pending = deferred<void>();
        db.setCollegeTabSetup.mockReturnValue(pending.promise);
        beginCollegeTabPick("doc-1", setup());
        const applying = applyCollegeToExistingTab("tab-2");

        expect(collegeWorkspace.saving).toBe(true);
        cancelCollegeTabPick();
        pending.resolve();

        await expect(applying).resolves.toBe(false);
        expect(db.setCollegeTabSetup).toHaveBeenCalledOnce();
        expect(stopAllAi).toHaveBeenCalledOnce();
        expect(collegeWorkspace.documentId).toBeNull();
        expect(collegeWorkspace.setup).toBeNull();
        expect(collegeWorkspace.saving).toBe(false);
    });

    it("retains the pending setup and error after a failed apply", async () => {
        db.setCollegeTabSetup.mockRejectedValueOnce(new Error("disk full"));
        const selected = setup();
        beginCollegeTabPick("doc-1", selected);

        await expect(applyCollegeToExistingTab("tab-2")).resolves.toBe(false);

        expect(collegeWorkspace.documentId).toBe("doc-1");
        expect(collegeWorkspace.setup).not.toBe(selected);
        expect(collegeWorkspace.setup?.kind).toBe(selected.kind);
        expect(collegeWorkspace.saving).toBe(false);
        expect(collegeWorkspace.error).toContain("disk full");
    });

    it("uses the state writer for the selected tab and clears after acceptance", async () => {
        const selected = setup();
        beginCollegeTabPick("doc-1", selected);

        await expect(applyCollegeToExistingTab("tab-1")).resolves.toBe(true);

        expect(db.setCollegeTabSetup).toHaveBeenCalledWith(
            "doc-1",
            "tab-1",
            JSON.stringify(selected),
        );
        expect(stopAllAi).toHaveBeenCalledOnce();
        expect(collegeWorkspace.documentId).toBeNull();
        expect(collegeWorkspace.setup).toBeNull();
        expect(collegeWorkspace.saving).toBe(false);
        expect(collegeState.setup).toEqual(selected);
    });

    it("returns false when the document changes during an apply", async () => {
        const pending = deferred<void>();
        db.setCollegeTabSetup.mockReturnValue(pending.promise);
        beginCollegeTabPick("doc-1", setup());
        const applying = applyCollegeToExistingTab("tab-2");

        currentDocumentId.set("doc-2");
        pending.resolve();

        await expect(applying).resolves.toBe(false);
        expect(collegeWorkspace.setup).not.toBeNull();
        expect(collegeWorkspace.error).toBe("");
    });
});
