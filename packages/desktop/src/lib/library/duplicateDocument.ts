/**
 * duplicateDocument.ts — Materialize a document copy.
 *
 * Drafts are reconstructed through the canonical snapshot + event replay path,
 * then serialized without undo history before the Rust command inserts the
 * whole copy atomically.
 */
import { duplicateDocument, getDocumentMeta, listDrafts, loadDocumentState } from "$lib/db";
import type { DuplicateDraftState } from "$lib/db/types";
import { getExtensions, savedFields } from "$lib/editor/extensions";
import { reconstructState } from "$lib/editor/replay";

type JsonRecord = Record<string, unknown>;

/** Create a fully independent, history-free copy and return its new document id. */
export async function duplicateLibraryDocument(sourceDocumentId: string): Promise<string> {
    const [document, drafts] = await Promise.all([
        getDocumentMeta(sourceDocumentId),
        listDrafts(sourceDocumentId),
    ]);
    if (!document) throw new Error("The document no longer exists.");

    const draftStates: DuplicateDraftState[] = await Promise.all(
        drafts.map(async (draft) => {
            const loaded = await loadDocumentState(sourceDocumentId, draft.id);
            const state = reconstructState(
                loaded.snapshotStateJson,
                loaded.eventsSince,
                getExtensions({ persist: false, persistHistory: document.persistHistory }),
            );
            // The copy keeps the source's annotation ids, _historyIds, and revision
            // version/group ids verbatim. These are only unique within a single
            // draft's fields, and the original and the copy never share an ID
            // namespace at runtime (documents/tabs/drafts get fresh UUIDs in the
            // Rust duplicate command, events are draft-scoped, clipboard paste
            // renumbers via getNewId). If a cross-document annotation ID collision
            // ever does surface, this is the first place to look.
            const stateJson = state.toJSON({
                annotationField: savedFields.annotationField,
                versionGroupField: savedFields.versionGroupField,
            }) as JsonRecord;
            return {
                sourceDraftId: draft.id,
                sourceEventId: loaded.eventsSince.at(-1)?.id ?? loaded.snapshotEventId,
                stateJson: JSON.stringify(stateJson),
            };
        }),
    );
    return duplicateDocument(sourceDocumentId, draftStates);
}
