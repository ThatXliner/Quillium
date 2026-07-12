/** webPreviewEnv.test.ts — Guards the required-vs-optional Web Preview CI contract. */
import { describe, expect, it } from "vitest";
import { resolveWebPreviewEnvironment } from "./webPreviewEnv";

describe("resolveWebPreviewEnvironment", () => {
    it("keeps the default browser command infrastructure-free", () => {
        expect(resolveWebPreviewEnvironment({})).toEqual({
            enabled: false,
            required: false,
            url: "",
            serviceRoleKey: "",
            publishableKey: "",
        });
    });

    it("accepts the legacy anon-key alias and normalizes the API URL", () => {
        expect(
            resolveWebPreviewEnvironment({
                E2E_SUPABASE_URL: "http://127.0.0.1:54321/",
                E2E_SUPABASE_SERVICE_ROLE_KEY: "service-role",
                E2E_SUPABASE_ANON_KEY: "anon",
            }),
        ).toEqual({
            enabled: true,
            required: false,
            url: "http://127.0.0.1:54321",
            serviceRoleKey: "service-role",
            publishableKey: "anon",
        });
    });

    it("fails instead of silently skipping when explicitly required", () => {
        expect(() =>
            resolveWebPreviewEnvironment({
                E2E_WEB_PREVIEW_REQUIRED: "1",
                E2E_SUPABASE_URL: "http://127.0.0.1:54321",
            }),
        ).toThrowError(
            "E2E_WEB_PREVIEW_REQUIRED=1 but required Web Preview environment is missing: " +
                "E2E_SUPABASE_SERVICE_ROLE_KEY, " +
                "E2E_SUPABASE_PUBLISHABLE_KEY (or E2E_SUPABASE_ANON_KEY)",
        );
    });
});
