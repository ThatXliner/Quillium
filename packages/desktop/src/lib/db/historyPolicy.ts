/**
 * historyPolicy.ts — Undo-history policy analytics and release cutoff.
 *
 * Documents created before Quillium 0.22 do not contain creator-version
 * metadata, so creation time is the temporary proxy for legacy grandfathering.
 * Keep this UTC boundary synchronized with `db/migrations.rs` until the legacy
 * path and its analytics are retired.
 */

import type { DocumentMeta } from "./types";

export const LEGACY_PERSIST_HISTORY_CUTOFF_MS = Date.UTC(2026, 6, 14);

export type UndoHistoryPolicySource = "legacy_date_cutoff" | "new_document_setting";

export type UndoHistoryPolicyAnalytics = {
    persist_undo_history: boolean;
    undo_history_policy_source: UndoHistoryPolicySource;
};

export function getUndoHistoryPolicyAnalytics(
    document: Pick<DocumentMeta, "createdAt" | "persistHistory">,
): UndoHistoryPolicyAnalytics {
    return {
        persist_undo_history: document.persistHistory,
        undo_history_policy_source:
            document.persistHistory && document.createdAt < LEGACY_PERSIST_HISTORY_CUTOFF_MS
                ? "legacy_date_cutoff"
                : "new_document_setting",
    };
}

export function getNewDocumentUndoHistoryAnalytics(
    persistHistory: boolean,
): UndoHistoryPolicyAnalytics {
    return {
        persist_undo_history: persistHistory,
        undo_history_policy_source: "new_document_setting",
    };
}
