// activation.svelte.ts — Document-scoped College application opt-in state.
//
// College remains hidden until the current document's activation row has been
// confirmed by SQLite. Loads and writes carry both a document-generation token
// and a per-document revision so a late response cannot publish state into a
// different document or overwrite an explicit enable that already succeeded.

import { getCollegeDocumentEnabled, setCollegeDocumentEnabled } from "$lib/db";
import { currentDocumentId } from "$lib/stores";
import { untrack } from "svelte";
import { get } from "svelte/store";

export type CollegeActivationState = {
    documentId: string | null;
    enabled: boolean;
    loading: boolean;
    saving: boolean;
    error: string;
};

export const collegeActivation = $state<CollegeActivationState>({
    documentId: null,
    enabled: false,
    loading: false,
    saving: false,
    error: "",
});

let effectsInitialized = false;
let generation = 0;
const pendingWrites = new Map<string, Promise<void>>();
const targetRevisions = new Map<string, number>();

function errorMessage(error: unknown): string {
    return error instanceof Error && error.message
        ? error.message
        : "Could not update College applications for this document.";
}

function targetRevision(documentId: string): number {
    return targetRevisions.get(documentId) ?? 0;
}

function bumpTargetRevision(documentId: string): void {
    targetRevisions.set(documentId, targetRevision(documentId) + 1);
}

function enqueueWrite(documentId: string, operation: () => Promise<void>): Promise<void> {
    const previous = pendingWrites.get(documentId) ?? Promise.resolve();
    const current = previous
        .catch(() => undefined)
        .then(async () => {
            try {
                await operation();
            } finally {
                // Increment before the queued promise resolves. A load waiting on
                // this write then captures the settled revision, even if its
                // continuation runs before the caller's await resumes.
                bumpTargetRevision(documentId);
            }
        });
    pendingWrites.set(documentId, current);
    void current.then(
        () => {
            if (pendingWrites.get(documentId) === current) pendingWrites.delete(documentId);
        },
        () => {
            if (pendingWrites.get(documentId) === current) pendingWrites.delete(documentId);
        },
    );
    return current;
}

function isCurrentTarget(documentId: string, loadGeneration: number): boolean {
    return (
        generation === loadGeneration &&
        get(currentDocumentId) === documentId &&
        collegeActivation.documentId === documentId
    );
}

async function loadActivation(documentId: string, loadGeneration: number): Promise<void> {
    const pendingWrite = pendingWrites.get(documentId);
    if (pendingWrite) await pendingWrite.catch(() => undefined);
    const loadRevision = targetRevision(documentId);

    try {
        const enabled = await getCollegeDocumentEnabled(documentId);
        if (
            !isCurrentTarget(documentId, loadGeneration) ||
            targetRevision(documentId) !== loadRevision ||
            !collegeActivation.loading
        ) {
            return;
        }
        collegeActivation.enabled = enabled === true;
        collegeActivation.loading = false;
        collegeActivation.error = "";
    } catch (error) {
        if (
            !isCurrentTarget(documentId, loadGeneration) ||
            targetRevision(documentId) !== loadRevision
        ) {
            return;
        }
        collegeActivation.enabled = false;
        collegeActivation.loading = false;
        collegeActivation.error = errorMessage(error);
    }
}

function beginLoad(documentId: string | null): void {
    generation += 1;
    const loadGeneration = generation;
    collegeActivation.documentId = documentId;
    collegeActivation.enabled = false;
    collegeActivation.loading = documentId !== null;
    collegeActivation.saving = false;
    collegeActivation.error = "";
    if (documentId) void loadActivation(documentId, loadGeneration);
}

/**
 * Subscribes to the active document and reloads its document-scoped College
 * activation. Call once from the mounted Sidebar host.
 */
export function useCollegeActivationEffects(): void {
    $effect(() => {
        if (effectsInitialized) return;
        effectsInitialized = true;
        const unsubscribe = currentDocumentId.subscribe((documentId) =>
            untrack(() => beginLoad(documentId)),
        );
        return () => {
            generation += 1;
            unsubscribe();
            effectsInitialized = false;
        };
    });
}

/**
 * Enables College for one document after SQLite confirms the write. The
 * visible flag is published only while that document is still current.
 */
export async function enableCollegeForDocument(documentId: string): Promise<boolean> {
    if (!documentId || get(currentDocumentId) !== documentId) return false;

    const writeGeneration = generation;
    collegeActivation.saving = true;
    collegeActivation.error = "";
    try {
        await enqueueWrite(documentId, () => setCollegeDocumentEnabled(documentId, true));
        if (!isCurrentTarget(documentId, writeGeneration)) return false;

        collegeActivation.enabled = true;
        collegeActivation.loading = false;
        collegeActivation.saving = false;
        collegeActivation.error = "";
        return true;
    } catch (error) {
        if (!isCurrentTarget(documentId, writeGeneration)) return false;
        collegeActivation.enabled = false;
        collegeActivation.loading = false;
        collegeActivation.saving = false;
        collegeActivation.error = errorMessage(error);
        return false;
    } finally {
        if (isCurrentTarget(documentId, writeGeneration)) {
            collegeActivation.saving = false;
        }
    }
}
