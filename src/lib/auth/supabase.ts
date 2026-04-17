/**
 * supabase.ts — Supabase client singleton for Quillium.
 *
 * Desktop app (Tauri) with no SSR, so we use @supabase/supabase-js
 * directly with localStorage storage (not @supabase/ssr).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn("[supabase] Missing environment variables — auth features will not work");
}

export const supabase: SupabaseClient = createClient(
    SUPABASE_URL ?? "",
    SUPABASE_ANON_KEY ?? "",
    {
        auth: {
            storage: localStorage,
            autoRefreshToken: true,
            persistSession: true, // per D-14: session via localStorage
            detectSessionInUrl: false, // no OAuth redirects for v1
        },
    },
);
