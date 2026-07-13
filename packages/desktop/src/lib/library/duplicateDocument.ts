/**
 * duplicateDocument.ts — Materialize and re-identify a document copy.
 *
 * Drafts are reconstructed through the canonical snapshot + event replay path,
 * then serialized without undo history. Annotation identity is remapped through
 * every nested revision before the Rust command inserts the whole copy atomically.
 */
import { duplicateDocument, getDocumentMeta, listDrafts, loadDocumentState } from "$lib/db";
import type { DuplicateDraftState } from "$lib/db/types";
import { getExtensions, savedFields } from "$lib/editor/extensions";
import { reconstructState } from "$lib/editor/replay";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectAnnotationIds(value: unknown, ids: Set<number>): void {
    if (Array.isArray(value)) {
        for (const item of value) collectAnnotationIds(item, ids);
        return;
    }
    if (!isRecord(value)) return;
    if (isRecord(value.annotationField)) {
        for (const annotation of Object.values(value.annotationField)) {
            if (isRecord(annotation) && typeof annotation.id === "number") {
                ids.add(annotation.id);
            }
        }
    }
    for (const child of Object.values(value)) collectAnnotationIds(child, ids);
}

function remapSerializedState(
    state: JsonRecord,
    nextAnnotationId: () => number,
    nextStringId: (prefix: "annotation" | "version" | "group") => string,
): JsonRecord {
    const next: JsonRecord = { ...state };
    const annotations = isRecord(state.annotationField) ? state.annotationField : {};
    const annotationIds = new Map<number, number>();
    const versionIds = new Map<number, Map<string, string>>();

    for (const [key, value] of Object.entries(annotations)) {
        if (!isRecord(value)) continue;
        const oldId = typeof value.id === "number" ? value.id : Number(key);
        if (Number.isSafeInteger(oldId)) annotationIds.set(oldId, nextAnnotationId());
    }

    const remappedAnnotations: JsonRecord = {};
    for (const [key, value] of Object.entries(annotations)) {
        if (!isRecord(value)) continue;
        const oldId = typeof value.id === "number" ? value.id : Number(key);
        const newId = annotationIds.get(oldId);
        if (newId === undefined) continue;

        const annotation: JsonRecord = {
            ...value,
            id: newId,
            _historyId: nextStringId("annotation"),
        };
        if (value._type === "revision" && Array.isArray(value.versions)) {
            const idsForRevision = new Map<string, string>();
            for (const version of value.versions) {
                if (isRecord(version) && typeof version.id === "string") {
                    idsForRevision.set(version.id, nextStringId("version"));
                }
            }
            versionIds.set(oldId, idsForRevision);
            annotation.versions = value.versions.map((version) => {
                if (!isRecord(version)) return version;
                const remapped = remapSerializedState(version, nextAnnotationId, nextStringId);
                return {
                    ...remapped,
                    id:
                        typeof version.id === "string"
                            ? idsForRevision.get(version.id)
                            : nextStringId("version"),
                };
            });
            if (typeof value.activeVersionId === "string") {
                annotation.activeVersionId = idsForRevision.get(value.activeVersionId);
            }
        }
        remappedAnnotations[String(newId)] = annotation;
    }
    next.annotationField = remappedAnnotations;

    if (isRecord(state.versionGroupField)) {
        const groups: JsonRecord = {};
        for (const value of Object.values(state.versionGroupField)) {
            if (!isRecord(value)) continue;
            const groupId = nextStringId("group");
            const members = Array.isArray(value.members)
                ? value.members.flatMap((member) => {
                      if (
                          !isRecord(member) ||
                          typeof member.revisionId !== "number" ||
                          typeof member.versionId !== "string"
                      ) {
                          return [];
                      }
                      const revisionId = annotationIds.get(member.revisionId);
                      const versionId = versionIds.get(member.revisionId)?.get(member.versionId);
                      return revisionId === undefined || versionId === undefined
                          ? []
                          : [{ revisionId, versionId }];
                  })
                : [];
            groups[groupId] = { ...value, id: groupId, members };
        }
        next.versionGroupField = groups;
    }

    return next;
}

/** Remap all identity-bearing fields across a set of draft states. */
export function remapDocumentStateIdentities(states: JsonRecord[]): JsonRecord[] {
    const sourceIds = new Set<number>();
    for (const state of states) collectAnnotationIds(state, sourceIds);
    let nextNumericId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    let stringCounter = 0;

    const nextAnnotationId = () => {
        while (sourceIds.has(nextNumericId)) nextNumericId++;
        return nextNumericId++;
    };
    const nextStringId = (prefix: "annotation" | "version" | "group") => {
        stringCounter++;
        const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random()}`;
        return `${prefix}_${random}_${stringCounter}`;
    };

    return states.map((state) => remapSerializedState(state, nextAnnotationId, nextStringId));
}

/** Create a fully independent, history-free copy and return its new document id. */
export async function duplicateLibraryDocument(sourceDocumentId: string): Promise<string> {
    const [document, drafts] = await Promise.all([
        getDocumentMeta(sourceDocumentId),
        listDrafts(sourceDocumentId),
    ]);
    if (!document) throw new Error("The document no longer exists.");

    const materialized = await Promise.all(
        drafts.map(async (draft) => {
            const loaded = await loadDocumentState(sourceDocumentId, draft.id);
            const state = reconstructState(
                loaded.snapshotStateJson,
                loaded.eventsSince,
                getExtensions({ persist: false, persistHistory: document.persistHistory }),
            );
            return {
                sourceEventId: loaded.eventsSince.at(-1)?.id ?? loaded.snapshotEventId,
                state: state.toJSON({
                    annotationField: savedFields.annotationField,
                    versionGroupField: savedFields.versionGroupField,
                }) as JsonRecord,
            };
        }),
    );
    const remapped = remapDocumentStateIdentities(materialized.map((draft) => draft.state));
    const draftStates: DuplicateDraftState[] = drafts.map((draft, index) => ({
        sourceDraftId: draft.id,
        sourceEventId: materialized[index].sourceEventId,
        stateJson: JSON.stringify(remapped[index]),
    }));
    return duplicateDocument(sourceDocumentId, draftStates);
}
