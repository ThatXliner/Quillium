import posthog from "$lib/posthog";
import type { HandleClientError } from "@sveltejs/kit";
import { saveEmergencyBackup, readBackup } from "$lib/errorGuard";
import { errorBanner } from "$lib/stores";

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
        const err = event.error instanceof Error ? event.error : new Error(event.message);
        const stack = err.stack ?? err.message;
        const details = stack.startsWith(err.name)
            ? stack
            : `${err.name}: ${err.message}\n${stack}`;
        showCrashBanner("Something went wrong. Your work has been backed up.", details);
        posthog.captureException(err);
    });

    window.addEventListener("unhandledrejection", (event) => {
        const err = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
        // Svelte's internal effect_orphan error is benign — SvelteKit's
        // generated root.svelte uses $effect.pre during async mount and
        // this can surface as an unhandled rejection in some Tauri webview
        // timing scenarios. Ignore it rather than showing a crash banner.
        if (err.message?.includes("effect_orphan")) return;
        saveEmergencyBackup(`Unhandled promise rejection: ${err.message}`);
        const stack = err.stack ?? err.message;
        const details = stack.startsWith(err.name)
            ? stack
            : `${err.name}: ${err.message}\n${stack}`;
        showCrashBanner("Something went wrong. Your work has been backed up.", details);
        posthog.captureException(err);
    });
}

// ── SvelteKit route-level error handler ──────────────────────────
export const handleError: HandleClientError = async ({ error, status, message }) => {
    const err = error instanceof Error ? error : new Error(message);
    saveEmergencyBackup(`App error (${status}): ${err.message}`);
    const stack = err.stack ?? `${err.message} (status ${status})`;
    const details = stack.startsWith(err.name) ? stack : `${err.name}: ${err.message}\n${stack}`;
    showCrashBanner("Something went wrong. Your work has been backed up.", details);
    posthog.captureException(err);
    return { message, status };
};
