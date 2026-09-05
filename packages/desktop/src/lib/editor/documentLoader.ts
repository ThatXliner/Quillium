// documentLoader.ts — Bootstrap, load, and commit the root editor's writing state.
import {
    createDocument,
    createDraft,
    createSnapshot,
    getDocumentMeta,
    listDocuments,
    loadDocumentState,
    setActiveDraft,
    updateDocumentMeta,
} from "$lib/db";
import { getUndoHistoryPolicyAnalytics } from "$lib/db/historyPolicy";
import type { LoadResult } from "$lib/db/types";
import { annotationEventBus } from "$lib/events/annotationEventBus";
import posthog from "$lib/posthog";
import { getPersistUndoHistoryForNewDocuments } from "$lib/settings.svelte";
import {
    currentDocumentId,
    currentDocumentTitle,
    currentDraftId,
    currentTabId,
    editorView,
} from "$lib/stores";
import { EditorState } from "@codemirror/state";
import { get } from "svelte/store";
import { getExtensions, savedFields } from "./extensions";
import { type ListenerOptions, flushPersistence, seedPersistenceBookkeeping } from "./listeners";
import { reconstructState } from "./replay";
import { SAMPLE_DOCUMENT_CONTENT, SAMPLE_DOCUMENT_TITLE } from "./sampleDocument";
import { TabDraftController } from "./tabDrafts.svelte";

type DraftTarget = { tabId: string; draftId: string };

export type LoadedDocument = {
    documentId: string;
    title: string;
    draftId: string | null;
    state: EditorState;
    latestEventId: number;
};

export class DocumentLoader {
    readonly drafts = new TabDraftController({
        switchToDraft: (tabId, draftId) => this.switchToDraft(tabId, draftId),
        flushPendingPersist: () => this.flush(),
        seedStateJson: (draftId) => this.seedStateJson(draftId),
    });
    #generation = 0;
    #disposed = false;
    #selectingDocument = false;
    #activeDraftWrite: Promise<void> = Promise.resolve();
    #unsubscribe: (() => void) | undefined;
    readonly #options: ListenerOptions;
    readonly #commitState: (loaded: LoadedDocument) => void;

    constructor(options: ListenerOptions, commitState: (loaded: LoadedDocument) => void) {
        this.#options = options;
        this.#commitState = commitState;
    }

    /** Subscribe on mount; construction does no database work. */
    start(showSample: boolean): void {
        this.#unsubscribe = currentDocumentId.subscribe((id) => {
            if (this.#selectingDocument) return;
            void this.load({ documentId: id ?? undefined, showSample }).catch((error) => {
                console.error("[documentLoader] load failed", error);
            });
        });
    }

    dispose(): void {
        this.#disposed = true;
        this.#generation++;
        this.#unsubscribe?.();
        this.drafts.cancelPendingLoads();
    }

    async flush(): Promise<void> {
        await flushPersistence();
    }

    #selectDocument(id: string): void {
        this.#selectingDocument = true;
        currentDocumentId.set(id);
        this.#selectingDocument = false;
    }

    #isCurrent(generation: number, documentId: string | null, tabId?: string): boolean {
        return (
            !this.#disposed &&
            generation === this.#generation &&
            get(currentDocumentId) === documentId &&
            (tabId === undefined || get(currentTabId) === tabId)
        );
    }

    #buildState(loaded: LoadResult, readOnly: boolean, persistHistory: boolean): EditorState {
        return reconstructState(loaded.snapshotStateJson, loaded.eventsSince, [
            getExtensions({ ...this.#options, persistHistory }),
            EditorState.readOnly.of(readOnly),
        ]);
    }

    #commit(loaded: LoadedDocument, updateTitle: boolean): void {
        annotationEventBus.clearPendingSelections();
        if (updateTitle) currentDocumentTitle.set(loaded.title);
        currentDraftId.set(loaded.draftId);
        seedPersistenceBookkeeping(loaded.latestEventId);
        // setState does not emit an update. The view owner also seeds its Svelte mirrors.
        this.#commitState(loaded);
    }

    /** All visible loads share cancellation, reconstruction, and persistence seeding. */
    async load({
        documentId: requestedId,
        target,
        showSample = false,
    }: {
        documentId?: string;
        target?: DraftTarget;
        showSample?: boolean;
    } = {}): Promise<LoadedDocument | undefined> {
        let documentId = requestedId;
        if (this.#disposed) return;
        const generation = ++this.#generation;
        const requestedDocument = get(currentDocumentId);
        await this.flush();
        if (!this.#isCurrent(generation, requestedDocument, target?.tabId)) return;

        if (!documentId) {
            const documents = await listDocuments();
            if (!this.#isCurrent(generation, requestedDocument)) return;
            documentId = documents[0]?.id;
            if (!documentId) {
                documentId = await this.#createInitialDocument(showSample);
                if (!this.#isCurrent(generation, requestedDocument)) return;
            }
            // The tab controller resolves context against this store. Initial content
            // has already been saved, and our subscription must not start another load.
            this.#selectDocument(documentId);
        }

        const [document, resolved] = await Promise.all([
            getDocumentMeta(documentId),
            target ?? this.drafts.refreshTabState(documentId),
        ]);
        if (!this.#isCurrent(generation, documentId, target?.tabId)) return;
        const loaded = resolved
            ? await loadDocumentState(documentId, resolved.draftId)
            : { snapshotStateJson: null, snapshotEventId: -1, eventsSince: [] };
        if (!this.#isCurrent(generation, documentId, target?.tabId)) return;
        const result: LoadedDocument = {
            documentId,
            title: document?.title ?? "Untitled",
            draftId: resolved?.draftId ?? null,
            state: this.#buildState(
                loaded,
                this.drafts.lockedOf(resolved?.draftId ?? null),
                document?.persistHistory ?? true,
            ),
            latestEventId: loaded.eventsSince.at(-1)?.id ?? Math.max(-1, loaded.snapshotEventId),
        };

        if (target) {
            // Once queued, finish the same-tab UI commit even if a newer load starts.
            // If that newer load fails, the editor still matches the persisted pointer.
            const write = this.#activeDraftWrite.then(() =>
                setActiveDraft(target.tabId, target.draftId),
            );
            this.#activeDraftWrite = write.catch(() => {});
            await write;
            if (
                this.#disposed ||
                get(currentDocumentId) !== documentId ||
                get(currentTabId) !== target.tabId
            )
                return;
        }
        if (document && !target) {
            posthog.capture("undo_history_policy_loaded", getUndoHistoryPolicyAnalytics(document));
        }
        this.#commit(result, !target);
        return result;
    }

    async switchToDraft(tabId: string, draftId: string): Promise<void> {
        const documentId = get(currentDocumentId);
        if (documentId) await this.load({ documentId, target: { tabId, draftId } });
    }

    async #createInitialDocument(showSample: boolean): Promise<string> {
        const title = showSample ? SAMPLE_DOCUMENT_TITLE : "Untitled";
        const content = showSample ? SAMPLE_DOCUMENT_CONTENT : "";
        const persistHistory = getPersistUndoHistoryForNewDocuments();
        const documentId = await createDocument(title, persistHistory);
        const draftId = await createDraft(documentId, "main");
        if (showSample) {
            const state = EditorState.create({
                doc: content,
                extensions: getExtensions({ ...this.#options, persistHistory }),
            });
            await createSnapshot(draftId, JSON.stringify(state.toJSON(savedFields)), -1);
            await updateDocumentMeta(
                documentId,
                title,
                content.trim().split(/\s+/).filter(Boolean).length,
                content.slice(0, 200),
                "",
                content,
            );
        }
        return documentId;
    }

    /** Live drafts include unsaved selection/undo state; other drafts replay from disk. */
    async seedStateJson(sourceDraftId: string): Promise<string> {
        const view = get(editorView);
        if (view && sourceDraftId === get(currentDraftId)) {
            return JSON.stringify(view.state.toJSON(savedFields));
        }
        const documentId = get(currentDocumentId);
        const [loaded, document] = await Promise.all([
            loadDocumentState(documentId ?? "", sourceDraftId),
            documentId ? getDocumentMeta(documentId) : Promise.resolve(null),
        ]);
        return JSON.stringify(
            this.#buildState(loaded, false, document?.persistHistory ?? true).toJSON(savedFields),
        );
    }
}
