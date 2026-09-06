// documentLoader.test.ts — Exercise load/commit races without a Tauri process or EditorView.
import type { DocumentMeta, DraftMeta, LoadResult, TabMeta } from "$lib/db/types";
import { DocumentLoader, type LoadedDocument } from "$lib/editor/documentLoader";
import { getExtensions, savedFields } from "$lib/editor/extensions";
import { persistHistoryFacet } from "$lib/editor/persistentHistory";
import { SAMPLE_DOCUMENT_CONTENT, SAMPLE_DOCUMENT_TITLE } from "$lib/editor/sampleDocument";
import {
    currentDocumentId,
    currentDocumentTitle,
    currentDraftId,
    currentTabId,
    editorView,
    lastPersistedEventId,
    lastSavedAt,
    saveStatus,
} from "$lib/stores";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
    createDocument: vi.fn(),
    createDraft: vi.fn(),
    createSnapshot: vi.fn(),
    getDocumentMeta: vi.fn(),
    listDocuments: vi.fn(),
    loadDocumentState: vi.fn(),
    setActiveDraft: vi.fn(),
    updateDocumentMeta: vi.fn(),
    listTabs: vi.fn(),
    listTabDrafts: vi.fn(),
    getActiveTab: vi.fn(),
    getActiveDraft: vi.fn(),
    createTab: vi.fn(),
    setActiveTab: vi.fn(),
}));
const persistence = vi.hoisted(() => ({
    flushPersistence: vi.fn(),
    persistNamedVersion: vi.fn(),
    listeners: () => [],
}));
vi.mock("$lib/db", () => db);
vi.mock("$lib/editor/listeners", async (importOriginal) => ({
    ...(await importOriginal<typeof import("$lib/editor/listeners")>()),
    ...persistence,
}));
vi.mock("$lib/posthog", () => ({
    default: { capture: vi.fn() },
    capture: vi.fn(),
    captureException: vi.fn(),
}));
vi.mock("$lib/navigation", () => ({ goToHistory: vi.fn() }));
vi.mock("svelte-sonner", () => ({ toast: vi.fn() }));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
function metadata(id: string, persistHistory = true): DocumentMeta {
    return { id, title: id, persistHistory, createdAt: 1 } as DocumentMeta;
}
function saved(content: string, eventId = 7): LoadResult {
    return {
        snapshotStateJson: JSON.stringify(EditorState.create({ doc: content }).toJSON()),
        snapshotEventId: eventId,
        eventsSince: [],
    };
}
function draft(id: string, locked = false): DraftMeta {
    return { id, locked, tabId: "tab-1", documentId: "doc-1" } as DraftMeta;
}
let loader: DocumentLoader;
let commits: LoadedDocument[];

beforeEach(() => {
    vi.resetAllMocks();
    currentDocumentId.set("doc-1");
    currentDocumentTitle.set("old title");
    currentTabId.set("tab-1");
    currentDraftId.set("old-draft");
    lastPersistedEventId.set(99);
    lastSavedAt.set(123);
    saveStatus.set("saving");
    persistence.flushPersistence.mockResolvedValue(undefined);
    db.getDocumentMeta.mockImplementation((id: string) => Promise.resolve(metadata(id)));
    db.listDocuments.mockResolvedValue([metadata("doc-1")]);
    db.listTabs.mockResolvedValue([{ id: "tab-1" } as TabMeta]);
    db.getActiveTab.mockResolvedValue("tab-1");
    db.listTabDrafts.mockResolvedValue([draft("draft-1")]);
    db.getActiveDraft.mockResolvedValue("draft-1");
    db.loadDocumentState.mockImplementation((_id: string, draftId: string) =>
        Promise.resolve(saved(draftId)),
    );
    db.setActiveDraft.mockResolvedValue(undefined);
    commits = [];
    loader = new DocumentLoader({}, (result) => commits.push(result));
});
afterEach(() => {
    loader.dispose();
    currentDocumentId.set(null);
    currentDraftId.set(null);
    currentTabId.set(null);
});

describe("DocumentLoader", () => {
    it("does no database work until mounted and seeds checkpoint bookkeeping on bootstrap", async () => {
        expect(db.getDocumentMeta).not.toHaveBeenCalled();
        loader.start(false);
        await vi.waitFor(() => expect(commits).toHaveLength(1));
        expect(commits[0].state.doc.toString()).toBe("draft-1");
        expect(get(currentDraftId)).toBe("draft-1");
        expect(get(lastPersistedEventId)).toBe(7);
        expect(get(lastSavedAt)).toBeNull();
        expect(get(saveStatus)).toBe("saved");
    });

    it("loads the most recent document once and preserves its history policy and lock", async () => {
        currentDocumentId.set(null);
        db.getDocumentMeta.mockResolvedValue(metadata("doc-1", false));
        db.listTabDrafts.mockResolvedValue([draft("draft-1", true)]);
        loader.start(false);
        await vi.waitFor(() => expect(commits).toHaveLength(1));
        expect(get(currentDocumentId)).toBe("doc-1");
        expect(db.loadDocumentState).toHaveBeenCalledOnce();
        expect(commits[0].state.readOnly).toBe(true);
        expect(commits[0].state.facet(persistHistoryFacet)).toBe(false);
    });

    it.each([true, false])(
        "creates initial content before publishing document identity, sample=%s",
        async (showSample) => {
            currentDocumentId.set(null);
            db.listDocuments.mockResolvedValue([]);
            db.createDocument.mockResolvedValue("doc-1");
            db.createDraft.mockResolvedValue("draft-1");
            db.createSnapshot.mockImplementation(async (_draftId: string, json: string) => {
                expect(get(currentDocumentId)).toBeNull();
                expect(JSON.parse(json).doc).toBe(SAMPLE_DOCUMENT_CONTENT);
                db.loadDocumentState.mockResolvedValue({
                    snapshotStateJson: json,
                    snapshotEventId: -1,
                    eventsSince: [],
                });
            });
            if (!showSample) db.loadDocumentState.mockResolvedValue(saved("", -1));
            await loader.load({ showSample });
            expect(db.createDocument).toHaveBeenCalledWith(
                showSample ? SAMPLE_DOCUMENT_TITLE : "Untitled",
                false,
            );
            expect(commits[0].state.doc.toString()).toBe(showSample ? SAMPLE_DOCUMENT_CONTENT : "");
            expect(get(lastPersistedEventId)).toBe(-1);
            expect(db.createSnapshot).toHaveBeenCalledTimes(showSample ? 1 : 0);
        },
    );

    it("replays the event tail and seeds its last event ID", async () => {
        db.loadDocumentState.mockResolvedValue({
            ...saved("first", 4),
            eventsSince: [
                {
                    id: 12,
                    eventType: "doc_change",
                    createdAt: 1,
                    payload: JSON.stringify({
                        type: "doc_change",
                        changes: [{ from: 5, to: 5, insert: " second" }],
                        selection: EditorSelection.single(12).toJSON(),
                    }),
                },
            ],
        });
        await loader.load({ documentId: "doc-1" });
        expect(commits[0].state.doc.toString()).toBe("first second");
        expect(get(lastPersistedEventId)).toBe(12);
    });

    it("waits for persistence before reading or changing the active draft", async () => {
        const flush = deferred<void>();
        persistence.flushPersistence.mockReturnValue(flush.promise);
        const loading = loader.switchToDraft("tab-1", "next");
        expect(db.loadDocumentState).not.toHaveBeenCalled();
        expect(get(currentDraftId)).toBe("old-draft");
        flush.resolve();
        await loading;
        expect(get(currentDraftId)).toBe("next");
    });

    it("discards a slower draft before it can persist its pointer", async () => {
        const slow = deferred<LoadResult>();
        db.loadDocumentState.mockImplementation((_id: string, draftId: string) =>
            draftId === "slow" ? slow.promise : Promise.resolve(saved(draftId)),
        );
        const older = loader.switchToDraft("tab-1", "slow");
        await vi.waitFor(() => expect(db.loadDocumentState).toHaveBeenCalled());
        await loader.switchToDraft("tab-1", "newest");
        slow.resolve(saved("stale"));
        await older;
        expect(commits.map((result) => result.state.doc.toString())).toEqual(["newest"]);
        expect(db.setActiveDraft.mock.calls).toEqual([["tab-1", "newest"]]);
    });

    it("finishes a queued pointer commit if the newer load fails", async () => {
        const write = deferred<void>();
        db.setActiveDraft.mockReturnValue(write.promise);
        const older = loader.switchToDraft("tab-1", "first");
        await vi.waitFor(() => expect(db.setActiveDraft).toHaveBeenCalled());
        db.loadDocumentState.mockRejectedValue(new Error("read failed"));
        await expect(loader.switchToDraft("tab-1", "second")).rejects.toThrow("read failed");
        write.resolve();
        await older;
        expect(get(currentDraftId)).toBe("first");
        expect(commits[0].state.doc.toString()).toBe("first");
    });

    it("serializes pointer writes and commits their states in the same order", async () => {
        const write = deferred<void>();
        db.setActiveDraft.mockImplementation((_tabId: string, draftId: string) =>
            draftId === "first" ? write.promise : Promise.resolve(),
        );
        const first = loader.switchToDraft("tab-1", "first");
        await vi.waitFor(() => expect(db.setActiveDraft).toHaveBeenCalledOnce());
        const second = loader.switchToDraft("tab-1", "second");
        await vi.waitFor(() => expect(db.loadDocumentState).toHaveBeenCalledTimes(2));
        expect(db.setActiveDraft).toHaveBeenCalledOnce();
        write.resolve();
        await Promise.all([first, second]);
        expect(commits.map((result) => result.draftId)).toEqual(["first", "second"]);
    });

    it.each(["document", "tab", "unmount"])(
        "does not commit after a %s change during a pointer write",
        async (change) => {
            const write = deferred<void>();
            db.setActiveDraft.mockReturnValue(write.promise);
            const loading = loader.switchToDraft("tab-1", "next");
            await vi.waitFor(() => expect(db.setActiveDraft).toHaveBeenCalled());
            if (change === "document") currentDocumentId.set("elsewhere");
            if (change === "tab") currentTabId.set("elsewhere");
            if (change === "unmount") loader.dispose();
            write.resolve();
            await loading;
            expect(commits).toHaveLength(0);
            expect(get(currentDraftId)).toBe("old-draft");
        },
    );

    it("cancels a bootstrap lookup when document navigation overtakes it", async () => {
        currentDocumentId.set(null);
        const recent = deferred<DocumentMeta[]>();
        db.listDocuments.mockReturnValue(recent.promise);
        loader.start(false);
        await vi.waitFor(() => expect(db.listDocuments).toHaveBeenCalled());
        currentDocumentId.set("new-document");
        await vi.waitFor(() => expect(commits).toHaveLength(1));
        recent.resolve([metadata("old-document")]);
        await Promise.resolve();
        expect(get(currentDocumentId)).toBe("new-document");
        expect(commits.map((result) => result.documentId)).toEqual(["new-document"]);
    });

    it("does not overwrite a title edited while switching drafts", async () => {
        const state = deferred<LoadResult>();
        db.loadDocumentState.mockReturnValue(state.promise);
        const loading = loader.switchToDraft("tab-1", "next");
        await vi.waitFor(() => expect(db.loadDocumentState).toHaveBeenCalled());
        currentDocumentTitle.set("new title");
        state.resolve(saved("next"));
        await loading;
        expect(get(currentDocumentTitle)).toBe("new title");
    });

    it("does not let a failed pointer write poison the next switch", async () => {
        db.setActiveDraft.mockRejectedValueOnce(new Error("write failed"));
        await expect(loader.switchToDraft("tab-1", "failed")).rejects.toThrow("write failed");
        expect(commits).toHaveLength(0);
        expect(get(lastPersistedEventId)).toBe(99);
        await loader.switchToDraft("tab-1", "next");
        expect(get(currentDraftId)).toBe("next");
    });

    it("prevents a disposed bootstrap from updating the tab tree", async () => {
        const tabs = deferred<TabMeta[]>();
        db.listTabs.mockReturnValue(tabs.promise);
        const loading = loader.load({ documentId: "doc-1" });
        await vi.waitFor(() => expect(db.listTabs).toHaveBeenCalled());
        loader.dispose();
        tabs.resolve([{ id: "stale-tab" } as TabMeta]);
        await loading;
        expect(loader.drafts.tabs).toEqual([]);
        expect(commits).toHaveLength(0);
        expect(get(currentTabId)).toBe("tab-1");
    });

    it("uses the live state when seeding the current draft", async () => {
        const previousView = get(editorView);
        const state = EditorState.create({
            doc: "unsaved text",
            selection: EditorSelection.cursor(4),
            extensions: getExtensions(),
        });
        editorView.set({ state } as EditorView);
        try {
            const seed = JSON.parse(await loader.seedStateJson("old-draft"));
            expect(seed.doc).toBe("unsaved text");
            expect(seed.selection).toEqual(state.selection.toJSON());
            expect(db.loadDocumentState).not.toHaveBeenCalled();
        } finally {
            editorView.set(previousView);
        }
    });

    it("seeds a non-active draft without committing its identity or lock", async () => {
        db.getDocumentMeta.mockResolvedValue(metadata("doc-1", false));
        const seed = await loader.seedStateJson("other-draft");
        const state = EditorState.fromJSON(
            JSON.parse(seed),
            { extensions: getExtensions({ persistHistory: false }) },
            savedFields,
        );
        expect(state.doc.toString()).toBe("other-draft");
        expect(state.readOnly).toBe(false);
        expect(get(currentDraftId)).toBe("old-draft");
        expect(commits).toHaveLength(0);
    });
});

describe("named version targets", () => {
    async function target() {
        await loader.load({ documentId: "doc-1" });
        editorView.set({ state: commits[0].state } as EditorView);
        return loader.namedVersionTarget()!;
    }

    it("trims labels, ignores empty labels, and suppresses repeated submission", async () => {
        const request = await target();
        const pending = deferred<number>();
        persistence.persistNamedVersion.mockReturnValue(pending.promise);
        expect(await request.save("  ")).toBeNull();
        const saving = request.save("  Opening  ");
        expect(await request.save("Opening")).toBeNull();
        expect(persistence.persistNamedVersion).toHaveBeenCalledOnce();
        expect(persistence.persistNamedVersion.mock.calls[0].slice(0, 3)).toEqual([
            "draft-1",
            JSON.stringify(commits[0].state.toJSON(savedFields)),
            "Opening",
        ]);
        pending.resolve(5);
        expect(await saving).toBe(5);
    });

    it.each(["document", "tab", "draft", "reload", "dispose"])(
        "rejects stale prompt after %s changes",
        async (change) => {
            const request = await target();
            if (change === "document") currentDocumentId.set("elsewhere");
            if (change === "tab") currentTabId.set("elsewhere");
            if (change === "draft") await loader.switchToDraft("tab-1", "next");
            if (change === "reload") await loader.load({ documentId: "doc-1" });
            if (change === "dispose") loader.dispose();
            expect(await request.save("Opening")).toBeNull();
            expect(persistence.persistNamedVersion).not.toHaveBeenCalled();
        },
    );

    it("invalidates an already queued request when navigation begins", async () => {
        const request = await target();
        let valid!: () => boolean;
        persistence.persistNamedVersion.mockImplementation(
            async (_draft, _state, _label, isCurrent) => {
                valid = isCurrent;
                return 5;
            },
        );
        await request.save("Opening");
        expect(valid()).toBe(true);
        const pending = deferred<void>();
        persistence.flushPersistence.mockReturnValue(pending.promise);
        const navigation = loader.switchToDraft("tab-1", "next");
        expect(valid()).toBe(false);
        expect(loader.namedVersionTarget()).toBeUndefined();
        pending.resolve();
        await navigation;
    });
});
