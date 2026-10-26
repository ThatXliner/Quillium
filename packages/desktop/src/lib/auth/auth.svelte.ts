/**
 * auth.svelte.ts — Reactive auth state store.
 *
 * Uses Svelte 5 $state runes for reactive user tracking.
 * Initializes via initAuth() on app mount, subscribes to auth changes.
 */
import { logAppEvent } from "$lib/appLog";
import posthog from "$lib/posthog";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabase } from "./supabase";

/**
 * Links the anonymous PostHog identifier to the account when a real
 * (non-anonymous) session is active, so we can help troubleshoot issues
 * for signed-in accounts. See the Privacy Policy's account-linking carve-out.
 * Never identifies anonymous Supabase sessions; resets on sign-out so the
 * device reverts to an unlinked identifier.
 */
function syncPostHogIdentity(nextUser: User | null): void {
    if (nextUser && !nextUser.is_anonymous) {
        posthog.identify(nextUser.id);
    } else if (!nextUser) {
        posthog.reset();
    }
}

type AuthConnectionState = "idle" | "connecting" | "online" | "offline";

const AUTH_INIT_ATTEMPTS = 3;
const AUTH_INIT_TIMEOUT_MS = 2500;
const AUTH_RETRY_DELAY_MS = 750;
const SESSION_FETCH_TIMEOUT_MS = 10_000;
const SIGN_OUT_SERVER_TIMEOUT_MS = 5_000;

/**
 * getSession() can stall indefinitely: supabase-js serializes it behind the
 * processLock and initializePromise, both of which can be wedged by an
 * in-flight token refresh on a bad connection. This marks the race timeout so
 * callers can land in "offline" (retryable) instead of hanging the UI forever.
 */
class SessionFetchTimeoutError extends Error {
    constructor() {
        super(`auth session fetch timed out after ${SESSION_FETCH_TIMEOUT_MS}ms`);
        this.name = "SessionFetchTimeoutError";
    }
}

// Reactive state
let user = $state<User | null>(null);
let session = $state<Session | null>(null);
let loading = $state(true);
let connectionState = $state<AuthConnectionState>("idle");
let initialized = false;
let initRun = 0;

/**
 * Whether supabase-js has a session persisted in localStorage. Tracked as
 * reactive state (localStorage itself isn't reactive) so the offline UI can
 * offer "Sign out" even when the in-memory user is null — failed session
 * loads null `user` before landing offline, but the persisted session is
 * still there and is exactly what a stuck user needs to be able to reset.
 */
let persistedSessionPresent = $state(readPersistedSessionPresence());

function readPersistedSessionPresence(): boolean {
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith("sb-") && key.endsWith("-auth-token")) return true;
        }
    } catch {
        // localStorage unavailable
    }
    return false;
}

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
                apikey: SUPABASE_PUBLISHABLE_KEY,
            },
            signal: controller.signal,
        });
        return response.ok || response.status < 500;
    } catch (error) {
        console.error("[auth] Failed to reach auth server:", error);
        void logAppEvent("warn", "auth", "health check failed", { error: String(error) });
        return false;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function fetchCurrentSession(): Promise<Session | null> {
    if (!supabase) return null;

    const result = await supabase.auth.getSession();
    if (result.error) throw result.error;
    return result.data.session;
}

function fetchCurrentSessionWithTimeout(): Promise<Session | null> {
    return Promise.race([
        fetchCurrentSession(),
        new Promise<never>((_, reject) => {
            setTimeout(() => reject(new SessionFetchTimeoutError()), SESSION_FETCH_TIMEOUT_MS);
        }),
    ]);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadSessionWithRetries(run: number): Promise<boolean> {
    connectionState = "connecting";
    loading = true;

    for (let attempt = 1; attempt <= AUTH_INIT_ATTEMPTS; attempt += 1) {
        if (await canReachAuthServer()) break;
        console.error(`[auth] Auth server unreachable (attempt ${attempt}/${AUTH_INIT_ATTEMPTS})`);
        void logAppEvent("warn", "auth", "auth server unreachable", {
            attempt,
            of: AUTH_INIT_ATTEMPTS,
        });
        if (attempt === AUTH_INIT_ATTEMPTS) {
            if (run !== initRun) return false;

            session = null;
            user = null;
            connectionState = "offline";
            loading = false;
            void logAppEvent("error", "auth", "marked offline after failed health checks", {
                attempts: AUTH_INIT_ATTEMPTS,
            });
            return false;
        }
        // Back-to-back retries all land inside the same network blip; give
        // transient failures (sleep-wake, DNS warmup) a moment to clear.
        await sleep(AUTH_RETRY_DELAY_MS);
        if (run !== initRun) return false;
    }

    if (run !== initRun) return false;

    try {
        const existingSession = await fetchCurrentSessionWithTimeout();
        if (run !== initRun) return false;

        session = existingSession;
        user = existingSession?.user ?? null;
        persistedSessionPresent = readPersistedSessionPresence();
        syncPostHogIdentity(user);
        void logAppEvent("info", "auth", "session loaded", {
            hasSession: !!existingSession,
        });
    } catch (error) {
        console.error("[auth] Failed to get session:", error);
        void logAppEvent("error", "auth", "session fetch failed", {
            error: String(error),
            timedOut: error instanceof SessionFetchTimeoutError,
        });
        if (run !== initRun) return false;

        if (error instanceof SessionFetchTimeoutError) {
            // Land in "offline" so the UI keeps a clickable Reconnect button;
            // leaving loading=true would pin the disabled "Reconnecting" pill
            // with no way for the user to retry.
            session = null;
            user = null;
            connectionState = "offline";
            loading = false;
            return false;
        }

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
        void logAppEvent("error", "auth", "supabase not configured — auth disabled", {
            urlPresent: Boolean(SUPABASE_URL),
            keyPresent: Boolean(SUPABASE_PUBLISHABLE_KEY),
        });
        loading = false;
        connectionState = "offline";
        return;
    }

    const run = ++initRun;
    await loadSessionWithRetries(run);

    supabase.auth.onAuthStateChange((event: AuthChangeEvent, newSession: Session | null) => {
        void logAppEvent("info", "auth", "auth state change", {
            event,
            hasSession: !!newSession,
        });
        session = newSession;
        user = newSession?.user ?? null;
        persistedSessionPresent = !!newSession;
        syncPostHogIdentity(user);
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
        void logAppEvent("error", "auth", "supabase not configured — reconnect impossible");
        connectionState = "offline";
        loading = false;
        return false;
    }

    void logAppEvent("info", "auth", "manual reconnect requested");
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
    if (!supabase) {
        void logAppEvent("error", "auth", "sign-up failed: supabase not configured");
        throw new Error("Supabase not configured");
    }
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: { display_name: displayName }, // per D-16
        },
    });
    if (error) {
        // Error message only — never credentials.
        void logAppEvent("error", "auth", "sign-up failed", { error: String(error) });
        throw error;
    }
    void logAppEvent("info", "auth", "sign-up succeeded");
    return data;
}

/**
 * Sign in with email and password.
 */
export async function signIn(email: string, password: string) {
    if (!supabase) {
        void logAppEvent("error", "auth", "sign-in failed: supabase not configured");
        throw new Error("Supabase not configured");
    }
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
    });
    if (error) {
        // Error message only — never credentials.
        void logAppEvent("error", "auth", "sign-in failed", { error: String(error) });
        throw error;
    }
    void logAppEvent("info", "auth", "sign-in succeeded");
    return data;
}

/**
 * Remove supabase-js's persisted session from localStorage directly.
 * supabase-js stores it under `sb-<project-ref>-auth-token` (plus
 * companion `sb-` keys); we clear by prefix so this works without
 * knowing the project ref.
 */
function clearPersistedSession(): void {
    try {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith("sb-")) keys.push(key);
        }
        for (const key of keys) {
            localStorage.removeItem(key);
        }
    } catch {
        // localStorage unavailable — nothing to clear
    }
}

/**
 * Sign out the current user. Local-first: the server-side token revoke is
 * best-effort and bounded, and the local session is always cleared even
 * when the server can't be reached. Previously a wedged connection left
 * users stuck signed in with no way to reset auth — the offline pill
 * replaced the account menu, and supabase.auth.signOut() both queued
 * behind the wedged lock and refused to drop the session on network error.
 */
export async function signOut() {
    let serverError: unknown = null;
    if (supabase) {
        try {
            const result = await Promise.race([
                supabase.auth.signOut(),
                sleep(SIGN_OUT_SERVER_TIMEOUT_MS).then(() => ({
                    error: new Error("server sign-out timed out"),
                })),
            ]);
            serverError = result.error;
        } catch (error) {
            serverError = error;
        }
    }

    if (serverError) {
        console.warn("[auth] Server sign-out failed; clearing local session anyway:", serverError);
        void logAppEvent("warn", "auth", "server sign-out failed; clearing local session", {
            error: String(serverError),
        });
    }

    // Local cleanup runs unconditionally. When the client is wedged or
    // offline, onAuthStateChange won't fire — update state directly and
    // invalidate any in-flight reconnect run so it can't resurrect the
    // session we just dropped.
    clearPersistedSession();
    persistedSessionPresent = false;
    initRun++;
    session = null;
    user = null;
    syncPostHogIdentity(null);
    loading = false;
}

/**
 * Sign in anonymously with a display name.
 * Per D-20: Display name passed via options.data (maps to raw_user_meta_data).
 * Per D-24: Session automatically persists via localStorage (already configured in supabase.ts).
 */
export async function signInAnonymously(displayName: string) {
    if (!supabase) {
        void logAppEvent("error", "auth", "anonymous sign-in failed: supabase not configured");
        throw new Error("Supabase not configured");
    }
    const { data, error } = await supabase.auth.signInAnonymously({
        options: {
            data: { display_name: displayName },
        },
    });
    if (error) {
        void logAppEvent("error", "auth", "anonymous sign-in failed", { error: String(error) });
        throw error;
    }
    void logAppEvent("info", "auth", "anonymous sign-in succeeded");
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
/**
 * Whether there is any auth state to reset: an in-memory user or a session
 * still persisted in localStorage. Failed session loads null the in-memory
 * user before landing offline, so isAuthenticated() alone under-reports.
 */
export function hasAuthStateToReset() {
    return !!user || persistedSessionPresent;
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
