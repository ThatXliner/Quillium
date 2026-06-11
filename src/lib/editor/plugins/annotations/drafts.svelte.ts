/**
 * drafts.svelte.ts — Shared in-progress composer text, keyed by annotation id.
 *
 * Comment/reply drafts used to live in component-local $state, which dies
 * when the narrow-mode layout switch swaps floating cards for modals (#247):
 * resizing the window mid-draft unmounted the composer and lost the text.
 * Keeping drafts here lets the inline composers (PreComment, Thread) and the
 * modal composers (CommentModal, RevisionModal's Thread) hand off the
 * in-progress text in both directions.
 *
 * Drafts are cleared on send/cancel and whenever the current document
 * changes (annotation ids are only unique per document). Known limitation:
 * nested editors have their own annotation id space, so a main-level draft
 * and a nested-level draft with the same id would share text — harmless in
 * practice and preferable to losing drafts.
 */
import { get } from "svelte/store";
import { currentDocumentId } from "$lib/stores";

const drafts = $state<Record<number, string>>({});

export function getDraft(annotationId: number): string {
    return drafts[annotationId] ?? "";
}

export function setDraft(annotationId: number, text: string): void {
    if (text) {
        drafts[annotationId] = text;
    } else {
        delete drafts[annotationId];
    }
}

export function clearDraft(annotationId: number): void {
    delete drafts[annotationId];
}

// Annotation ids restart per document — drop all drafts when the user
// switches documents so doc B's annotation #n never shows doc A's draft.
let draftsDocId = get(currentDocumentId);
currentDocumentId.subscribe((docId) => {
    if (docId === draftsDocId) return;
    draftsDocId = docId;
    for (const key of Object.keys(drafts)) {
        delete drafts[Number(key)];
    }
});
