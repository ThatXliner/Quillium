/**
 * UpdateBanner — unit-level DOM checks.
 *
 * SvelteKit + Vitest 4 force-resolves Svelte to its SSR bundle, which makes
 * client-side component mounting impossible without a separate vitest config.
 * Until that's addressed, Svelte component rendering is tested via Playwright
 * in tests/e2e/updateBanner.pw.ts instead.
 *
 * This file is kept as a placeholder so the test path is reserved and so we
 * can add non-rendering unit tests for update-related logic here later.
 */

import { describe, it, expect } from "vitest";

describe("UpdateBanner (placeholder)", () => {
    it("component file exists", async () => {
        // Verify the module is importable (even if we can't mount it)
        const mod = await import("$lib/ui/UpdateBanner.svelte");
        expect(mod.default).toBeDefined();
    });
});
