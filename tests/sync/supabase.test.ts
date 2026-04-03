import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";

vi.mock("$lib/sync/env", () => ({
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_ANON_KEY: "test-anon-key",
}));

const mockCreateClient = vi.hoisted(() => vi.fn(() => ({ auth: {} })));
vi.mock("@supabase/supabase-js", () => ({
    createClient: mockCreateClient,
}));

describe("keychainStorage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("getItem calls get_api_key with prefixed key", async () => {
        let calledWith: Record<string, unknown> = {};
        mockIPC((cmd, args) => {
            if (cmd === "get_api_key") {
                calledWith = args as Record<string, unknown>;
                return "stored-value";
            }
        });

        const { keychainStorage } = await import("$lib/sync/supabase");
        const result = await keychainStorage.getItem("sb-auth-token");
        expect(calledWith.provider).toBe("supabase:sb-auth-token");
        expect(result).toBe("stored-value");
    });

    it("setItem calls set_api_key with prefixed key", async () => {
        let calledWith: Record<string, unknown> = {};
        mockIPC((cmd, args) => {
            if (cmd === "set_api_key") {
                calledWith = args as Record<string, unknown>;
            }
        });

        const { keychainStorage } = await import("$lib/sync/supabase");
        await keychainStorage.setItem("sb-auth-token", "new-value");
        expect(calledWith.provider).toBe("supabase:sb-auth-token");
        expect(calledWith.key).toBe("new-value");
    });

    it("removeItem calls delete_api_key with prefixed key", async () => {
        let calledWith: Record<string, unknown> = {};
        mockIPC((cmd, args) => {
            if (cmd === "delete_api_key") {
                calledWith = args as Record<string, unknown>;
            }
        });

        const { keychainStorage } = await import("$lib/sync/supabase");
        await keychainStorage.removeItem("sb-auth-token");
        expect(calledWith.provider).toBe("supabase:sb-auth-token");
    });

    it("getItem returns null when no entry exists", async () => {
        mockIPC((cmd) => {
            if (cmd === "get_api_key") return null;
        });

        const { keychainStorage } = await import("$lib/sync/supabase");
        const result = await keychainStorage.getItem("nonexistent");
        expect(result).toBeNull();
    });
});

describe("getSupabase", () => {
    it("creates client with keychain storage and correct URL", async () => {
        const { getSupabase } = await import("$lib/sync/supabase");
        getSupabase();
        expect(mockCreateClient).toHaveBeenCalledWith(
            "https://test.supabase.co",
            "test-anon-key",
            expect.objectContaining({
                auth: expect.objectContaining({
                    storage: expect.any(Object),
                    autoRefreshToken: true,
                    persistSession: true,
                }),
            }),
        );
    });

    it("returns the same instance on subsequent calls", async () => {
        const { getSupabase } = await import("$lib/sync/supabase");
        const a = getSupabase();
        const b = getSupabase();
        expect(a).toBe(b);
    });
});
