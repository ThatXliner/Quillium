import { featureFlagEnablesWritingAnalytics } from "$lib/stats/featureFlag";
import { describe, expect, it } from "vitest";

describe("featureFlagEnablesWritingAnalytics", () => {
    it("enables the dashboard only for an explicit boolean true", () => {
        expect(featureFlagEnablesWritingAnalytics(true)).toBe(true);
        expect(featureFlagEnablesWritingAnalytics(false)).toBe(false);
        expect(featureFlagEnablesWritingAnalytics(undefined)).toBe(false);
        expect(featureFlagEnablesWritingAnalytics("true")).toBe(false);
    });
});
