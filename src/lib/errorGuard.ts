/**
 * errorGuard.ts — Safety net for suspicious or catastrophic state changes.
 *
 * Two responsibilities:
 *
 * 1. **Pre-change backup**: Before any transaction is persisted,
 *    `checkForSuspiciousChange` compares the old and new document text.
 *    If the change looks unintentional (e.g. a large deletion not caused by
 *    the user explicitly selecting and deleting), it saves a plain-text
 *    backup to localStorage *before* the write lands in the DB.
 *
 * 2. **Crash recovery**: `saveEmergencyBackup` is called from the global
 *    error handler and from window.onerror / unhandledrejection to capture
 *    whatever text was in the editor at the moment of the crash.
 *
 * Backups live in localStorage under two keys:
 *   - "quillium_backup_auto"   — latest suspicious-change snapshot
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

const AUTO_BACKUP_KEY = "quillium_backup_auto";
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

function writeBackup(key: string, entry: BackupEntry): void {
    try {
        localStorage.setItem(key, JSON.stringify(entry));
    } catch {
        // localStorage full or not available — silently ignore
    }
}

export function readBackup(key: "auto" | "crash"): BackupEntry | null {
    const storageKey = key === "auto" ? AUTO_BACKUP_KEY : CRASH_BACKUP_KEY;
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return null;
        return JSON.parse(raw) as BackupEntry;
    } catch {
        return null;
    }
}

export function clearBackup(key: "auto" | "crash"): void {
    const storageKey = key === "auto" ? AUTO_BACKUP_KEY : CRASH_BACKUP_KEY;
    try {
        localStorage.removeItem(storageKey);
    } catch {
        // ignore
    }
}

/**
 * Fast pre-check using document lengths only. Returns false when a suspicious
 * deletion is impossible given the lengths, avoiding the cost of `toString()`
 * on large documents. When this returns true, call `checkForSuspiciousChange`
 * with the actual text to confirm and save a backup.
 *
 * @param oldLength - character length of the document before the transaction
 * @param newLength - character length of the document after the transaction
 */
export function couldBeSuspicious(oldLength: number, newLength: number): boolean {
    const deleted = oldLength - newLength;
    if (deleted <= 0) return false;
    if (deleted < SUSPICIOUS_DELETION_MIN_CHARS) return false;
    if (deleted / oldLength < SUSPICIOUS_DELETION_RATIO) return false;
    return true;
}

/**
 * Called from the listeners updateListener *before* a transaction is
 * persisted. Compares old and new document length to detect suspiciously
 * large deletions.
 *
 * @param oldText - document text before the transaction batch
 * @param newText - document text after the transaction batch
 * @returns true if a backup was saved (change was suspicious)
 */
export function checkForSuspiciousChange(oldText: string, newText: string): boolean {
    const deleted = oldText.length - newText.length;
    if (deleted < SUSPICIOUS_DELETION_MIN_CHARS) return false;
    if (deleted / oldText.length < SUSPICIOUS_DELETION_RATIO) return false;

    const title = get(currentDocumentTitle);
    writeBackup(AUTO_BACKUP_KEY, {
        timestamp: Date.now(),
        documentTitle: title,
        documentText: oldText,
        reason: `Large deletion detected: ${deleted} characters removed (${Math.round((deleted / oldText.length) * 100)}% of document)`,
    });
    return true;
}

/**
 * Saves an emergency plain-text backup from the current store state.
 * Call this from crash handlers (global error, unhandledrejection, etc.).
 *
 * @param reason - short description of why the backup was triggered
 */
export function saveEmergencyBackup(reason: string): void {
    const text = get(documentContent);
    const title = get(currentDocumentTitle);
    if (!text) return; // nothing to back up

    writeBackup(CRASH_BACKUP_KEY, {
        timestamp: Date.now(),
        documentTitle: title,
        documentText: text,
        reason,
    });
}
