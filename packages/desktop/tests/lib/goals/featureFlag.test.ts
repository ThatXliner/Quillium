import { isNovelNovemberFlagEnabled } from "$lib/goals/featureFlag";
import { describe, expect, it } from "vitest";

describe("Novel November feature flag", () => {
    it("enables writing goals only for an explicit boolean true", () => {
        expect(isNovelNovemberFlagEnabled(true)).toBe(true);
        expect(isNovelNovemberFlagEnabled(false)).toBe(false);
        expect(isNovelNovemberFlagEnabled(undefined)).toBe(false);
        expect(isNovelNovemberFlagEnabled("control")).toBe(false);
    });
});
