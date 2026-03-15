import posthog from "$lib/posthog";
import type { HandleClientError } from "@sveltejs/kit";
import { saveEmergencyBackup } from "$lib/errorGuard";
import { errorBanner } from "$lib/stores";

// ── Crash safety net ─────────────────────────────────────────────
// Capture unhandled errors and promise rejections before SvelteKit
// gets a chance to navigate away, so we can save a backup first.

if (typeof window !== "undefined") {
    window.addEventListener("error", (event) => {
        saveEmergencyBackup(`Uncaught error: ${event.message}`);
        errorBanner.set({
            message: "Something went wrong. Your work has been backed up.",
            hasBackup: true,
            backupType: "crash",
        });
        posthog.captureException(event.error ?? new Error(event.message));
    });

    window.addEventListener("unhandledrejection", (event) => {
        const err = event.reason instanceof Error
            ? event.reason
            : new Error(String(event.reason));
        saveEmergencyBackup(`Unhandled promise rejection: ${err.message}`);
        errorBanner.set({
            message: "Something went wrong. Your work has been backed up.",
            hasBackup: true,
            backupType: "crash",
        });
        posthog.captureException(err);
    });
}

// ── SvelteKit route-level error handler ──────────────────────────
export const handleError: HandleClientError = async ({ error, status, message }) => {
    const err = error instanceof Error ? error : new Error(message);
    saveEmergencyBackup(`App error (${status}): ${err.message}`);
    errorBanner.set({
        message: "Something went wrong. Your work has been backed up.",
        hasBackup: true,
        backupType: "crash",
    });
    posthog.captureException(err);
    return { message, status };
};
