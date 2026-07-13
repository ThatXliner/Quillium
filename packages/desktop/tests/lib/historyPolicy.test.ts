/**
 * historyPolicy.test.ts — Release-cutoff and analytics classification tests.
 */

import {
    LEGACY_PERSIST_HISTORY_CUTOFF_MS,
    getNewDocumentUndoHistoryAnalytics,
    getUndoHistoryPolicyAnalytics,
} from "$lib/db/historyPolicy";
import { describe, expect, it } from "vitest";

describe("undo history policy analytics", () => {
    it("uses the documented July 14, 2026 UTC cutoff", () => {
        expect(new Date(LEGACY_PERSIST_HISTORY_CUTOFF_MS).toISOString()).toBe(
            "2026-07-14T00:00:00.000Z",
        );
    });

    it("classifies only persistent pre-cutoff documents as legacy", () => {
        expect(
            getUndoHistoryPolicyAnalytics({
                createdAt: LEGACY_PERSIST_HISTORY_CUTOFF_MS - 1,
                persistHistory: true,
            }),
        ).toEqual({
            persist_undo_history: true,
            undo_history_policy_source: "legacy_date_cutoff",
        });
        expect(
            getUndoHistoryPolicyAnalytics({
                createdAt: LEGACY_PERSIST_HISTORY_CUTOFF_MS,
                persistHistory: true,
            }),
        ).toEqual({
            persist_undo_history: true,
            undo_history_policy_source: "new_document_setting",
        });
        expect(
            getUndoHistoryPolicyAnalytics({
                createdAt: LEGACY_PERSIST_HISTORY_CUTOFF_MS - 1,
                persistHistory: false,
            }),
        ).toEqual({
            persist_undo_history: false,
            undo_history_policy_source: "new_document_setting",
        });
    });

    it("marks newly created documents as setting-controlled", () => {
        expect(getNewDocumentUndoHistoryAnalytics(true)).toEqual({
            persist_undo_history: true,
            undo_history_policy_source: "new_document_setting",
        });
        expect(getNewDocumentUndoHistoryAnalytics(false)).toEqual({
            persist_undo_history: false,
            undo_history_policy_source: "new_document_setting",
        });
    });
});
