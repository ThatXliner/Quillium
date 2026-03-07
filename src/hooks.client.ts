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
import { PUBLIC_POSTHOG_KEY, PUBLIC_POSTHOG_HOST } from "$env/static/public";
import { version } from "../package.json";

// Initialize PostHog analytics at app boot.
posthog.init(PUBLIC_POSTHOG_KEY, {
	api_host: PUBLIC_POSTHOG_HOST,
	ui_host: "https://us.posthog.com",
	defaults: "2026-01-30",
	capture_exceptions: true,
});

posthog.register({ app_version: version });

/**
 * SvelteKit client error handler — forwards unhandled exceptions
 * to PostHog for monitoring, then returns the original message
 * and status so SvelteKit can display its default error page.
 */
export const handleError: HandleClientError = async ({
	error,
	status,
	message,
}) => {
	posthog.captureException(error);
	return { message, status };
};
