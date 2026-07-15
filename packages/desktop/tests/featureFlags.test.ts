import {
    NOVEL_NOVEMBER_FEATURE_FLAG,
    isBooleanFeatureEnabled,
    resolveFeatureGate,
} from "$lib/featureFlags";
import { describe, expect, it } from "vitest";

describe("PostHog feature gates", () => {
    it("uses the shared novel-november flag key", () => {
        expect(NOVEL_NOVEMBER_FEATURE_FLAG).toBe("novel-november");
    });

    it("defaults closed for missing, disabled, and variant values", () => {
        expect(isBooleanFeatureEnabled(undefined)).toBe(false);
        expect(isBooleanFeatureEnabled(false)).toBe(false);
        expect(isBooleanFeatureEnabled("control")).toBe(false);
    });

    it("opens only for an explicitly enabled boolean flag", () => {
        expect(isBooleanFeatureEnabled(true)).toBe(true);
    });

    it("stays closed when PostHog reports a flag-loading error", () => {
        expect(resolveFeatureGate(true, true)).toBe(false);
        expect(resolveFeatureGate(true, false)).toBe(true);
    });
});
