/**
 * supabase.ts — Supabase client singleton for Quillium.
 *
 * Desktop app (Tauri) with no SSR, so we use @supabase/supabase-js
 * directly with localStorage storage (not @supabase/ssr).
 */
import { processLock } from "@supabase/auth-js";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL;
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigured = !!(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

if (!supabaseConfigured) {
    console.warn("[supabase] Missing environment variables — auth features will not work");
}

// supabase-js issues fetches with no timeout. A request that never settles
// (dead TCP connection after sleep-wake or a network switch) wedges the
// processLock: the in-flight token refresh holds the lock forever, every
// later getSession() queues behind it, and manual Reconnect can never
// succeed until the app restarts. Bounding every request guarantees the
// lock is always released, so the next reconnect attempt gets a fresh try.
const FETCH_TIMEOUT_MS = 15_000;

const fetchWithTimeout: typeof fetch = (input, init) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(
        () => controller.abort(new DOMException("supabase fetch timed out", "TimeoutError")),
        FETCH_TIMEOUT_MS,
    );
    // Preserve caller-initiated aborts.
    if (init?.signal?.aborted) {
        controller.abort(init.signal.reason);
    } else {
        init?.signal?.addEventListener("abort", () => controller.abort(init.signal?.reason));
    }
    return fetch(input, { ...init, signal: controller.signal }).finally(() =>
        clearTimeout(timeoutId),
    );
};

export const supabase: SupabaseClient | null = supabaseConfigured
    ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: {
              fetch: fetchWithTimeout,
          },
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
