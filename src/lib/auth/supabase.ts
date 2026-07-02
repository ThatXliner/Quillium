/**
 * supabase.ts — Supabase client singleton for Quillium.
 *
 * Desktop app (Tauri) with no SSR, so we use @supabase/supabase-js
 * directly with localStorage storage (not @supabase/ssr).
 */
import { processLock } from "@supabase/auth-js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY } from "$env/static/public";

export const SUPABASE_URL = PUBLIC_SUPABASE_URL;
export const SUPABASE_PUBLISHABLE_KEY = PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigured = !!(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

if (!supabaseConfigured) {
    console.warn("[supabase] Missing environment variables — auth features will not work");
}

export const supabase: SupabaseClient | null = supabaseConfigured
    ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          auth: {
              storage: localStorage,
              autoRefreshToken: true,
              persistSession: true, // per D-14: session via localStorage
              detectSessionInUrl: false, // no OAuth redirects for v1
              // Each Tauri window is its own webview but shares the localStorage
              // origin. supabase-js defaults to a Web Locks (navigator.locks)
              // auth-token lock to coordinate across tabs; with multiple windows
              // they contend for `lock:sb-*-auth-token` and throw
              // LockAcquireTimeoutError ("lock stolen"). processLock serializes
              // token refresh within a window without the cross-context Web Lock.
              lock: processLock,
          },
      })
    : null;
