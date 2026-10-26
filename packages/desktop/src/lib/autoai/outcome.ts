/** outcome.ts - Typed, user-facing result of the most recent AutoAI review. */

export type AutoAIReviewOutcome = {
    documentId: string | null;
    draftId: string | null;
    status: "applied" | "clear" | "discarded" | "failed";
    appliedCount: number;
    duplicateCount: number;
    rejectedCount: number;
    completedAt: number;
};

export function autoAIOutcomeLabel(outcome: AutoAIReviewOutcome): string {
    if (outcome.status === "discarded") return "Last review discarded after the draft changed";
    if (outcome.status === "failed") return "Last review failed";
    if (outcome.status === "applied") {
        const noun = outcome.appliedCount === 1 ? "note" : "notes";
        const duplicateSuffix =
            outcome.duplicateCount > 0 ? `, ${outcome.duplicateCount} already covered` : "";
        return `Last review added ${outcome.appliedCount} ${noun}${duplicateSuffix}`;
    }
    if (outcome.duplicateCount > 0) {
        const noun = outcome.duplicateCount === 1 ? "concern was" : "concerns were";
        return `No new notes; ${outcome.duplicateCount} ${noun} already covered`;
    }
    if (outcome.rejectedCount > 0) {
        const noun = outcome.rejectedCount === 1 ? "result was" : "results were";
        return `No notes added; ${outcome.rejectedCount} ${noun} safely skipped`;
    }
    return "Last review found no issues";
}
