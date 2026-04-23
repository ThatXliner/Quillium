/**
 * supabase.ts — Supabase client singleton for Quillium.
 *
 * Desktop app (Tauri) with no SSR, so we use @supabase/supabase-js
 * directly with localStorage storage (not @supabase/ssr).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
    PUBLIC_SUPABASE_URL,
    PUBLIC_SUPABASE_PUBLISHABLE_ANON_KEY,
} from "$env/static/public";

const SUPABASE_URL = PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = PUBLIC_SUPABASE_PUBLISHABLE_ANON_KEY;

export const supabaseConfigured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

if (!supabaseConfigured) {
    console.warn("[supabase] Missing environment variables — auth features will not work");
}

export const supabase: SupabaseClient | null = supabaseConfigured
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: {
              storage: localStorage,
              autoRefreshToken: true,
              persistSession: true, // per D-14: session via localStorage
              detectSessionInUrl: false, // no OAuth redirects for v1
          },
      })
    : null;
