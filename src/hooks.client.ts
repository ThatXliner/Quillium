/**
 * hooks.client.ts — Client-side initialization and error handling.
 *
 * This SvelteKit client hook runs once when the app boots in the
 * browser. It performs two tasks:
 *
 * 1. Initializes PostHog analytics so that page views, custom
 *    events (e.g., "tutorial_completed"), and unhandled exceptions
 *    are captured automatically.
 *
 * 2. Exports `handleError`, which SvelteKit calls on every
 *    unhandled client-side error. We forward the error to PostHog
 *    before returning a generic error payload.
 */
import posthog from "posthog-js";
import type { HandleClientError } from "@sveltejs/kit";

declare const __APP_VERSION__: string;

const posthogKey = import.meta.env.PUBLIC_POSTHOG_KEY;
const posthogHost = import.meta.env.PUBLIC_POSTHOG_HOST;

// Initialize PostHog analytics at app boot.
if (posthogKey && posthogHost) {
    posthog.init(posthogKey, {
        api_host: posthogHost,
        ui_host: "https://us.posthog.com",
        defaults: "2026-01-30",
        capture_exceptions: true,
    });
}

const appVersion = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
posthog.register({ app_version: appVersion });

/**
 * SvelteKit client error handler — forwards unhandled exceptions
 * to PostHog for monitoring, then returns the original message
 * and status so SvelteKit can display its default error page.
 */
export const handleError: HandleClientError = async ({ error, status, message }) => {
    posthog.captureException(error);
    return { message, status };
};
