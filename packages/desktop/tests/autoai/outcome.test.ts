import { autoAIOutcomeLabel } from "$lib/autoai/outcome";
import { describe, expect, it } from "vitest";

describe("autoAIOutcomeLabel", () => {
    it("reports applied and duplicate work without implying a text edit", () => {
        expect(
            autoAIOutcomeLabel({
                documentId: "doc-a",
                draftId: "draft-a",
                status: "applied",
                appliedCount: 2,
                duplicateCount: 1,
                rejectedCount: 0,
                completedAt: 1,
            }),
        ).toBe("Last review added 2 notes, 1 already covered");
    });

    it("distinguishes clear, safely skipped, stale, and failed reviews", () => {
        expect(
            autoAIOutcomeLabel({
                documentId: "doc-a",
                draftId: "draft-a",
                status: "clear",
                appliedCount: 0,
                duplicateCount: 0,
                rejectedCount: 2,
                completedAt: 1,
            }),
        ).toBe("No notes added; 2 results were safely skipped");
        expect(
            autoAIOutcomeLabel({
                documentId: "doc-a",
                draftId: "draft-a",
                status: "discarded",
                appliedCount: 0,
                duplicateCount: 0,
                rejectedCount: 0,
                completedAt: 1,
            }),
        ).toContain("draft changed");
        expect(
            autoAIOutcomeLabel({
                documentId: "doc-a",
                draftId: "draft-a",
                status: "failed",
                appliedCount: 0,
                duplicateCount: 0,
                rejectedCount: 0,
                completedAt: 1,
            }),
        ).toBe("Last review failed");
    });
});
