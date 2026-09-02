import { validateEditorialActionTarget } from "$lib/ai/editorialTarget";
import { describe, expect, it } from "vitest";

const snapshot = {
    documentId: "document-a",
    draftId: "draft-a",
    selectedText: "A deliberately repeated sentence.",
    selectedTextRange: { from: 20, to: 53 },
};

describe("validateEditorialActionTarget", () => {
    it("accepts a permitted action inside the captured selection", () => {
        expect(
            validateEditorialActionTarget({
                snapshot,
                current: {
                    documentId: "document-a",
                    draftId: "draft-a",
                    documentText: `01234567890123456789${snapshot.selectedText}`,
                },
                targetText: "deliberately repeated",
                action: "suggestion",
                allowedActions: ["suggestion"],
            }),
        ).toEqual({ ok: true });
    });

    it("rejects a result after switching drafts", () => {
        expect(
            validateEditorialActionTarget({
                snapshot,
                current: { documentId: "document-a", draftId: "draft-b" },
                targetText: "deliberately repeated",
                action: "comment",
                allowedActions: ["comment"],
            }),
        ).toEqual({ ok: false, reason: "draft-changed" });
    });

    it("rejects an action outside the captured selection", () => {
        expect(
            validateEditorialActionTarget({
                snapshot,
                current: { documentId: "document-a", draftId: "draft-a" },
                targetText: "A different paragraph",
                action: "revision",
                allowedActions: ["revision"],
            }),
        ).toEqual({ ok: false, reason: "outside-selection" });
    });

    it("rejects a result when the selected source changed in place", () => {
        expect(
            validateEditorialActionTarget({
                snapshot,
                current: {
                    documentId: "document-a",
                    draftId: "draft-a",
                    documentText: "x".repeat(80),
                },
                targetText: "deliberately repeated",
                action: "suggestion",
                allowedActions: ["suggestion"],
            }),
        ).toEqual({ ok: false, reason: "selection-changed" });
    });

    it("rejects a tool that the turn did not permit", () => {
        expect(
            validateEditorialActionTarget({
                snapshot,
                current: { documentId: "document-a", draftId: "draft-a" },
                targetText: "deliberately repeated",
                action: "revision",
                allowedActions: ["comment"],
            }),
        ).toEqual({ ok: false, reason: "action-forbidden" });
    });
});
