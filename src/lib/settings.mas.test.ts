import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("MAS settings defaults", () => {
    beforeEach(() => {
        localStorage.clear();
        vi.resetModules();
        vi.doUnmock("$lib/settings.svelte");
    });

    afterEach(() => {
        vi.resetModules();
        vi.doUnmock("$lib/platform");
        vi.doUnmock("$lib/settings.svelte");
    });

    it("defaults analytics and update checks off before consent", async () => {
        vi.doMock("$lib/platform", () => ({
            MAS_BUILD: true,
            readMasAnalyticsConsent: () => null,
        }));

        const { appSettings } = await import("$lib/settings.svelte");
        expect(appSettings.analyticsEnabled).toBe(false);
        expect(appSettings.checkForUpdates).toBe(false);
    });

    it("forces legacy MAS settings back to analytics off without consent", async () => {
        localStorage.setItem(
            "quillium-app-settings",
            JSON.stringify({ analyticsEnabled: true, checkForUpdates: true }),
        );
        vi.doMock("$lib/platform", () => ({
            MAS_BUILD: true,
            readMasAnalyticsConsent: () => null,
        }));

        const { appSettings } = await import("$lib/settings.svelte");
        expect(appSettings.analyticsEnabled).toBe(false);
        expect(appSettings.checkForUpdates).toBe(false);
    });

    it("allows analytics when MAS consent was granted", async () => {
        vi.doMock("$lib/platform", () => ({
            MAS_BUILD: true,
            readMasAnalyticsConsent: () => "granted",
        }));

        const { appSettings } = await import("$lib/settings.svelte");
        expect(appSettings.analyticsEnabled).toBe(true);
        expect(appSettings.checkForUpdates).toBe(false);
    });
});
