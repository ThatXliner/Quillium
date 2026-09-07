import {
    collegeState,
    getActiveCollegeSetup,
    saveCollegeSetup,
    updateActiveCollegeSetup,
} from "$lib/college/state.svelte";
import { currentDocumentId, currentTabId } from "$lib/stores";
import { cleanup, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CollegeEffectsHarness from "./CollegeEffectsHarness.svelte";

const db = vi.hoisted(() => ({
    getCollegeTabSetup: vi.fn(),
    setCollegeTabSetup: vi.fn(),
}));

vi.mock("$lib/db", () => db);

function setup() {
    return {
        version: 1 as const,
        presetVersion: 1 as const,
        kind: "supplemental" as const,
        cycle: "2026",
        school: "Example University",
        program: "History",
        intent: "Tell a concrete story.",
        feedbackFocus: "Specificity.",
        prompts: [
            {
                id: "prompt-1",
                label: "Supplement",
                text: "Describe a meaningful experience.",
                sourceUrl: "",
                constraints: [],
            },
        ],
        preferences: {
            stance: "author-first" as const,
            feedbackDensity: "focused" as const,
            voiceLatitude: "preserve" as const,
        },
        readers: [],
        feedbackReaders: false,
        reviseReaders: false,
        active: true,
        references: [],
    };
}

describe("College setup state", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        currentDocumentId.set("doc-1");
        currentTabId.set("tab-1");
        collegeState.documentId = "doc-1";
        collegeState.tabId = "tab-1";
        collegeState.setup = setup();
        collegeState.status = "ready";
        collegeState.error = "";
        collegeState.saving = false;
        collegeState.hostEnabled = true;
        db.getCollegeTabSetup.mockResolvedValue(JSON.stringify(setup()));
        db.setCollegeTabSetup.mockResolvedValue(undefined);
    });

    afterEach(() => {
        cleanup();
        currentDocumentId.set(null);
        currentTabId.set(null);
    });

    it("keeps the previous accepted setup when a write fails", async () => {
        const previous = getActiveCollegeSetup();
        db.setCollegeTabSetup.mockRejectedValueOnce(new Error("disk full"));

        await expect(
            saveCollegeSetup(
                { documentId: "doc-1", tabId: "tab-1" },
                {
                    ...setup(),
                    intent: "New intent",
                },
            ),
        ).rejects.toThrow("disk full");

        expect(collegeState.status).toBe("ready");
        expect(collegeState.error).toContain("disk full");
        expect(getActiveCollegeSetup()).toEqual(previous);
    });

    it("rejects a save whose target no longer matches the stores", async () => {
        currentTabId.set("tab-2");
        await expect(
            saveCollegeSetup({ documentId: "doc-1", tabId: "tab-1" }, setup()),
        ).rejects.toThrow(/target changed/i);
        expect(db.setCollegeTabSetup).not.toHaveBeenCalled();
    });

    it("allows explicit removal of an unsupported saved setup", async () => {
        collegeState.setup = null;
        collegeState.status = "unsupported";
        collegeState.error = "unsupported version";

        await saveCollegeSetup({ documentId: "doc-1", tabId: "tab-1" }, null);

        expect(db.setCollegeTabSetup).toHaveBeenCalledWith("doc-1", "tab-1", null);
        expect(collegeState.status).toBe("ready");
        expect(collegeState.setup).toBeNull();
    });

    it("invokes the host cancellation callback before a setup save", async () => {
        const onChange = vi.fn();
        render(CollegeEffectsHarness, { props: { onChange } });
        await waitFor(() => expect(collegeState.status).toBe("ready"));

        await saveCollegeSetup(
            { documentId: "doc-1", tabId: "tab-1" },
            { ...setup(), intent: "Cancel in-flight work before saving." },
        );

        expect(onChange).toHaveBeenCalledOnce();
    });

    it("waits for a pending write before reloading after leaving and returning to a tab", async () => {
        let persisted = JSON.stringify(setup());
        let releaseWrite!: () => void;
        db.getCollegeTabSetup.mockImplementation(async (documentId: string) => {
            return documentId === "doc-1" ? persisted : null;
        });
        db.setCollegeTabSetup.mockImplementation(
            async (_documentId: string, _tabId: string, json: string | null) => {
                await new Promise<void>((resolve) => {
                    releaseWrite = () => {
                        if (json !== null) persisted = json;
                        resolve();
                    };
                });
            },
        );

        render(CollegeEffectsHarness);
        await waitFor(() => expect(collegeState.status).toBe("ready"));

        const saving = saveCollegeSetup(
            { documentId: "doc-1", tabId: "tab-1" },
            { ...setup(), intent: "Saved after returning to the tab." },
        );
        await waitFor(() => expect(db.setCollegeTabSetup).toHaveBeenCalledOnce());

        currentDocumentId.set("doc-2");
        currentTabId.set("tab-2");
        currentDocumentId.set("doc-1");
        currentTabId.set("tab-1");

        await waitFor(() => {
            expect(collegeState.documentId).toBe("doc-1");
            expect(collegeState.tabId).toBe("tab-1");
            expect(collegeState.status).toBe("loading");
        });
        expect(
            db.getCollegeTabSetup.mock.calls.filter(
                ([documentId, tabId]) => documentId === "doc-1" && tabId === "tab-1",
            ),
        ).toHaveLength(1);

        releaseWrite();
        await expect(saving).resolves.toBeUndefined();
        await waitFor(() => {
            expect(collegeState.status).toBe("ready");
            expect(collegeState.setup?.intent).toBe("Saved after returning to the tab.");
        });
    });

    it("discards a late load from the previous tab", async () => {
        let releaseFirstLoad!: (value: string) => void;
        db.getCollegeTabSetup.mockImplementation(async (documentId: string) => {
            if (documentId === "doc-1") {
                return new Promise<string>((resolve) => {
                    releaseFirstLoad = resolve;
                });
            }
            return null;
        });

        render(CollegeEffectsHarness);
        await waitFor(() => expect(collegeState.status).toBe("loading"));

        currentDocumentId.set("doc-2");
        currentTabId.set("tab-2");
        await waitFor(() => {
            expect(collegeState.documentId).toBe("doc-2");
            expect(collegeState.tabId).toBe("tab-2");
            expect(collegeState.status).toBe("ready");
        });

        releaseFirstLoad(JSON.stringify({ ...setup(), school: "Stale University" }));
        await Promise.resolve();
        expect(collegeState.documentId).toBe("doc-2");
        expect(collegeState.tabId).toBe("tab-2");
        expect(collegeState.setup).toBeNull();
    });

    it("keeps the persisted setup after a failed write while away and back", async () => {
        let releaseWrite!: (error?: Error) => void;
        const original = JSON.stringify(setup());
        db.getCollegeTabSetup.mockResolvedValue(original);
        db.setCollegeTabSetup.mockImplementation(
            async () =>
                await new Promise<void>((_resolve, reject) => {
                    releaseWrite = (error = new Error("disk full")) => reject(error);
                }),
        );

        render(CollegeEffectsHarness);
        await waitFor(() => expect(collegeState.status).toBe("ready"));
        const saving = saveCollegeSetup(
            { documentId: "doc-1", tabId: "tab-1" },
            { ...setup(), intent: "This write will fail." },
        );
        await waitFor(() => expect(db.setCollegeTabSetup).toHaveBeenCalledOnce());

        currentDocumentId.set("doc-2");
        currentTabId.set("tab-2");
        currentDocumentId.set("doc-1");
        currentTabId.set("tab-1");
        await waitFor(() => expect(collegeState.status).toBe("loading"));

        releaseWrite();
        await expect(saving).rejects.toThrow("disk full");
        await waitFor(() => {
            expect(collegeState.status).toBe("ready");
            expect(collegeState.setup?.intent).toBe(setup().intent);
        });
    });

    it("does not report a stale settings write failure in the new tab", async () => {
        let releaseWrite!: (error?: Error) => void;
        db.getCollegeTabSetup.mockImplementation(async (documentId: string) => {
            return documentId === "doc-1" ? JSON.stringify(setup()) : null;
        });
        db.setCollegeTabSetup.mockImplementation(
            async () =>
                await new Promise<void>((_resolve, reject) => {
                    releaseWrite = (error = new Error("old tab write failed")) => reject(error);
                }),
        );

        render(CollegeEffectsHarness);
        await waitFor(() => expect(collegeState.status).toBe("ready"));
        const update = updateActiveCollegeSetup({ intent: "Obsolete after switching." });
        await waitFor(() => expect(db.setCollegeTabSetup).toHaveBeenCalledOnce());

        currentDocumentId.set("doc-2");
        currentTabId.set("tab-2");
        await waitFor(() => {
            expect(collegeState.documentId).toBe("doc-2");
            expect(collegeState.tabId).toBe("tab-2");
            expect(collegeState.status).toBe("ready");
        });

        releaseWrite();
        await expect(update).resolves.toBeUndefined();
        expect(collegeState.error).toBe("");
    });
});
