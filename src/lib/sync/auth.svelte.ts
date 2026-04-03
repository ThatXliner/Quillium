/**
 * auth.svelte.ts — Reactive auth state for Quillium Sync.
 *
 * Wraps Supabase Auth in a Svelte $state store.
 * Exposes: authState (reactive), login, signup, logout, loginAnonymously, restoreSession.
 */
import { getSupabase } from "./supabase";
import type { User, Session } from "@supabase/supabase-js";

type AuthState = {
    user: User | null;
    session: Session | null;
    loading: boolean;
};

export const authState: AuthState = $state({
    user: null,
    session: null,
    loading: true,
});

/**
 * Restore a previously persisted session from the keychain.
 * Call once on app startup.
 */
export async function restoreSession(): Promise<void> {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    if (data.session) {
        authState.user = data.session.user;
        authState.session = data.session;
    }
    authState.loading = false;

    // Listen for future auth state changes (token refresh, logout, etc.)
    supabase.auth.onAuthStateChange((_event, session) => {
        authState.user = session?.user ?? null;
        authState.session = session;
    });
}

/**
 * Sign in with email + password.
 * Returns null on success, error message string on failure.
 */
export async function login(email: string, password: string): Promise<string | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return error.message;
    authState.user = data.user;
    authState.session = data.session;
    return null;
}

/**
 * Create a new account with email + password.
 * Returns null on success, error message string on failure.
 */
export async function signup(email: string, password: string): Promise<string | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return error.message;
    authState.user = data.user;
    authState.session = data.session;
    return null;
}

/**
 * Sign out the current user.
 */
export async function logout(): Promise<void> {
    const supabase = getSupabase();
    await supabase.auth.signOut();
    authState.user = null;
    authState.session = null;
}

/**
 * Sign in anonymously (for collaborators joining via share link).
 * Returns null on success, error message string on failure.
 */
export async function loginAnonymously(): Promise<string | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) return error.message;
    authState.user = data.user;
    authState.session = data.session;
    return null;
}
