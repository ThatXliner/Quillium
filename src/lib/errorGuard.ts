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
import { documentContent, currentDocumentTitle } from "./stores";

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
        return false; // localStorage full or not available
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

// Clean up stale auto-backup key from previous versions
try {
    localStorage.removeItem("quillium_backup_auto");
} catch {
    // ignore
}
