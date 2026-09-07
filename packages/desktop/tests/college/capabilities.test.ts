import { createCollegeCapabilities } from "$lib/college/capabilities";
import { newCollegeSetup } from "$lib/college/presets";
import type { SidebarPanelSession, SidebarPanelTarget } from "$lib/sidebar/panels";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    function store<T>(initial: T) {
        let value = initial;
        const listeners = new Set<(next: T) => void>();
        return {
            subscribe(run: (next: T) => void) {
                run(value);
                listeners.add(run);
                return () => listeners.delete(run);
            },
            set(next: T) {
                value = next;
                for (const listener of listeners) listener(value);
            },
        };
    }

    const state = {
        target: { documentId: "document-1", tabId: "tab-1", draftId: "draft-1" },
        collegeState: {
            documentId: "document-1",
            tabId: "tab-1",
            setup: null as ReturnType<typeof newCollegeSetup> | null,
            status: "ready" as string,
            error: "",
            saving: false,
            hostEnabled: true,
        },
        activeSetup: null as ReturnType<typeof newCollegeSetup> | null,
        context: { freeform: "Shared notes", decisions: ["Keep the ending open."] },
        credentials: true,
        saveArgs: null as unknown[] | null,
    };

    const currentDocumentId = store<string | null>(state.target.documentId);
    const currentDocumentTitle = store("Essay");
    const currentDraftId = store<string | null>(state.target.draftId);
    const currentDraftLabel = store("First attempt");
    const currentTabId = store<string | null>(state.target.tabId);
    const currentTabLabel = store("Personal statement");
    const documentContent = store("A real draft with evidence.");
    const appSettings = { aiEnabled: true };
    const hasApiKey = vi.fn(() => state.credentials);
    const ensureApiKeyLoaded = vi.fn();
    const getActiveCollegeSetup = vi.fn(() => state.activeSetup);
    const saveCollegeSetup = vi.fn(async (...args: unknown[]) => {
        state.saveArgs = args;
    });
    const reloadCollegeSetup = vi.fn(async () => undefined);
    const appEventBus = { emit: vi.fn() };

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
        state.credentials = true;
        state.saveArgs = null;
        currentDocumentId.set(state.target.documentId);
        currentDocumentTitle.set("Essay");
        currentDraftId.set(state.target.draftId);
        currentDraftLabel.set("First attempt");
        currentTabId.set(state.target.tabId);
        currentTabLabel.set("Personal statement");
        documentContent.set("A real draft with evidence.");
        appSettings.aiEnabled = true;
        hasApiKey.mockClear();
        ensureApiKeyLoaded.mockClear();
        getActiveCollegeSetup.mockClear();
        saveCollegeSetup.mockClear();
        reloadCollegeSetup.mockClear();
        appEventBus.emit.mockClear();
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
        },
        appSettings,
        hasApiKey,
        ensureApiKeyLoaded,
        getActiveCollegeSetup,
        saveCollegeSetup,
        reloadCollegeSetup,
        appEventBus,
        reset,
    };
});

vi.mock("$lib/ai/settings.svelte", () => ({
    getEffectiveDocumentContext: vi.fn(() => mocks.state.context),
    hasApiKey: mocks.hasApiKey,
    ensureApiKeyLoaded: mocks.ensureApiKeyLoaded,
}));
vi.mock("$lib/settings.svelte", () => ({ appSettings: mocks.appSettings }));
vi.mock("$lib/stores", () => mocks.stores);
vi.mock("$lib/college/state.svelte", () => ({
    collegeState: mocks.state.collegeState,
    getActiveCollegeSetup: mocks.getActiveCollegeSetup,
    reloadCollegeSetup: mocks.reloadCollegeSetup,
    saveCollegeSetup: mocks.saveCollegeSetup,
}));
vi.mock("$lib/events/appEventBus", () => ({ appEventBus: mocks.appEventBus }));

function target(overrides: Partial<SidebarPanelTarget> = {}): SidebarPanelTarget {
    return { ...mocks.state.target, ...overrides };
}

function sessionFor(initialTarget = target()): {
    session: SidebarPanelSession;
    moveTo: (next: SidebarPanelTarget) => void;
} {
    let current = { ...initialTarget };
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
        moveTo: (next) => {
            current = { ...next };
        },
    };
}

function activeSetup(): ReturnType<typeof newCollegeSetup> {
    const setup = newCollegeSetup("uc-piq");
    mocks.state.collegeState.setup = setup;
    mocks.state.activeSetup = setup;
    return setup;
}

beforeEach(() => mocks.reset());
afterEach(() => vi.restoreAllMocks());

describe("createCollegeCapabilities", () => {
    it("reads target labels/context and returns a cloned setup without loading credentials", () => {
        const setup = activeSetup();
        setup.school = "Example University";
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());

        const snapshot = capabilities.read();

        expect(snapshot).toMatchObject({
            documentId: "document-1",
            tabId: "tab-1",
            documentLabel: "Essay",
            tabLabel: "Personal statement",
            draftLabel: "First attempt",
            sharedBrief: "Shared notes",
            decisions: ["Keep the ending open."],
            hasProse: true,
            canRequest: true,
            aiEnabled: true,
            requestCount: 1,
        });
        expect(snapshot.setup).not.toBe(setup);
        snapshot.setup!.school = "Changed only in the snapshot";
        expect(setup.school).toBe("Example University");
        expect(mocks.ensureApiKeyLoaded).not.toHaveBeenCalled();
    });

    it("keeps request availability false while loading or saving", () => {
        activeSetup();
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());

        mocks.state.collegeState.status = "loading";
        expect(capabilities.read().canRequest).toBe(false);
        mocks.state.collegeState.status = "ready";
        mocks.state.collegeState.saving = true;
        expect(capabilities.read().canRequest).toBe(false);
    });

    it("counts one feedback request unless enabled tab readers are explicitly active", () => {
        const setup = activeSetup();
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());

        expect(capabilities.read().requestCount).toBe(1);
        setup.feedbackReaders = true;
        setup.readers[1].enabled = true;
        setup.readers[2].enabled = true;
        expect(capabilities.read().requestCount).toBe(3);
        for (const reader of setup.readers) reader.enabled = false;
        expect(capabilities.read().requestCount).toBe(1);
    });

    it("passes the captured document/tab target to saves and rejects stale saves", async () => {
        const setup = activeSetup();
        const first = sessionFor();
        const capabilities = createCollegeCapabilities(first.session, vi.fn());

        await capabilities.save(setup);

        expect(mocks.saveCollegeSetup).toHaveBeenCalledWith(
            { documentId: "document-1", tabId: "tab-1" },
            setup,
        );
        first.moveTo(target({ documentId: "document-2" }));
        await expect(capabilities.save(setup)).rejects.toThrow(/stale/i);
        expect(mocks.saveCollegeSetup).toHaveBeenCalledTimes(1);
    });

    it("keeps local read, save, and panel navigation credential-free", async () => {
        const setup = activeSetup();
        const openPanel = vi.fn();
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, openPanel);

        capabilities.read();
        await capabilities.save(setup);
        capabilities.openPanel("context");

        expect(openPanel).toHaveBeenCalledWith("context");
        expect(mocks.ensureApiKeyLoaded).not.toHaveBeenCalled();
    });

    it("rejects stale open and action capabilities", () => {
        activeSetup();
        const first = sessionFor();
        const openPanel = vi.fn();
        const capabilities = createCollegeCapabilities(first.session, openPanel);
        first.moveTo(target({ tabId: "tab-2" }));

        expect(() => capabilities.openPanel("context")).toThrow(/stale/i);
        expect(() => capabilities.request("plan")).toThrow(/stale/i);
        expect(openPanel).not.toHaveBeenCalled();
        expect(mocks.appEventBus.emit).not.toHaveBeenCalled();
    });

    it("returns a neutral stale snapshot instead of another tab's setup/context", () => {
        const setup = activeSetup();
        const first = sessionFor();
        const capabilities = createCollegeCapabilities(first.session, vi.fn());
        first.moveTo(target({ documentId: "document-2", tabId: "tab-2", draftId: "draft-2" }));
        mocks.state.collegeState.documentId = "document-2";
        mocks.state.collegeState.tabId = "tab-2";
        mocks.state.collegeState.setup = newCollegeSetup("common-app");
        mocks.state.context = { freeform: "Other tab notes", decisions: ["Other decision"] };

        const snapshot = capabilities.read();

        expect(snapshot.setup).toBeNull();
        expect(snapshot.sharedBrief).toBe("");
        expect(snapshot.decisions).toEqual([]);
        expect(snapshot.hasProse).toBe(false);
        expect(snapshot.canRequest).toBe(false);
        expect(snapshot.aiEnabled).toBe(false);
        expect(snapshot.setup).not.toBe(setup);
    });

    it("rejects empty-prose feedback but permits planning, emitting once after navigation invalidates the session", () => {
        activeSetup();
        const first = sessionFor();
        const openPanel = vi.fn(() => first.moveTo(target({ draftId: "draft-2" })));
        const capabilities = createCollegeCapabilities(first.session, openPanel);
        mocks.stores.documentContent.set("   ");

        expect(() => capabilities.request("prompt-fit")).toThrow(/draft text/i);
        expect(openPanel).not.toHaveBeenCalled();
        expect(mocks.appEventBus.emit).not.toHaveBeenCalled();

        // Recreate a current session for the allowed empty-draft planning action.
        const second = sessionFor();
        const secondOpenPanel = vi.fn(() => second.moveTo(target({ draftId: "draft-2" })));
        const planning = createCollegeCapabilities(second.session, secondOpenPanel);
        planning.request("plan");

        expect(secondOpenPanel).toHaveBeenCalledWith("chat");
        expect(mocks.appEventBus.emit).toHaveBeenCalledTimes(1);
        expect(mocks.appEventBus.emit).toHaveBeenCalledWith({
            type: "college-action",
            action: "plan",
            target: { documentId: "document-1", tabId: "tab-1", draftId: "draft-1" },
        });
    });

    it.each([
        [
            "paused",
            () => {
                const setup = activeSetup();
                setup.active = false;
                mocks.state.activeSetup = null;
            },
        ],
        [
            "disabled",
            () => {
                activeSetup();
                mocks.state.collegeState.hostEnabled = false;
            },
        ],
        [
            "unsupported",
            () => {
                mocks.state.collegeState.status = "unsupported";
                mocks.state.collegeState.error = "Unsupported saved setup";
                mocks.state.activeSetup = null;
            },
        ],
    ] as const)("blocks %s setups from requesting actions", (_label, arrange) => {
        arrange();
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());

        expect(() => capabilities.request("plan")).toThrow();
        expect(mocks.appEventBus.emit).not.toHaveBeenCalled();
    });
});
