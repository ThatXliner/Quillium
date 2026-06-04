import { beforeEach, describe, expect, it } from "vitest";
import {
    MAS_ANALYTICS_CONSENT_KEY,
    hasMasAnalyticsConsentChoice,
    persistMasAnalyticsConsent,
    readMasAnalyticsConsent,
} from "./platform";

describe("platform MAS analytics consent helpers", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("returns null when no consent choice has been stored", () => {
        expect(readMasAnalyticsConsent()).toBeNull();
        expect(hasMasAnalyticsConsentChoice()).toBe(false);
    });

    it("stores granted consent", () => {
        persistMasAnalyticsConsent(true);
        expect(localStorage.getItem(MAS_ANALYTICS_CONSENT_KEY)).toBe("granted");
        expect(readMasAnalyticsConsent()).toBe("granted");
        expect(hasMasAnalyticsConsentChoice()).toBe(true);
    });

    it("stores declined consent", () => {
        persistMasAnalyticsConsent(false);
        expect(localStorage.getItem(MAS_ANALYTICS_CONSENT_KEY)).toBe("declined");
        expect(readMasAnalyticsConsent()).toBe("declined");
    });
});
