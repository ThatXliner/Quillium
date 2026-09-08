import { createCollegeCapabilities } from "$lib/college/capabilities";
import { newCollegeSetup } from "$lib/college/presets";
import { formatCollegePromptHeading } from "$lib/college/sections";
import type { TabMeta } from "$lib/db/types";
import type { SidebarPanelSession, SidebarPanelTarget } from "$lib/sidebar/panels";
import { history, redo, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
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
    const editorView = store<EditorView | undefined>(undefined);
    const appSettings = { aiEnabled: true };
    const hasApiKey = vi.fn(() => state.credentials);
    const ensureApiKeyLoaded = vi.fn();
    const getActiveCollegeSetup = vi.fn(() => state.activeSetup);
    const saveCollegeSetup = vi.fn(async (...args: unknown[]) => {
        state.saveArgs = args;
    });
    const reloadCollegeSetup = vi.fn(async () => undefined);
    const createCollegeTabs = vi.fn(async (): Promise<TabMeta[]> => []);
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
        editorView.set(undefined);
        appSettings.aiEnabled = true;
        hasApiKey.mockClear();
        ensureApiKeyLoaded.mockClear();
        getActiveCollegeSetup.mockClear();
        saveCollegeSetup.mockReset();
        saveCollegeSetup.mockImplementation(async (...args: unknown[]) => {
            state.saveArgs = args;
        });
        reloadCollegeSetup.mockClear();
        createCollegeTabs.mockClear();
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
            editorView,
        },
        appSettings,
        hasApiKey,
        ensureApiKeyLoaded,
        getActiveCollegeSetup,
        saveCollegeSetup,
        reloadCollegeSetup,
        createCollegeTabs,
        appEventBus,
        reset,
    };
});

vi.mock("$lib/ai/settings.svelte", () => ({
    getEffectiveDocumentContext: vi.fn(() => mocks.state.context),
    hasApiKey: mocks.hasApiKey,
    ensureApiKeyLoaded: mocks.ensureApiKeyLoaded,
    getAiAbortSignal: vi.fn(() => new AbortController().signal),
}));
vi.mock("$lib/ai/schoolResearch", () => ({
    researchProviderLabel: vi.fn(() => "OpenAI"),
    researchUnavailableReason: vi.fn(() => ""),
    researchSchool: vi.fn(),
}));
vi.mock("$lib/db", () => ({ createCollegeTabs: mocks.createCollegeTabs }));
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

function createdTab(id = "tab-created"): TabMeta {
    return {
        id,
        documentId: "document-1",
        tabType: "draft",
        label: "Leadership",
        position: 1,
        createdAt: 1,
    };
}

function addedPrompt(text = "Describe another important experience.") {
    return {
        id: "provided-id-is-replaced",
        label: "Another prompt",
        text,
        sourceUrl: "",
        constraints: [],
    };
}

function deferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
} {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

let generatedPromptId = 0;
beforeEach(() => {
    mocks.reset();
    vi.stubGlobal("crypto", {
        ...globalThis.crypto,
        randomUUID: () =>
            `00000000-0000-4000-8000-${(++generatedPromptId).toString(16).padStart(12, "0")}`,
    });
});
const liveViews: EditorView[] = [];
afterEach(() => {
    for (const view of liveViews) {
        view.destroy();
        view.dom.parentElement?.remove();
    }
    liveViews.length = 0;
    mocks.stores.editorView.set(undefined);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function createEditorView(doc: string, readOnly = false): EditorView {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
        state: EditorState.create({
            doc,
            extensions: [history(), ...(readOnly ? [EditorState.readOnly.of(true)] : [])],
        }),
        parent,
    });
    liveViews.push(view);
    mocks.stores.editorView.set(view);
    return view;
}

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
            wordCount: 5,
            characterCount: Array.from("A real draft with evidence.").length,
            canRequest: true,
            aiEnabled: true,
            requestCount: 1,
        });
        expect(snapshot.setup).not.toBe(setup);
        snapshot.setup!.school = "Changed only in the snapshot";
        expect(setup.school).toBe("Example University");
        expect(mocks.ensureApiKeyLoaded).not.toHaveBeenCalled();
    });

    it("creates validated single-prompt tabs and emits an event for the original session", async () => {
        const setup = activeSetup();
        mocks.createCollegeTabs.mockResolvedValue([createdTab()]);
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());

        await capabilities.createTabs([setup]);

        expect(mocks.createCollegeTabs).toHaveBeenCalledWith("document-1", [
            expect.objectContaining({
                label: "PIQ 1 · Leadership",
                initialContent: `${formatCollegePromptHeading(setup.prompts[0])}\n\n`,
            }),
        ]);
        const calls = mocks.createCollegeTabs.mock.calls as unknown as Array<
            [string, Array<{ setupJson: string }>]
        >;
        const payload = calls[0]?.[1]?.[0];
        if (!payload) throw new Error("createCollegeTabs did not receive a payload");
        expect(JSON.parse(payload.setupJson)).toEqual({ ...setup, sectionMode: true });
        expect(mocks.appEventBus.emit).toHaveBeenCalledWith({
            type: "college-tabs-created",
            documentId: "document-1",
            tabs: [createdTab()],
            selectFirst: true,
        });
    });

    it("merges a same-document late result without selecting after the session changes", async () => {
        const setup = activeSetup();
        let resolve!: (tabs: TabMeta[]) => void;
        mocks.createCollegeTabs.mockReturnValue(
            new Promise<TabMeta[]>((done) => {
                resolve = done;
            }),
        );
        const sessionHandle = sessionFor();
        const capabilities = createCollegeCapabilities(sessionHandle.session, vi.fn());
        const request = capabilities.createTabs([setup]);

        await vi.waitFor(() => expect(mocks.createCollegeTabs).toHaveBeenCalledOnce());
        sessionHandle.moveTo(target({ tabId: "tab-other" }));
        resolve([createdTab("tab-late")]);
        await request;

        expect(mocks.appEventBus.emit).toHaveBeenCalledWith({
            type: "college-tabs-created",
            documentId: "document-1",
            tabs: [createdTab("tab-late")],
            selectFirst: false,
        });
    });

    it("rejects multi-prompt or oversized tab creation before IPC", async () => {
        const setup = activeSetup();
        const multi = {
            ...setup,
            prompts: [
                setup.prompts[0],
                { ...setup.prompts[0], id: "second-prompt", label: "Second" },
            ],
        };
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());

        await expect(capabilities.createTabs([multi])).rejects.toThrow(/exactly one prompt/i);
        await expect(
            capabilities.createTabs(Array.from({ length: 13 }, () => setup)),
        ).rejects.toThrow(/between 1 and 12/i);
        expect(mocks.createCollegeTabs).not.toHaveBeenCalled();
    });

    it("guards repeated create requests", async () => {
        const setup = activeSetup();
        let resolve!: (tabs: TabMeta[]) => void;
        mocks.createCollegeTabs.mockReturnValue(
            new Promise<TabMeta[]>((done) => {
                resolve = done;
            }),
        );
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());
        const first = capabilities.createTabs([setup]);

        await vi.waitFor(() => expect(mocks.createCollegeTabs).toHaveBeenCalledOnce());
        await expect(capabilities.createTabs([setup])).rejects.toThrow(/already being created/i);
        resolve([createdTab()]);
        await first;
    });

    it("adds a legacy prompt and answer heading in one undoable CodeMirror transaction", async () => {
        const setup = activeSetup();
        const prose = "Existing answer.";
        const view = createEditorView(prose);
        mocks.stores.documentContent.set(prose);
        mocks.saveCollegeSetup.mockImplementation(async (...args: unknown[]) => {
            const saved = args[1] as ReturnType<typeof newCollegeSetup>;
            mocks.state.saveArgs = args;
            mocks.state.collegeState.setup = saved;
            mocks.state.activeSetup = saved;
        });
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());

        await capabilities.addPrompt(addedPrompt());

        const addedHeading = "# Describe another important experience.";
        const originalHeading = `${formatCollegePromptHeading(setup.prompts[0])}`;
        const expected = `${originalHeading}\n\n${prose}\n\n${addedHeading}\n\n`;
        expect(view.state.doc.toString()).toBe(expected);
        expect(view.state.selection.main.from).toBe(expected.length);
        expect(mocks.saveCollegeSetup).toHaveBeenCalledOnce();
        expect((mocks.state.saveArgs?.[1] as ReturnType<typeof newCollegeSetup>).sectionMode).toBe(
            true,
        );
        expect(
            (mocks.state.saveArgs?.[1] as ReturnType<typeof newCollegeSetup>).prompts,
        ).toHaveLength(2);

        expect(undo(view)).toBe(true);
        expect(view.state.doc.toString()).toBe(prose);
        expect(redo(view)).toBe(true);
        expect(view.state.doc.toString()).toBe(expected);
    });

    it("appends only the requested heading when section mode has no headings left", async () => {
        const setup = activeSetup();
        setup.sectionMode = true;
        const prose = "Answer after the original heading was removed.";
        const view = createEditorView(prose);
        mocks.stores.documentContent.set(prose);
        mocks.saveCollegeSetup.mockImplementation(async (...args: unknown[]) => {
            const saved = args[1] as ReturnType<typeof newCollegeSetup>;
            mocks.state.saveArgs = args;
            mocks.state.collegeState.setup = saved;
            mocks.state.activeSetup = saved;
        });
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());

        await capabilities.addPrompt(addedPrompt());

        const addedHeading = "# Describe another important experience.";
        const expected = `${prose}\n\n${addedHeading}\n\n`;
        expect(view.state.doc.toString()).toBe(expected);
        expect(view.state.doc.toString()).not.toContain(
            formatCollegePromptHeading(setup.prompts[0]),
        );
        expect(
            (mocks.state.saveArgs?.[1] as ReturnType<typeof newCollegeSetup>).prompts,
        ).toHaveLength(1);
    });

    it("adds a fourteenth prompt after thirteen existing H1 sections", async () => {
        const setup = activeSetup();
        const firstPrompt = setup.prompts[0];
        if (!firstPrompt) throw new Error("Expected the preset to contain a prompt");
        setup.prompts = Array.from({ length: 13 }, (_, index) => ({
            ...firstPrompt,
            id: `prompt-${index + 1}`,
            label: `Prompt ${index + 1}`,
            text: `Prompt ${index + 1}`,
            constraints: firstPrompt.constraints.map((constraint) => ({ ...constraint })),
        }));
        setup.sectionMode = true;
        const prose = setup.prompts
            .map((prompt, index) => `${formatCollegePromptHeading(prompt)}\n\nAnswer ${index + 1}`)
            .join("\n\n");
        const view = createEditorView(prose);
        mocks.stores.documentContent.set(prose);
        mocks.saveCollegeSetup.mockImplementation(async (...args: unknown[]) => {
            const saved = args[1] as ReturnType<typeof newCollegeSetup>;
            mocks.state.saveArgs = args;
            mocks.state.collegeState.setup = saved;
            mocks.state.activeSetup = saved;
        });
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());

        await capabilities.addPrompt(addedPrompt());

        expect(view.state.doc.toString()).toBe(
            `${prose}\n\n# Describe another important experience.\n\n`,
        );
        expect(
            (mocks.state.saveArgs?.[1] as ReturnType<typeof newCollegeSetup>).prompts,
        ).toHaveLength(14);
    });

    it("rejects adding to a read-only draft before saving metadata", async () => {
        activeSetup();
        createEditorView("Existing answer.", true);
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());

        await expect(capabilities.addPrompt(addedPrompt())).rejects.toThrow(/read-only/i);
        expect(mocks.saveCollegeSetup).not.toHaveBeenCalled();
    });

    it("does not edit a draft that changes while prompt metadata is saving", async () => {
        activeSetup();
        const prose = "Existing answer.";
        const view = createEditorView(prose);
        mocks.stores.documentContent.set(prose);
        const pending = deferred<void>();
        mocks.saveCollegeSetup.mockImplementation(async (...args: unknown[]) => {
            mocks.state.saveArgs = args;
            await pending.promise;
            const saved = args[1] as ReturnType<typeof newCollegeSetup>;
            mocks.state.collegeState.setup = saved;
            mocks.state.activeSetup = saved;
        });
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());
        const request = capabilities.addPrompt(addedPrompt());

        await vi.waitFor(() => expect(mocks.saveCollegeSetup).toHaveBeenCalledOnce());
        view.dispatch({ changes: { from: prose.length, insert: " changed" } });
        pending.resolve();

        await expect(request).rejects.toThrow(/changed while adding|try again/i);
        expect(view.state.doc.toString()).toBe("Existing answer. changed");
        expect(view.state.doc.toString()).not.toContain("Describe another important experience.");
        expect(mocks.saveCollegeSetup).toHaveBeenCalledTimes(2);
        expect(
            (mocks.state.saveArgs?.[1] as ReturnType<typeof newCollegeSetup>).prompts,
        ).toHaveLength(1);
    });

    it("rejects a prompt whose normalized text already has a heading", async () => {
        const setup = activeSetup();
        setup.sectionMode = true;
        const heading = formatCollegePromptHeading(setup.prompts[0]);
        const prose = `${heading}\n\nExisting answer.`;
        createEditorView(prose);
        mocks.stores.documentContent.set(prose);
        const { session } = sessionFor();
        const capabilities = createCollegeCapabilities(session, vi.fn());

        await expect(
            capabilities.addPrompt(addedPrompt(`  ${setup.prompts[0].text}\n`)),
        ).rejects.toThrow(/already in this tab/i);
        expect(mocks.saveCollegeSetup).not.toHaveBeenCalled();
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

    it.each(["prompt-fit", "specificity", "plan"] as const)(
        "rejects the %s request when AI is disabled",
        (action) => {
            activeSetup();
            mocks.appSettings.aiEnabled = false;
            const openPanel = vi.fn();
            const { session } = sessionFor();
            const capabilities = createCollegeCapabilities(session, openPanel);

            expect(() => capabilities.request(action)).toThrow(/enable ai/i);
            expect(openPanel).not.toHaveBeenCalled();
            expect(mocks.appEventBus.emit).not.toHaveBeenCalled();
        },
    );

    it.each(["prompt-fit", "specificity", "plan"] as const)(
        "rejects the %s request when credentials are unavailable",
        (action) => {
            activeSetup();
            mocks.state.credentials = false;
            const openPanel = vi.fn();
            const { session } = sessionFor();
            const capabilities = createCollegeCapabilities(session, openPanel);

            expect(() => capabilities.request(action)).toThrow(/enable ai/i);
            expect(openPanel).not.toHaveBeenCalled();
            expect(mocks.appEventBus.emit).not.toHaveBeenCalled();
        },
    );

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
