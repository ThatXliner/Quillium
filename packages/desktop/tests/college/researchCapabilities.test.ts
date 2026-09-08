import { researchSchool } from "$lib/ai/schoolResearch";
import { getAiAbortSignal } from "$lib/ai/settings.svelte";
import { createCollegeCapabilities } from "$lib/college/capabilities";
import {
    type CollegeReference,
    type CollegeSetup,
    collegeResearchSetupKey,
} from "$lib/college/model";
import { newCollegeSetup } from "$lib/college/presets";
import { type ResearchResult, findingKey } from "$lib/college/research";
import type { ResearchTarget } from "$lib/college/researchModel";
import type { SidebarPanelSession, SidebarPanelTarget } from "$lib/sidebar/panels";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    function store<T>(initial: T) {
        let value = initial;
        return {
            subscribe(run: (next: T) => void) {
                run(value);
                return () => undefined;
            },
            set(next: T) {
                value = next;
            },
            get() {
                return value;
            },
        };
    }

    const state = {
        target: { documentId: "document-1", tabId: "tab-1", draftId: "draft-1" },
        collegeState: {
            documentId: "document-1",
            tabId: "tab-1",
            setup: null as CollegeSetup | null,
            status: "ready" as string,
            error: "",
            saving: false,
            hostEnabled: true,
        },
        activeSetup: null as CollegeSetup | null,
        context: { freeform: "Shared notes", decisions: ["Keep the ending open."] },
        unavailable: "",
        saveCalls: [] as unknown[],
        globalController: new AbortController(),
    };

    const currentDocumentId = store<string | null>(state.target.documentId);
    const currentDocumentTitle = store("Essay");
    const currentDraftId = store<string | null>(state.target.draftId);
    const currentDraftLabel = store("First attempt");
    const currentTabId = store<string | null>(state.target.tabId);
    const currentTabLabel = store("Personal statement");
    const documentContent = store("A real draft with evidence.");
    const editorView = store<unknown>(undefined);
    const appSettings = { aiEnabled: true };
    const getActiveCollegeSetup = vi.fn(() => state.activeSetup);
    const saveCollegeSetup = vi.fn(async (...args: unknown[]) => {
        state.saveCalls.push(args[1]);
    });
    const reloadCollegeSetup = vi.fn(async () => undefined);
    const researchProviderLabel = vi.fn(() => "OpenAI");
    const researchUnavailableReason = vi.fn(() => state.unavailable);
    const researchSchool = vi.fn();
    const getAiAbortSignal = vi.fn(() => state.globalController.signal);
    const findingKey = vi.fn(
        (reference: { kind: string; url: string; summary: string }) =>
            `${reference.kind}|${reference.url}|${reference.summary}`,
    );

    function reset(): void {
        state.target = { documentId: "document-1", tabId: "tab-1", draftId: "draft-1" };
        state.collegeState.documentId = state.target.documentId;
        state.collegeState.tabId = state.target.tabId;
        state.collegeState.setup = null;
        state.collegeState.status = "ready";
        state.collegeState.error = "";
        state.collegeState.saving = false;
        state.collegeState.hostEnabled = true;
        state.activeSetup = null;
        state.context = { freeform: "Shared notes", decisions: ["Keep the ending open."] };
        state.unavailable = "";
        state.saveCalls = [];
        state.globalController = new AbortController();
        currentDocumentId.set(state.target.documentId);
        currentDocumentTitle.set("Essay");
        currentDraftId.set(state.target.draftId);
        currentDraftLabel.set("First attempt");
        currentTabId.set(state.target.tabId);
        currentTabLabel.set("Personal statement");
        documentContent.set("A real draft with evidence.");
        appSettings.aiEnabled = true;
        getActiveCollegeSetup.mockReset();
        getActiveCollegeSetup.mockImplementation(() => state.activeSetup);
        saveCollegeSetup.mockReset();
        saveCollegeSetup.mockImplementation(async (...args: unknown[]) => {
            state.saveCalls.push(args[1]);
        });
        reloadCollegeSetup.mockReset();
        reloadCollegeSetup.mockResolvedValue(undefined);
        researchProviderLabel.mockClear();
        researchUnavailableReason.mockClear();
        researchSchool.mockReset();
        getAiAbortSignal.mockClear();
        findingKey.mockClear();
    }

    return {
        state,
        stores: {
            currentDocumentId,
            currentDocumentTitle,
            currentDraftId,
            currentDraftLabel,
            currentTabId,
            currentTabLabel,
            documentContent,
            editorView,
        },
        appSettings,
        getActiveCollegeSetup,
        saveCollegeSetup,
        reloadCollegeSetup,
        researchProviderLabel,
        researchUnavailableReason,
        researchSchool,
        getAiAbortSignal,
        findingKey,
        reset,
    };
});

vi.mock("$lib/ai/settings.svelte", () => ({
    getAiAbortSignal: mocks.getAiAbortSignal,
    getEffectiveDocumentContext: vi.fn(() => mocks.state.context),
    hasApiKey: vi.fn(() => true),
}));
vi.mock("$lib/ai/schoolResearch", () => ({
    researchProviderLabel: mocks.researchProviderLabel,
    researchSchool: mocks.researchSchool,
    researchUnavailableReason: mocks.researchUnavailableReason,
}));
vi.mock("$lib/settings.svelte", () => ({ appSettings: mocks.appSettings }));
vi.mock("$lib/stores", () => mocks.stores);
vi.mock("$lib/college/state.svelte", () => ({
    collegeState: mocks.state.collegeState,
    getActiveCollegeSetup: mocks.getActiveCollegeSetup,
    reloadCollegeSetup: mocks.reloadCollegeSetup,
    saveCollegeSetup: mocks.saveCollegeSetup,
}));
vi.mock("$lib/college/research", () => ({ findingKey: mocks.findingKey }));

function targetFor(setup: CollegeSetup, overrides: Partial<ResearchTarget> = {}): ResearchTarget {
    return {
        school: setup.school,
        cycle: setup.cycle,
        program: setup.program,
        sourceUrl: "https://example.edu/admissions",
        prompts: setup.prompts.map(({ id, label, text }) => ({ id, label, text })),
        ...overrides,
    };
}

function finding(id: string, kind: CollegeReference["kind"] = "requirement"): CollegeReference {
    return {
        id,
        publisher: "Example University",
        url: `https://example.edu/research/${id}`,
        checkedDate: "2026-09-07",
        cycle: "2026",
        kind,
        summary: `Summary for ${id}`,
        research: {
            snapshotId: "research-1",
            promptIds: ["prompt-1"],
            school: "Example University",
            program: "History",
            targetCycle: "2026",
            evidence: `Evidence for ${id}`,
            setupKey: "",
        },
    };
}

function resultFor(setup: CollegeSetup, findings: CollegeReference[]): ResearchResult {
    return {
        id: "research-1",
        target: targetFor(setup),
        checkedDate: "2026-09-07",
        findings,
        warnings: [],
        pages: [{ url: "https://example.edu/admissions", title: "Admissions" }],
    };
}

function activeSetup(): CollegeSetup {
    const setup = newCollegeSetup("supplemental");
    setup.school = "Example University";
    setup.program = "History";
    setup.cycle = "2026";
    setup.prompts[0].id = "prompt-1";
    setup.prompts[0].label = "Supplement prompt";
    setup.prompts[0].text = "Describe a meaningful experience.";
    mocks.state.collegeState.setup = setup;
    mocks.state.activeSetup = setup;
    return setup;
}

function sessionFor(initialTarget = mocks.state.target): {
    session: SidebarPanelSession;
    moveTo: (next: SidebarPanelTarget) => void;
} {
    let current: SidebarPanelTarget = { ...initialTarget };
    return {
        session: {
            target: { ...initialTarget },
            signal: new AbortController().signal,
            readSelection: () => null,
            isCurrent: () =>
                current.documentId === initialTarget.documentId &&
                current.tabId === initialTarget.tabId &&
                current.draftId === initialTarget.draftId,
        },
        moveTo(next) {
            current = { ...next };
        },
    };
}

function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
} {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

beforeEach(() => mocks.reset());
afterEach(() => vi.restoreAllMocks());

describe("College school research capability", () => {
    it("exposes the provider and prerequisite status in a current snapshot", () => {
        activeSetup();
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());

        expect(capabilities.read()).toMatchObject({
            researchProvider: "OpenAI",
            researchUnavailable: "",
        });
        mocks.state.unavailable = "Connect a model before researching.";
        expect(capabilities.read().researchUnavailable).toBe("Connect a model before researching.");
    });

    it("does not save when research completes and keeps returned data independent", async () => {
        const setup = activeSetup();
        const source = finding("finding-1");
        const result = resultFor(setup, [source]);
        mocks.researchSchool.mockResolvedValue(result);
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());

        const returned = await capabilities.research(
            targetFor(setup),
            new AbortController().signal,
        );

        expect(mocks.saveCollegeSetup).not.toHaveBeenCalled();
        expect(returned).not.toBe(result);
        returned.findings[0].summary = "Forged in the panel";
        await capabilities.acceptResearch(result.id, [source.id], []);
        const saved = mocks.state.saveCalls[0] as CollegeSetup;
        expect(saved.references.find((reference) => reference.id === source.id)?.summary).toBe(
            source.summary,
        );
    });

    it.each(["tab", "setup", "AI"] as const)(
        "rejects a %s change before installing a stale research result",
        async (changed) => {
            const setup = activeSetup();
            const result = resultFor(setup, [finding("finding-1")]);
            const pending = deferred<ResearchResult>();
            mocks.researchSchool.mockReturnValue(pending.promise);
            const first = sessionFor();
            const capabilities = createCollegeCapabilities(first.session, vi.fn());
            const request = capabilities.research(targetFor(setup), new AbortController().signal);

            if (changed === "tab") {
                first.moveTo({ ...mocks.state.target, tabId: "tab-2" });
            } else if (changed === "setup") {
                setup.feedbackFocus = "Changed while research was running.";
            } else {
                mocks.appSettings.aiEnabled = false;
            }
            pending.resolve(result);

            await expect(request).rejects.toThrow(/stale/i);
            expect(mocks.saveCollegeSetup).not.toHaveBeenCalled();
        },
    );

    it.each(["tab", "setup", "AI"] as const)(
        "rejects applying a result after a %s change",
        async (changed) => {
            const setup = activeSetup();
            const result = resultFor(setup, [finding("finding-1")]);
            mocks.researchSchool.mockResolvedValue(result);
            const first = sessionFor();
            const capabilities = createCollegeCapabilities(first.session, vi.fn());
            await capabilities.research(targetFor(setup), new AbortController().signal);

            if (changed === "tab") {
                first.moveTo({ ...mocks.state.target, tabId: "tab-2" });
            } else if (changed === "setup") {
                setup.feedbackFocus = "Changed after research.";
            } else {
                mocks.appSettings.aiEnabled = false;
            }

            await expect(capabilities.acceptResearch(result.id, ["finding-1"], [])).rejects.toThrow(
                /stale/i,
            );
            expect(mocks.saveCollegeSetup).not.toHaveBeenCalled();
        },
    );

    it("accepts only checked findings, retains rejected keys, and leaves notes and bundled sources alone", async () => {
        const setup = activeSetup();
        const notes = { intent: setup.intent, feedbackFocus: setup.feedbackFocus };
        const oldResearch = finding("saved-research");
        setup.references.push(oldResearch);
        const selected = finding("selected");
        const rejected = finding("rejected", "official-advice");
        const result = resultFor(setup, [selected, rejected]);
        mocks.researchSchool.mockResolvedValue(result);
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());

        await capabilities.research(targetFor(setup), new AbortController().signal);
        await capabilities.acceptResearch(result.id, [selected.id], []);

        const saved = mocks.state.saveCalls[0] as CollegeSetup;
        expect(saved.intent).toBe(notes.intent);
        expect(saved.feedbackFocus).toBe(notes.feedbackFocus);
        expect(saved.references.some((reference) => reference.id === selected.id)).toBe(true);
        expect(saved.references.some((reference) => reference.id === rejected.id)).toBe(false);
        expect(saved.references.some((reference) => reference.id === oldResearch.id)).toBe(true);
        expect(
            saved.references.some((reference) => reference.id === "quillium-guidance-supplemental"),
        ).toBe(true);
        expect(
            saved.references.find((reference) => reference.id === selected.id)?.research?.setupKey,
        ).toBe(collegeResearchSetupKey(setup));
        expect(saved.researchReview).toEqual({
            target: result.target,
            checkedDate: result.checkedDate,
            rejectedKeys: [findingKey(rejected)],
        });
    });

    it("adds a current-scope finding even when an older research snapshot has the same key", async () => {
        const setup = activeSetup();
        const current = finding("current");
        const old = {
            ...current,
            id: "old-snapshot",
            research: { ...current.research!, setupKey: "older-setup" },
        };
        setup.references.push(old);
        const result = resultFor(setup, [current]);
        mocks.researchSchool.mockResolvedValue(result);
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());

        await capabilities.research(targetFor(setup), new AbortController().signal);
        await capabilities.acceptResearch(result.id, [current.id], []);

        const saved = mocks.state.saveCalls[0] as CollegeSetup;
        expect(
            saved.references.filter((reference) => findingKey(reference) === findingKey(current)),
        ).toHaveLength(2);
        expect(
            saved.references.find((reference) => reference.id === current.id)?.research?.setupKey,
        ).toBe(collegeResearchSetupKey(setup));
    });

    it("preserves earlier rejected keys across a partial refresh and drops selected keys", async () => {
        const setup = activeSetup();
        const earlierRejected = finding("earlier-rejected");
        const selectedLater = finding("selected-later");
        const firstResult = resultFor(setup, [earlierRejected, selectedLater]);
        mocks.researchSchool.mockResolvedValueOnce(firstResult);
        const first = sessionFor();
        const capabilities = createCollegeCapabilities(first.session, vi.fn());
        await capabilities.research(targetFor(setup), new AbortController().signal);
        await capabilities.acceptResearch(firstResult.id, [], []);
        const firstSaved = mocks.state.saveCalls[0] as CollegeSetup;
        mocks.state.activeSetup = firstSaved;
        mocks.state.collegeState.setup = firstSaved;

        const secondResult = resultFor(firstSaved, [selectedLater]);
        secondResult.id = "research-2";
        mocks.researchSchool.mockResolvedValueOnce(secondResult);
        await capabilities.research(targetFor(firstSaved), new AbortController().signal);
        await capabilities.acceptResearch(secondResult.id, [selectedLater.id], []);
        const secondSaved = mocks.state.saveCalls[1] as CollegeSetup;

        expect(secondSaved.researchReview?.rejectedKeys).toEqual([findingKey(earlierRejected)]);

        const thirdRejected = finding("third-rejected");
        const thirdResult = resultFor(secondSaved, [thirdRejected]);
        thirdResult.id = "research-3";
        mocks.state.activeSetup = secondSaved;
        mocks.state.collegeState.setup = secondSaved;
        mocks.researchSchool.mockResolvedValueOnce(thirdResult);
        await capabilities.research(targetFor(secondSaved), new AbortController().signal);
        await capabilities.acceptResearch(thirdResult.id, [], []);
        const thirdSaved = mocks.state.saveCalls[2] as CollegeSetup;
        expect(thirdSaved.researchReview?.rejectedKeys).toEqual([
            findingKey(earlierRejected),
            findingKey(thirdRejected),
        ]);
    });

    it("allows removal only for saved research references", async () => {
        const setup = activeSetup();
        const oldResearch = finding("saved-research");
        setup.references.push(oldResearch);
        const result = resultFor(setup, [finding("new-finding")]);
        mocks.researchSchool.mockResolvedValue(result);
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());
        await capabilities.research(targetFor(setup), new AbortController().signal);

        const bundled = setup.references.find(
            (reference) => reference.id === "quillium-guidance-supplemental",
        );
        await expect(capabilities.acceptResearch(result.id, [], [bundled!.id])).rejects.toThrow(
            /saved research/i,
        );
        expect(mocks.saveCollegeSetup).not.toHaveBeenCalled();

        await capabilities.acceptResearch(result.id, [], [oldResearch.id]);
        const saved = mocks.state.saveCalls[0] as CollegeSetup;
        expect(saved.references.some((reference) => reference.id === oldResearch.id)).toBe(false);
        expect(saved.references.some((reference) => reference.id === bundled!.id)).toBe(true);
    });

    it("rejects an over-capacity review before saving", async () => {
        const setup = activeSetup();
        setup.references = Array.from({ length: 12 }, (_, index) => ({
            ...finding(`existing-${index}`),
            id: `existing-${index}`,
            url: `https://example.edu/existing/${index}`,
            research: index === 0 ? finding(`existing-${index}`).research : undefined,
        }));
        const result = resultFor(setup, [finding("new-finding")]);
        mocks.researchSchool.mockResolvedValue(result);
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());
        await capabilities.research(targetFor(setup), new AbortController().signal);

        await expect(capabilities.acceptResearch(result.id, ["new-finding"], [])).rejects.toThrow(
            /remove existing sources/i,
        );
        expect(mocks.saveCollegeSetup).not.toHaveBeenCalled();
    });

    it("retains a result when saving fails so the review can be retried", async () => {
        const setup = activeSetup();
        const source = finding("finding-1");
        const result = resultFor(setup, [source]);
        mocks.researchSchool.mockResolvedValue(result);
        mocks.saveCollegeSetup.mockRejectedValueOnce(new Error("disk full"));
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());
        await capabilities.research(targetFor(setup), new AbortController().signal);

        await expect(capabilities.acceptResearch(result.id, [source.id], [])).rejects.toThrow(
            /disk full/i,
        );
        await expect(
            capabilities.acceptResearch(result.id, [source.id], []),
        ).resolves.toBeUndefined();
        expect(mocks.saveCollegeSetup).toHaveBeenCalledTimes(2);
    });

    it("rejects unknown target fields and prompts that no longer match setup", async () => {
        const setup = activeSetup();
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());
        const unknownField = { ...targetFor(setup), unexpected: true } as ResearchTarget;

        await expect(
            capabilities.research(unknownField, new AbortController().signal),
        ).rejects.toThrow(/unrecognized|invalid/i);
        await expect(
            capabilities.research(
                targetFor(setup, {
                    prompts: [{ ...targetFor(setup).prompts[0], text: "Changed prompt" }],
                }),
                new AbortController().signal,
            ),
        ).rejects.toThrow(/prompts changed/i);
        expect(researchSchool).not.toHaveBeenCalled();
    });

    it("links caller, session, and global cancellation to the host request", async () => {
        const setup = activeSetup();
        const result = resultFor(setup, [finding("finding-1")]);
        const pending = deferred<ResearchResult>();
        mocks.researchSchool.mockImplementation((_target: ResearchTarget, signal: AbortSignal) => {
            signal.addEventListener("abort", () => pending.reject(new Error("aborted")), {
                once: true,
            });
            return pending.promise;
        });
        const caller = new AbortController();
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());
        const request = capabilities.research(targetFor(setup), caller.signal);
        caller.abort();

        await expect(request).rejects.toThrow(/aborted|cancelled/i);
        expect(mocks.saveCollegeSetup).not.toHaveBeenCalled();
        expect(result).toBeDefined();
        expect(getAiAbortSignal).toHaveBeenCalled();
    });

    it("invalidates a completed result when global AI cancellation fires", async () => {
        const setup = activeSetup();
        const source = finding("finding-1");
        mocks.researchSchool.mockResolvedValue(resultFor(setup, [source]));
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());
        await capabilities.research(targetFor(setup), new AbortController().signal);

        mocks.state.globalController.abort();
        await expect(capabilities.acceptResearch("research-1", [source.id], [])).rejects.toThrow(
            /stale/i,
        );
        expect(mocks.saveCollegeSetup).not.toHaveBeenCalled();
    });
});
