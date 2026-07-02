/**
 * errorGuard.ts — Safety net for suspicious or catastrophic state changes.
 *
 * Three responsibilities:
 *
 * 1. **Suspicious-change detection**: `isSuspiciousDeletion` is a pure
 *    function that compares old and new document text and returns true if
 *    the change looks unintentional (e.g. a large deletion not caused by
 *    the user explicitly selecting and deleting). When detected, the UI
 *    directs the user to the version history page to restore a snapshot.
 *
 *    `isSuspiciousAnnotationChange` performs the analogous check for
 *    annotations: returns true if a large number of annotations were
 *    removed or modified in a single transaction batch.
 *
 * 2. **Crash recovery**: `saveEmergencyBackup` is called from the global
 *    error handler and from window.onerror / unhandledrejection to capture
 *    whatever text was in the editor at the moment of the crash.
 *
 * Crash backups live in localStorage under:
 *   - "quillium_backup_crash"  — latest crash snapshot
 *
 * Each value is a JSON string:
 * {
 *   timestamp: number,      // Date.now()
 *   documentTitle: string,
 *   documentText: string,
 *   reason: string,         // human-readable reason for the backup
 * }
 */

import { get } from "svelte/store";
import {
    documentContent,
    currentDocumentTitle,
    editorView,
    currentDraftId,
    lastPersistedEventId,
} from "./stores";
import type { GenericAnnotation } from "$lib/editor/plugins/annotations";
import { savedFields } from "$lib/editor/extensions";
import { createNamedSnapshot } from "$lib/db";
import posthog from "$lib/posthog";

export type BackupEntry = {
    timestamp: number;
    documentTitle: string;
    documentText: string;
    reason: string;
};

const CRASH_BACKUP_KEY = "quillium_backup_crash";

/**
 * The minimum fraction of the document that must be deleted in a single
 * transaction batch before we consider it suspicious.
 * e.g. 0.2 = 20% of the current document deleted in one go.
 */
const SUSPICIOUS_DELETION_RATIO = 0.2;

/**
 * Minimum absolute character count that must be deleted before we bother
 * checking the ratio. Prevents false positives on tiny documents.
 */
const SUSPICIOUS_DELETION_MIN_CHARS = 100;

function writeBackup(key: string, entry: BackupEntry): boolean {
    try {
        localStorage.setItem(key, JSON.stringify(entry));
        return true;
    } catch {
        // localStorage full — try progressively smaller truncations
        const attempts: Array<{ len: number; label: string }> = [
            { len: Math.floor(entry.documentText.length * 0.75), label: "75%" },
            { len: Math.floor(entry.documentText.length * 0.5), label: "50%" },
            { len: Math.floor(entry.documentText.length * 0.25), label: "25%" },
            { len: Math.floor(entry.documentText.length * 0.1), label: "10%" },
            { len: 100_000, label: "100k chars" },
            { len: 10_000, label: "10k chars" },
            { len: 1_000, label: "1k chars" },
        ];
        for (const { len, label } of attempts) {
            if (len >= entry.documentText.length) continue; // skip if not actually smaller
            try {
                const truncated: BackupEntry = {
                    ...entry,
                    documentText: entry.documentText.slice(-len),
                    reason: entry.reason + ` [truncated to ${label}]`,
                };
                localStorage.setItem(key, JSON.stringify(truncated));
                return true;
            } catch {
                continue;
            }
        }
        return false; // localStorage not available or completely full
    }
}

export function readBackup(key: "crash"): BackupEntry | null {
    try {
        const raw = localStorage.getItem(CRASH_BACKUP_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as BackupEntry;
    } catch {
        return null;
    }
}

export function clearBackup(key: "crash"): void {
    try {
        localStorage.removeItem(CRASH_BACKUP_KEY);
    } catch {
        // ignore
    }
}

/**
 * Pure detection function: returns true if the change from oldText to
 * newText looks like a suspiciously large unintentional deletion.
 * Does NOT write any backup — the version history snapshots serve as
 * the recovery mechanism.
 */
export function isSuspiciousDeletion(oldText: string, newText: string): boolean {
    const deleted = oldText.length - newText.length;
    if (deleted < SUSPICIOUS_DELETION_MIN_CHARS) return false;
    if (deleted / oldText.length < SUSPICIOUS_DELETION_RATIO) return false;
    return true;
}

/**
 * Minimum number of annotations that must be removed in a single
 * transaction batch before we consider it suspicious.
 */
const SUSPICIOUS_ANNOTATION_REMOVAL_MIN = 3;

/**
 * Minimum fraction of annotations that must be removed in a single
 * transaction batch before we consider it suspicious.
 * e.g. 0.25 = 25% of annotations removed at once.
 */
const SUSPICIOUS_ANNOTATION_REMOVAL_RATIO = 0.25;

/**
 * Pure detection function: returns true if annotations were suspiciously
 * mass-removed or mass-modified in a single transaction batch.
 *
 * @param oldCount - number of annotations before the transaction
 * @param newCount - number of annotations after the transaction
 */
export function isSuspiciousAnnotationChange(oldCount: number, newCount: number): boolean {
    const removed = oldCount - newCount;
    if (removed < SUSPICIOUS_ANNOTATION_REMOVAL_MIN) return false;
    if (removed / oldCount < SUSPICIOUS_ANNOTATION_REMOVAL_RATIO) return false;
    return true;
}

/**
 * Counts direct children (nested annotations) inside a single VersionState blob.
 * The blob is an opaque EditorState.toJSON(nestedSavedFields) object, so nested
 * annotations live under the "annotationField" key as a record of raw annotations.
 */
function countNestedAnnotations(version: object): number {
    const af = (version as Record<string, unknown>)["annotationField"];
    if (af == null || typeof af !== "object") return 0;
    return Object.keys(af as object).length;
}

/**
 * Checks whether a removed annotation had deep nested content that represents
 * significant invested work. Returns true if any removed annotation had:
 *   - More than 3 direct child annotations (across all its versions), OR
 *   - At least 1 grandchild annotation (a child that itself has nested annotations)
 *
 * This catches cases where a single top-level revision is removed but contained
 * a rich tree of sub-annotations that would be silently lost.
 */
export function isDeepAnnotationLoss(
    oldAnnotations: Record<number, GenericAnnotation>,
    newAnnotations: Record<number, GenericAnnotation>,
): boolean {
    for (const [id, annotation] of Object.entries(oldAnnotations)) {
        // Only care about annotations that were removed
        if (id in newAnnotations) continue;
        // Only revisions can have nested annotations (via VersionState blobs)
        if (annotation._type !== "revision") continue;

        const versions: object[] = (annotation as { versions: object[] }).versions;
        let totalChildren = 0;

        for (const version of versions) {
            const af = (version as Record<string, unknown>)["annotationField"];
            if (af == null || typeof af !== "object") continue;
            const children = Object.values(af as Record<string, unknown>);
            totalChildren += children.length;

            // Check for grandchildren: any child that is itself a revision with nested annotations
            for (const child of children) {
                if (child == null || typeof child !== "object") continue;
                const childObj = child as Record<string, unknown>;
                if (childObj._type !== "revision") continue;
                const childVersions = childObj.versions;
                if (!Array.isArray(childVersions)) continue;
                for (const cv of childVersions) {
                    if (countNestedAnnotations(cv as object) > 0) return true;
                }
            }
        }

        if (totalChildren > 3) return true;
    }
    return false;
}

/**
 * Saves an emergency plain-text backup from the current store state.
 * Call this from crash handlers (global error, unhandledrejection, etc.).
 *
 * @param reason - short description of why the backup was triggered
 * @returns true if the backup was written successfully
 */
export function saveEmergencyBackup(reason: string): boolean {
    const text = get(documentContent);
    const title = get(currentDocumentTitle);
    if (!text) return false; // nothing to back up

    return writeBackup(CRASH_BACKUP_KEY, {
        timestamp: Date.now(),
        documentTitle: title,
        documentText: text,
        reason,
    });
}

/**
 * Creates a version-history snapshot from the current editor state so
 * the user can restore from it via the version history panel.
 * Called alongside saveEmergencyBackup from crash handlers.
 */
export function saveEmergencySnapshot(label: string): void {
    const view = get(editorView);
    const draftId = get(currentDraftId);
    const eventId = get(lastPersistedEventId);
    if (!view || !draftId) return;

    try {
        const stateJson = JSON.stringify(view.state.toJSON(savedFields));
        createNamedSnapshot(draftId, stateJson, eventId, label).catch((e) => {
            console.error(e);
            posthog.captureException(e instanceof Error ? e : new Error(String(e)));
        });
    } catch {
        // Best-effort — don't let snapshot failures mask the original crash
    }
}

// Clean up stale auto-backup key from previous versions
try {
    localStorage.removeItem("quillium_backup_auto");
} catch {
    // ignore
}
