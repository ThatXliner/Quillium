import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { invoke } from "@tauri-apps/api/core";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./env";

const KEYCHAIN_PREFIX = "supabase:";

export const keychainStorage = {
    async getItem(key: string): Promise<string | null> {
        return invoke<string | null>("get_api_key", {
            provider: KEYCHAIN_PREFIX + key,
        });
    },
    async setItem(key: string, value: string): Promise<void> {
        await invoke<void>("set_api_key", {
            provider: KEYCHAIN_PREFIX + key,
            key: value,
        });
    },
    async removeItem(key: string): Promise<void> {
        await invoke<void>("delete_api_key", {
            provider: KEYCHAIN_PREFIX + key,
        });
    },
};

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
    if (client) return client;
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            storage: keychainStorage,
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: false,
        },
    });
    return client;
}
