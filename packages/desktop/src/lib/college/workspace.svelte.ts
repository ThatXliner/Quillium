// workspace.svelte.ts — The transient workspace for applying a College setup
// to an existing or newly created tab.
//
// Setup writes are deliberately routed through the existing tab API. They do
// not copy editor state, drafts, labels, or document-owned notes. A workspace
// token makes a completed write harmless after the user changes documents or
// hides the College host.

import { stopAllAi } from "$lib/ai/settings.svelte";
import { collegeState, reloadCollegeSetup, saveCollegeSetup } from "$lib/college/state.svelte";
import { setCollegeTabSetup } from "$lib/db";
import { currentDocumentId, currentTabId } from "$lib/stores";
import { get } from "svelte/store";
import { type CollegeSetup, cloneCollegeSetup, serializeCollegeSetup } from "./model";

export type CollegeWorkspaceState = {
    documentId: string | null;
    setup: CollegeSetup | null;
    saving: boolean;
    error: string;
};

export const collegeWorkspace = $state<CollegeWorkspaceState>({
    documentId: null,
    setup: null,
    saving: false,
    error: "",
});

let workspaceGeneration = 0;

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

function validationError(message: string): never {
    collegeWorkspace.error = message;
    throw new Error(message);
}

function validateSinglePromptSetup(setup: CollegeSetup): CollegeSetup {
    const validated = cloneCollegeSetup(setup);
    if (validated.prompts.length !== 1) {
        return validationError("Choose exactly one prompt before applying it to a tab.");
    }
    return validated;
}

function assertWorkspaceHost(documentId: string): void {
    if (!documentId || get(currentDocumentId) !== documentId) {
        validationError("The College workspace belongs to another document.");
    }
    if (!collegeState.hostEnabled) {
        validationError("College applications are disabled in this workspace.");
    }
    if (collegeWorkspace.saving) {
        validationError("A College tab operation is already in progress.");
    }
}

function isCurrentWorkspace(documentId: string, generation: number): boolean {
    return (
        workspaceGeneration === generation &&
        collegeWorkspace.documentId === documentId &&
        get(currentDocumentId) === documentId &&
        collegeState.hostEnabled
    );
}

/**
 * Capture one exact document/setup pair for a later tab operation.
 * The stored value is a validated deep clone, so callers can continue editing
 * their panel-local object without changing the pending operation.
 */
export function beginCollegeTabPick(documentId: string, setup: CollegeSetup): void {
    assertWorkspaceHost(documentId);
    const validated = validateSinglePromptSetup(setup);
    workspaceGeneration += 1;
    collegeWorkspace.documentId = documentId;
    collegeWorkspace.setup = validated;
    collegeWorkspace.saving = false;
    collegeWorkspace.error = "";
}

/** Cancel only the transient selection. An already-dispatched write continues. */
export function cancelCollegeTabPick(): void {
    workspaceGeneration += 1;
    collegeWorkspace.documentId = null;
    collegeWorkspace.setup = null;
    collegeWorkspace.saving = false;
    collegeWorkspace.error = "";
}

/**
 * Persist the captured setup on one existing tab. Only this tab's College row
 * changes; all prose, drafts, labels, and document-owned notes remain intact.
 */
export async function applyCollegeToExistingTab(tabId: string): Promise<boolean> {
    const documentId = collegeWorkspace.documentId;
    const pendingSetup = collegeWorkspace.setup;
    if (!documentId || !pendingSetup || !tabId.trim()) {
        validationError("Choose a College setup and destination tab first.");
    }
    assertWorkspaceHost(documentId);

    const setup = validateSinglePromptSetup(pendingSetup);
    const setupJson = serializeCollegeSetup(setup);
    const generation = workspaceGeneration;
    collegeWorkspace.saving = true;
    collegeWorkspace.error = "";
    stopAllAi();

    try {
        if (get(currentTabId) === tabId) {
            // Reuse the state writer for the selected tab so its per-target
            // queue, readiness guard, and accepted-state rollback all apply.
            await saveCollegeSetup({ documentId, tabId }, setup);
        } else {
            await setCollegeTabSetup(documentId, tabId, setupJson);
        }
        if (!isCurrentWorkspace(documentId, generation)) return false;

        collegeWorkspace.documentId = null;
        collegeWorkspace.setup = null;
        collegeWorkspace.saving = false;
        collegeWorkspace.error = "";
        if (get(currentTabId) === tabId) {
            await reloadCollegeSetup();
        }
        return (
            workspaceGeneration === generation &&
            get(currentDocumentId) === documentId &&
            collegeState.hostEnabled
        );
    } catch (error) {
        if (isCurrentWorkspace(documentId, generation)) {
            collegeWorkspace.saving = false;
            collegeWorkspace.error = errorMessage(error, "Could not apply the College setup.");
        }
        return false;
    } finally {
        if (collegeWorkspace.documentId === documentId && workspaceGeneration === generation) {
            collegeWorkspace.saving = false;
        }
    }
}
