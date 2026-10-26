/**
 * deletionHistory.ts — Thresholds and rolling activity tracking for deletion safeguards.
 *
 * Sentence-sized deletions earn a pre-change history snapshot. Repeated deletions are
 * accumulated per draft so the editor can gently suggest revisions without nagging.
 */

export const DELETION_HISTORY_MIN_CHARS = 20;
export const DELETION_HISTORY_MIN_WORDS = 4;
export const DELETION_BURST_WINDOW_MS = 60_000;
export const DELETION_BURST_MIN_CHARS = 200;
export const DELETION_BURST_MIN_WORDS = 35;

export interface DeletionAmount {
    chars: number;
    words: number;
}

interface TimedDeletion extends DeletionAmount {
    at: number;
}

interface DraftDeletionActivity {
    entries: TimedDeletion[];
    lastSuggestionAt: number | null;
}

export function shouldSaveBeforeDeletion(amount: DeletionAmount): boolean {
    return amount.chars >= DELETION_HISTORY_MIN_CHARS || amount.words >= DELETION_HISTORY_MIN_WORDS;
}

/**
 * Tracks meaningful deletion volume in a rolling window. A draft can trigger at most
 * one suggestion per window, even if every subsequent keystroke remains over the threshold.
 */
export class DeletionBurstTracker {
    private readonly activityByDraft = new Map<string, DraftDeletionActivity>();

    record(draftId: string, amount: DeletionAmount, now = Date.now()): boolean {
        if (amount.chars <= 0 && amount.words <= 0) return false;

        const activity = this.activityByDraft.get(draftId) ?? {
            entries: [],
            lastSuggestionAt: null,
        };
        const windowStart = now - DELETION_BURST_WINDOW_MS;
        activity.entries = activity.entries.filter((entry) => entry.at > windowStart);
        activity.entries.push({ ...amount, at: now });
        this.activityByDraft.set(draftId, activity);

        const totals = activity.entries.reduce<DeletionAmount>(
            (sum, entry) => ({ chars: sum.chars + entry.chars, words: sum.words + entry.words }),
            { chars: 0, words: 0 },
        );
        const isLargeBurst =
            totals.chars >= DELETION_BURST_MIN_CHARS || totals.words >= DELETION_BURST_MIN_WORDS;
        const canSuggestAgain =
            activity.lastSuggestionAt === null ||
            now - activity.lastSuggestionAt >= DELETION_BURST_WINDOW_MS;

        if (!isLargeBurst || !canSuggestAgain) return false;
        activity.lastSuggestionAt = now;
        return true;
    }
}
