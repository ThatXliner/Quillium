// state.svelte.ts — Per-tab College setup loading, persistence, and guards.
//
// The database row is keyed by (documentId, tabId). The setup JSON itself is
// target-neutral so duplicate-document remapping can copy it safely. Reads and
// writes are guarded by the current target and a generation counter; a late
// response from another tab must never become the active setup.

import { getCollegeTabSetup, setCollegeTabSetup } from "$lib/db";
import { currentDocumentId, currentTabId } from "$lib/stores";
import { untrack } from "svelte";
import { derived, get } from "svelte/store";
import {
    type CollegeSetup,
    CollegeSetupParseError,
    cloneCollegeSetup,
    parseCollegeSetup,
    serializeCollegeSetup,
} from "./model";

export type CollegeStateStatus = "idle" | "loading" | "ready" | "error" | "unsupported";

export type CollegeState = {
    documentId: string | null;
    tabId: string | null;
    setup: CollegeSetup | null;
    status: CollegeStateStatus;
    error: string;
    saving: boolean;
    hostEnabled: boolean;
};

export type CollegeSetupTarget = {
    documentId: string | null;
    tabId: string | null;
};

export const collegeState = $state<CollegeState>({
    documentId: null,
    tabId: null,
    setup: null,
    status: "idle",
    error: "",
    saving: false,
    // The host owns this flag. It is true for legacy callers that do not mount
    // a sidebar host, and Sidebar updates it from the active panel registry.
    hostEnabled: true,
});

let effectsInitialized = false;
let effectsCleanup: (() => void) | null = null;
let generation = 0;
const pendingWrites = new Map<string, Promise<void>>();
let onEffectiveSetupChange: (() => void) | null = null;

function currentTarget(): CollegeSetupTarget {
    return {
        documentId: get(currentDocumentId),
        tabId: get(currentTabId),
    };
}

function hasConcreteTarget(target: CollegeSetupTarget): target is {
    documentId: string;
    tabId: string;
} {
    return target.documentId !== null && target.tabId !== null;
}

function targetsEqual(a: CollegeSetupTarget, b: CollegeSetupTarget): boolean {
    return a.documentId === b.documentId && a.tabId === b.tabId;
}

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

function isCurrentStateTarget(target: CollegeSetupTarget): boolean {
    return (
        targetsEqual(target, currentTarget()) &&
        collegeState.documentId === target.documentId &&
        collegeState.tabId === target.tabId
    );
}

function enqueueWrite(
    target: { documentId: string; tabId: string },
    operation: () => Promise<void>,
): Promise<void> {
    const key = `${target.documentId}\u0000${target.tabId}`;
    const previous = pendingWrites.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    pendingWrites.set(key, current);
    void current.then(
        () => {
            if (pendingWrites.get(key) === current) pendingWrites.delete(key);
        },
        () => {
            if (pendingWrites.get(key) === current) pendingWrites.delete(key);
        },
    );
    return current;
}

async function loadTarget(target: { documentId: string; tabId: string }, loadGeneration: number) {
    try {
        const key = `${target.documentId}\u0000${target.tabId}`;
        const pendingWrite = pendingWrites.get(key);
        if (pendingWrite) await pendingWrite.catch(() => undefined);
        const raw = await getCollegeTabSetup(target.documentId, target.tabId);
        if (
            loadGeneration !== generation ||
            !isCurrentStateTarget(target) ||
            collegeState.status !== "loading"
        ) {
            return;
        }

        collegeState.setup = raw === null ? null : parseCollegeSetup(raw);
        collegeState.status = "ready";
        collegeState.error = "";
    } catch (error) {
        if (loadGeneration !== generation || !isCurrentStateTarget(target)) return;
        collegeState.setup = null;
        collegeState.status =
            error instanceof CollegeSetupParseError && error.kind === "unsupported"
                ? "unsupported"
                : "error";
        collegeState.error = errorMessage(error, "Could not load the College setup.");
    }
}

function beginLoad(target: CollegeSetupTarget): Promise<void> {
    generation += 1;
    const loadGeneration = generation;
    collegeState.documentId = target.documentId;
    collegeState.tabId = target.tabId;
    collegeState.setup = null;
    collegeState.error = "";
    collegeState.saving = false;

    if (!hasConcreteTarget(target)) {
        collegeState.status = "idle";
        return Promise.resolve();
    }

    collegeState.status = "loading";
    return loadTarget(target, loadGeneration);
}

/**
 * Subscribe to the active document/tab pair. Call once from Sidebar; the
 * enclosing Svelte effect owns teardown, so a removed sidebar cannot leave a
 * late DB response able to update the next host instance.
 */
export function useCollegeEffects(onChange?: () => void): void {
    $effect(() => {
        if (effectsInitialized) return;
        effectsInitialized = true;
        onEffectiveSetupChange = onChange ?? null;

        const scope = derived([currentDocumentId, currentTabId], ([$documentId, $tabId]) => ({
            documentId: $documentId,
            tabId: $tabId,
        }));
        const unsubscribe = scope.subscribe((target) => untrack(() => void beginLoad(target)));
        effectsCleanup = () => {
            generation += 1;
            unsubscribe();
            effectsCleanup = null;
            effectsInitialized = false;
            onEffectiveSetupChange = null;
        };
        return effectsCleanup;
    });
}

/** Reload the current tab setup after a load or parse error. */
export async function reloadCollegeSetup(): Promise<void> {
    const target = currentTarget();
    if (!effectsInitialized || !hasConcreteTarget(target)) return;
    await beginLoad(target);
}

function rejectForTarget(message: string): never {
    throw new Error(message);
}

function validateSaveTarget(target: CollegeSetupTarget, setup: CollegeSetup | null): void {
    const current = currentTarget();
    if (!targetsEqual(target, current)) {
        rejectForTarget("The College setup target changed. Select the current tab and try again.");
    }
    if (!hasConcreteTarget(target)) {
        rejectForTarget("Open a document tab before saving a College setup.");
    }
    if (collegeState.saving) rejectForTarget("A College setup save is already in progress.");

    const unsupportedRemoval = setup === null && collegeState.status === "unsupported";
    if (collegeState.status !== "ready" && !unsupportedRemoval) {
        rejectForTarget(
            collegeState.status === "loading"
                ? "The College setup is still loading. Try again when it is ready."
                : collegeState.error ||
                      "The College setup is unavailable. Reload it before saving.",
        );
    }
}

/**
 * Persist a validated setup for one exact document/tab pair. The old state is
 * retained until SQLite confirms the write, and stale writes never commit into
 * a new target.
 */
export async function saveCollegeSetup(
    target: CollegeSetupTarget,
    setup: CollegeSetup | null,
): Promise<void> {
    validateSaveTarget(target, setup);
    const concreteTarget = target as { documentId: string; tabId: string };
    const validated = setup === null ? null : parseCollegeSetup(cloneCollegeSetup(setup));
    const serialized = validated === null ? null : serializeCollegeSetup(validated);
    const previousStatus = collegeState.status;
    const saveGeneration = ++generation;
    collegeState.saving = true;
    try {
        onEffectiveSetupChange?.();
    } catch {
        // A host callback (usually stopAllAi) is best effort and must not
        // prevent the durable setup write.
    }

    try {
        await enqueueWrite(concreteTarget, async () => {
            // Recheck immediately before dispatch. A target switch while an
            // earlier write is draining must not write a stale setup.
            if (!isCurrentStateTarget(target)) {
                throw new Error("The College setup target changed before saving.");
            }
            await setCollegeTabSetup(concreteTarget.documentId, concreteTarget.tabId, serialized);
        });
        if (
            saveGeneration !== generation ||
            !isCurrentStateTarget(target) ||
            collegeState.saving !== true
        ) {
            return;
        }
        collegeState.setup = validated === null ? null : cloneCollegeSetup(validated);
        collegeState.status = "ready";
        collegeState.error = "";
    } catch (error) {
        if (saveGeneration === generation && isCurrentStateTarget(target)) {
            collegeState.status = previousStatus;
            collegeState.error = errorMessage(error, "Could not save the College setup.");
        }
        throw error;
    } finally {
        if (saveGeneration === generation && isCurrentStateTarget(target)) {
            collegeState.saving = false;
        }
    }
}

/** Return the loaded setup for the current target, including paused setups. */
function getCurrentLoadedSetup(): CollegeSetup | null {
    const target = currentTarget();
    if (
        !hasConcreteTarget(target) ||
        !isCurrentStateTarget(target) ||
        collegeState.status !== "ready" ||
        collegeState.setup === null
    ) {
        return null;
    }
    return cloneCollegeSetup(collegeState.setup);
}

/** Return the active, host-enabled setup only when it matches both stores. */
export function getActiveCollegeSetup(): CollegeSetup | null {
    if (!collegeState.hostEnabled) return null;
    const setup = getCurrentLoadedSetup();
    return setup?.active ? setup : null;
}

/**
 * Guard a request that would otherwise silently lose tab-specific context.
 * Legacy tests and callers without College effects remain device-only.
 */
export function assertCollegeContextReady(): void {
    if (!effectsInitialized || !collegeState.hostEnabled) return;
    const target = currentTarget();
    if (!hasConcreteTarget(target)) return;
    if (!isCurrentStateTarget(target) || collegeState.saving || collegeState.status !== "ready") {
        throw new Error(
            collegeState.error ||
                (collegeState.saving
                    ? "The College setup is being saved. Try again when it is ready."
                    : collegeState.status === "loading"
                      ? "The College setup is still loading. Try again shortly."
                      : "The College setup is unavailable. Reload it before requesting AI help."),
        );
    }
}

/** Clone and persist a patch against the currently loaded setup. */
export async function updateActiveCollegeSetup(patch: Partial<CollegeSetup>): Promise<void> {
    const target = currentTarget();
    const current = getCurrentLoadedSetup();
    if (!current) {
        throw new Error("No loaded College setup is available for this tab.");
    }
    const next = parseCollegeSetup({ ...current, ...patch });
    try {
        await saveCollegeSetup(target, next);
    } catch (error) {
        // A settings control may finish after the user switches tabs. The
        // old operation is obsolete; do not surface its failure in the new
        // tab or let a general Readers/settings catch mutate that tab's UI.
        if (isCurrentStateTarget(target)) throw error;
    }
}
