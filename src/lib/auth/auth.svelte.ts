/**
 * auth.svelte.ts — Reactive auth state store.
 *
 * Uses Svelte 5 $state runes for reactive user tracking.
 * Initializes via initAuth() on app mount, subscribes to auth changes.
 */
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "./supabase";

// Reactive state
let user = $state<User | null>(null);
let session = $state<Session | null>(null);
let loading = $state(true);
let initialized = false;

/**
 * Initialize auth state. Call once at app startup.
 * Checks for existing session and subscribes to auth changes.
 */
export async function initAuth(): Promise<void> {
    if (initialized) return;
    initialized = true;

    if (!supabase) {
        loading = false;
        return;
    }

    const {
        data: { session: existingSession },
        error,
    } = await supabase.auth.getSession();
    if (error) {
        console.error("[auth] Failed to get session:", error);
    }
    session = existingSession;
    user = existingSession?.user ?? null;
    loading = false;

    supabase.auth.onAuthStateChange((_event: AuthChangeEvent, newSession: Session | null) => {
        session = newSession;
        user = newSession?.user ?? null;
    });
}

/**
 * Sign up with email, password, and display name.
 * Display name is stored in raw_user_meta_data and extracted by the
 * database trigger to populate public.users.display_name.
 */
export async function signUp(email: string, password: string, displayName: string) {
    if (!supabase) throw new Error("Supabase not configured");
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: { display_name: displayName }, // per D-16
        },
    });
    if (error) throw error;
    return data;
}

/**
 * Sign in with email and password.
 */
export async function signIn(email: string, password: string) {
    if (!supabase) throw new Error("Supabase not configured");
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
    });
    if (error) throw error;
    return data;
}

/**
 * Sign out the current user.
 */
export async function signOut() {
    if (!supabase) throw new Error("Supabase not configured");
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
}

/**
 * Sign in anonymously with a display name.
 * Per D-20: Display name passed via options.data (maps to raw_user_meta_data).
 * Per D-24: Session automatically persists via localStorage (already configured in supabase.ts).
 */
export async function signInAnonymously(displayName: string) {
    if (!supabase) throw new Error("Supabase not configured");
    const { data, error } = await supabase.auth.signInAnonymously({
        options: {
            data: { display_name: displayName },
        },
    });
    if (error) throw error;
    return data;
}

// Reactive getters
export function getUser() {
    return user;
}
export function getSession() {
    return session;
}
export function isLoading() {
    return loading;
}
export function isAuthenticated() {
    return !!user;
}

/**
 * Check if the current user is an anonymous user.
 * Supabase sets is_anonymous: true on anonymous user objects.
 */
export function isAnonymous(): boolean {
    return user?.is_anonymous === true;
}

/**
 * Get display name from user metadata.
 */
export function getDisplayName(): string | null {
    return user?.user_metadata?.display_name ?? null;
}

/**
 * Get user email.
 */
export function getUserEmail(): string | null {
    return user?.email ?? null;
}
