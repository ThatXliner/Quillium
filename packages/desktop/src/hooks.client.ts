import {
    PUBLIC_POSTHOG_KEY,
    PUBLIC_RELAY_URL,
    PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    PUBLIC_SUPABASE_URL,
} from "$env/static/public";
import { logAppEvent } from "$lib/appLog";
import { readBackup, saveEmergencyBackup, saveEmergencySnapshot } from "$lib/errorGuard";
import posthog from "$lib/posthog";
import { errorBanner } from "$lib/stores";
import type { HandleClientError } from "@sveltejs/kit";

// ── Crash safety net ─────────────────────────────────────────────
// Capture unhandled errors and promise rejections before SvelteKit
// gets a chance to navigate away, so we can save a backup first.

function showCrashBanner(message: string, details?: string) {
    const hasBackup = Boolean(readBackup("crash"));
    errorBanner.set({
        message: hasBackup ? message : "Something went wrong.",
        hasBackup,
        backupType: "crash",
        details,
    });
}

if (typeof window !== "undefined") {
    // Startup environment summary. Build-time config (Supabase, relay, PostHog)
    // is baked into the bundle, so a misconfigured build is invisible until a
    // feature fails at runtime — this line makes Help → App Logs show at a
    // glance what this binary was built with.
    void logAppEvent("info", "startup", "app started", {
        version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev",
        dev: import.meta.env.DEV,
        masBuild: import.meta.env.VITE_MAS === "true",
        supabaseUrl: PUBLIC_SUPABASE_URL || "(missing)",
        supabaseKeyConfigured: Boolean(PUBLIC_SUPABASE_PUBLISHABLE_KEY),
        relayUrl: PUBLIC_RELAY_URL || "(missing)",
        posthogConfigured: Boolean(PUBLIC_POSTHOG_KEY),
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        languages: navigator.languages,
        online: navigator.onLine,
        hardwareConcurrency: navigator.hardwareConcurrency,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        locale: Intl.DateTimeFormat().resolvedOptions().locale,
        viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
        },
        screen: {
            width: window.screen.width,
            height: window.screen.height,
        },
    });

    window.addEventListener("online", () => {
        void logAppEvent("info", "lifecycle", "network became available");
    });
    window.addEventListener("offline", () => {
        void logAppEvent("warn", "lifecycle", "network became unavailable");
    });
    window.addEventListener("visibilitychange", () => {
        void logAppEvent("debug", "lifecycle", "visibility changed", {
            visibilityState: document.visibilityState,
        });
    });
    window.addEventListener("pagehide", (event) => {
        void logAppEvent("info", "lifecycle", "page hidden", {
            persisted: event.persisted,
        });
    });

    window.addEventListener("error", (event) => {
        saveEmergencyBackup(`Uncaught error: ${event.message}`);
        saveEmergencySnapshot("Before crash (auto)");
        const err = event.error instanceof Error ? event.error : new Error(event.message);
        const stack = err.stack ?? err.message;
        const details = stack.startsWith(err.name)
            ? stack
            : `${err.name}: ${err.message}\n${stack}`;
        void logAppEvent("error", "frontend", "window error", {
            message: event.message,
            source: event.filename,
            line: event.lineno,
            column: event.colno,
            stack: details,
        });
        showCrashBanner("Something went wrong. Your work has been backed up.", details);
        posthog.captureException(err);
    });

    window.addEventListener("unhandledrejection", (event) => {
        const err = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
        // Svelte's internal effect_orphan error is benign — SvelteKit's
        // generated root.svelte uses $effect.pre during async mount and
        // this can surface as an unhandled rejection in some Tauri webview
        // timing scenarios. Ignore it rather than showing a crash banner.
        if (err.message?.includes("effect_orphan")) {
            void logAppEvent("debug", "frontend", "ignored unhandled rejection", {
                name: err.name,
                message: err.message,
            });
            return;
        }
        // Supabase auth uses the browser LockManager internally. If an auth
        // request is superseded, WebKit can surface the lock abort as an
        // unhandled rejection even though the app can safely keep running.
        if (err.name === "AbortError" && err.message?.includes("Lock was stolen")) {
            void logAppEvent("debug", "frontend", "ignored unhandled rejection", {
                name: err.name,
                message: err.message,
            });
            return;
        }
        // WebKit surfaces failed fetch() calls as "Load failed" — typically from
        // PostHog analytics or session recording when offline. Non-fatal:
        // don't scare the user with a crash banner, but still report to PostHog.
        if (err.message === "Load failed") {
            void logAppEvent("warn", "frontend", "network request failed", {
                name: err.name,
                message: err.message,
            });
            posthog.captureException(err);
            return;
        }
        saveEmergencyBackup(`Unhandled promise rejection: ${err.message}`);
        saveEmergencySnapshot("Before crash (auto)");
        const stack = err.stack ?? err.message;
        const details = stack.startsWith(err.name)
            ? stack
            : `${err.name}: ${err.message}\n${stack}`;
        void logAppEvent("error", "frontend", "unhandled promise rejection", {
            name: err.name,
            message: err.message,
            stack: details,
        });
        showCrashBanner("Something went wrong. Your work has been backed up.", details);
        posthog.captureException(err);
    });
}

// ── SvelteKit route-level error handler ──────────────────────────
export const handleError: HandleClientError = async ({ error, status, message }) => {
    const err = error instanceof Error ? error : new Error(message);
    saveEmergencyBackup(`App error (${status}): ${err.message}`);
    saveEmergencySnapshot("Before crash (auto)");
    const stack = err.stack ?? `${err.message} (status ${status})`;
    const details = stack.startsWith(err.name) ? stack : `${err.name}: ${err.message}\n${stack}`;
    void logAppEvent("error", "frontend", "sveltekit client error", {
        status,
        message,
        stack: details,
    });
    showCrashBanner("Something went wrong. Your work has been backed up.", details);
    posthog.captureException(err);
    return { message, status };
};
