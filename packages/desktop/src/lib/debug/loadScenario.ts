// loadScenario.ts — DEV-only reset, event recording, and reload for both scenario callers.
import {
    appendEvent,
    createDocument,
    createDraft,
    createSnapshot,
    resetDb,
    updateDocumentMeta,
} from "$lib/db";
import type { EventPayload } from "$lib/db/events";
import { documentMetadata } from "$lib/editor/documentMetadata";
import { getExtensions, savedFields } from "$lib/editor/extensions";
import { buildEventPayload, flushPersistence } from "$lib/editor/listeners";
import { getPersistUndoHistoryForNewDocuments } from "$lib/settings.svelte";
import { currentDocumentId, currentDocumentTitle, currentDraftId } from "$lib/stores";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Scenario } from "./scenarios";

export async function loadScenario(
    scenario: Scenario,
    reloadEditor: () => Promise<void> | void,
): Promise<void> {
    if (!import.meta.env.DEV) throw new Error("Scenarios are only available in development");
    const payloads: EventPayload[] = [];
    const persistHistory = getPersistUndoHistoryForNewDocuments();
    const tempView = new EditorView({
        state: EditorState.create({
            doc: scenario.doc,
            extensions: getExtensions({
                persist: false,
                persistHistory,
                updateListener(update) {
                    const payload = buildEventPayload(update);
                    if (payload) payloads.push(payload);
                },
            }),
        }),
        parent: document.createElement("div"),
    });
    let finalState: EditorState;
    try {
        scenario.setup(tempView);
        finalState = tempView.state;
    } finally {
        tempView.destroy();
    }

    // Old queued writes must finish before the destructive DEV reset.
    await flushPersistence();
    await resetDb();
    const docId = await createDocument(scenario.label, persistHistory);
    const draftId = await createDraft(docId, "Draft");
    let lastEventId = -1;
    for (const payload of payloads) {
        const result = await appendEvent(draftId, JSON.stringify(payload));
        lastEventId = result.eventId;
    }
    await createSnapshot(draftId, JSON.stringify(finalState.toJSON(savedFields)), lastEventId);
    const docText = finalState.doc.toString();
    const { wordCount, previewText } = documentMetadata(docText);
    await updateDocumentMeta(docId, scenario.label, wordCount, previewText, "[]", docText);

    // Publishing the document ID can start loading it, so the snapshot must exist first.
    currentDocumentId.set(docId);
    currentDocumentTitle.set(scenario.label);
    currentDraftId.set(draftId);
    await reloadEditor();
}
