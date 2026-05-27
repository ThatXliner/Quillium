/**
 * auth.svelte.ts — Reactive auth state store.
 *
 * Uses Svelte 5 $state runes for reactive user tracking.
 * Initializes via initAuth() on app mount, subscribes to auth changes.
 */
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from "./supabase";

type AuthConnectionState = "idle" | "connecting" | "online" | "offline";

const AUTH_INIT_ATTEMPTS = 3;
const AUTH_INIT_TIMEOUT_MS = 2500;

// Reactive state
let user = $state<User | null>(null);
let session = $state<Session | null>(null);
let loading = $state(true);
let connectionState = $state<AuthConnectionState>("idle");
let initialized = false;
let initRun = 0;

function shouldUseScreenshotAuthMock(): boolean {
    return (
        import.meta.env.DEV &&
        typeof window !== "undefined" &&
        Boolean((window as unknown as Record<string, unknown>).__QUILLIUM_SCREENSHOT_AUTH_ONLINE__)
    );
}

function forceAnonymousOnlineState(): void {
    initRun++;
    session = null;
    user = null;
    connectionState = "online";
    loading = false;
    initialized = true;
}

async function canReachAuthServer(): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AUTH_INIT_TIMEOUT_MS);

    try {
        const response = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
            cache: "no-store",
            headers: {
                apikey: SUPABASE_ANON_KEY,
            },
            signal: controller.signal,
        });
        return response.ok || response.status < 500;
    } catch (error) {
        console.error("[auth] Failed to reach auth server:", error);
        return false;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function fetchCurrentSession(): Promise<Session | null> {
    const result = await supabase!.auth.getSession();
    if (result.error) throw result.error;
    return result.data.session;
}

async function loadSessionWithRetries(run: number): Promise<boolean> {
    connectionState = "connecting";
    loading = true;

    for (let attempt = 1; attempt <= AUTH_INIT_ATTEMPTS; attempt += 1) {
        if (await canReachAuthServer()) break;
        console.error(`[auth] Auth server unreachable (attempt ${attempt}/${AUTH_INIT_ATTEMPTS})`);
        if (attempt === AUTH_INIT_ATTEMPTS) {
            if (run !== initRun) return false;

            session = null;
            user = null;
            connectionState = "offline";
            loading = false;
            return false;
        }
    }

    if (run !== initRun) return false;

    try {
        const existingSession = await fetchCurrentSession();
        if (run !== initRun) return false;

        session = existingSession;
        user = existingSession?.user ?? null;
    } catch (error) {
        console.error("[auth] Failed to get session:", error);
        if (run !== initRun) return false;

        session = null;
        user = null;
    }

    connectionState = "online";
    loading = false;
    return true;
}

/**
 * Initialize auth state. Call once at app startup.
 * Checks for existing session and subscribes to auth changes.
 */
export async function initAuth(): Promise<void> {
    if (shouldUseScreenshotAuthMock()) {
        forceAnonymousOnlineState();
        return;
    }

    if (initialized) return;
    initialized = true;

    if (!supabase) {
        loading = false;
        connectionState = "offline";
        return;
    }

    const run = ++initRun;
    await loadSessionWithRetries(run);

    supabase.auth.onAuthStateChange((_event: AuthChangeEvent, newSession: Session | null) => {
        session = newSession;
        user = newSession?.user ?? null;
        connectionState = "online";
        loading = false;
    });
}

/**
 * Retry the initial auth connection after the app has decided it is offline.
 */
export async function reconnectAuth(): Promise<boolean> {
    if (shouldUseScreenshotAuthMock()) {
        forceAnonymousOnlineState();
        return true;
    }

    if (!supabase) {
        connectionState = "offline";
        loading = false;
        return false;
    }

    const run = ++initRun;
    return loadSessionWithRetries(run);
}

/**
 * DEV-only helper for the debug panel: force the auth UI into its offline state.
 */
export function debugForceAuthOffline(): void {
    if (!import.meta.env.DEV) return;
    initRun++;
    session = null;
    user = null;
    connectionState = "offline";
    loading = false;
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
export function getConnectionState() {
    return connectionState;
}
export function isOffline() {
    return connectionState === "offline";
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
    return user?.user_metadata?.display_name ?? user?.user_metadata?.full_name ?? null;
}

/**
 * Get user email.
 */
export function getUserEmail(): string | null {
    return user?.email ?? null;
}

/**
 * Get the best available human-readable name for the current user.
 * Falls back to email or a generic label when auth/profile metadata is missing.
 */
export function getCurrentUserName(): string {
    const displayName = getDisplayName()?.trim();
    if (displayName) return displayName;

    const email = getUserEmail()?.trim();
    if (email) {
        const localPart = email.split("@")[0]?.trim();
        if (localPart) return localPart;
        return email;
    }

    return "User";
}
