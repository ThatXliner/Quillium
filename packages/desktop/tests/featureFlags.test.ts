import { isNovelNovemberFlagEnabled } from "$lib/featureFlags.svelte";
import { describe, expect, it } from "vitest";

describe("novel-november feature flag", () => {
    it("fails closed for missing, false, and variant values", () => {
        expect(isNovelNovemberFlagEnabled(undefined)).toBe(false);
        expect(isNovelNovemberFlagEnabled(false)).toBe(false);
        expect(isNovelNovemberFlagEnabled("control")).toBe(false);
        expect(isNovelNovemberFlagEnabled(true)).toBe(true);
    });
});
