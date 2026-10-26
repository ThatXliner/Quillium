import {
    DELETION_BURST_WINDOW_MS,
    DeletionBurstTracker,
    shouldSaveBeforeDeletion,
} from "$lib/editor/deletionHistory";
import { describe, expect, it } from "vitest";

describe("deletion history safeguards", () => {
    it("saves sentence-sized deletions but ignores ordinary backspaces", () => {
        expect(shouldSaveBeforeDeletion({ chars: 1, words: 1 })).toBe(false);
        expect(shouldSaveBeforeDeletion({ chars: 19, words: 4 })).toBe(true);
        expect(shouldSaveBeforeDeletion({ chars: 20, words: 2 })).toBe(true);
    });

    it("suggests revisions after heavy deletion activity within one minute", () => {
        const tracker = new DeletionBurstTracker();

        expect(tracker.record("draft-a", { chars: 80, words: 12 }, 1_000)).toBe(false);
        expect(tracker.record("draft-a", { chars: 80, words: 12 }, 20_000)).toBe(false);
        expect(tracker.record("draft-a", { chars: 40, words: 6 }, 40_000)).toBe(true);
        expect(tracker.record("draft-a", { chars: 40, words: 6 }, 45_000)).toBe(false);
    });

    it("keeps drafts separate and allows another suggestion after the cooldown", () => {
        const tracker = new DeletionBurstTracker();

        expect(tracker.record("draft-a", { chars: 200, words: 1 }, 1_000)).toBe(true);
        expect(tracker.record("draft-b", { chars: 200, words: 1 }, 2_000)).toBe(true);
        expect(
            tracker.record("draft-a", { chars: 200, words: 1 }, 1_000 + DELETION_BURST_WINDOW_MS),
        ).toBe(true);
    });
});
