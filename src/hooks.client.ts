import posthog from "$lib/posthog";
import type { HandleClientError } from "@sveltejs/kit";
import { saveEmergencyBackup, readBackup } from "$lib/errorGuard";
import { errorBanner } from "$lib/stores";

// ── Crash safety net ─────────────────────────────────────────────
// Capture unhandled errors and promise rejections before SvelteKit
// gets a chance to navigate away, so we can save a backup first.

function showCrashBanner(error: unknown) {
    const err = error instanceof Error ? error : null;
    const msg = err ? err.message : String(error);
    const hasBackup = Boolean(readBackup("crash"));
    errorBanner.set({
        message: hasBackup
            ? `Something went wrong: ${msg}. Your work has been backed up.`
            : `Something went wrong: ${msg}`,
        stack: err?.stack,
        hasBackup,
        backupType: "crash",
    });
}

if (typeof window !== "undefined") {
    window.addEventListener("error", (event) => {
        const err = event.error ?? new Error(event.message);
        console.error("[Quillium] Uncaught error:", err);
        saveEmergencyBackup(`Uncaught error: ${event.message}`);
        showCrashBanner(err);
        posthog.captureException(err);
    });

    window.addEventListener("unhandledrejection", (event) => {
        const err = event.reason instanceof Error
            ? event.reason
            : new Error(String(event.reason));
        console.error("[Quillium] Unhandled rejection:", err);
        saveEmergencyBackup(`Unhandled promise rejection: ${err.message}`);
        showCrashBanner(err);
        posthog.captureException(err);
    });
}

// ── SvelteKit route-level error handler ──────────────────────────
export const handleError: HandleClientError = async ({ error, status, message }) => {
    const err = error instanceof Error ? error : new Error(message);
    console.error("[Quillium] App error:", err);
    saveEmergencyBackup(`App error (${status}): ${err.message}`);
    showCrashBanner(err);
    posthog.captureException(err);
    return { message, status };
};
