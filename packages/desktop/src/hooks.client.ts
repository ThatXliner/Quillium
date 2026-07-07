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
