import posthog from "posthog-js";
import type { HandleClientError } from "@sveltejs/kit";
import { PUBLIC_POSTHOG_KEY, PUBLIC_POSTHOG_HOST } from "$env/static/public";

posthog.init(PUBLIC_POSTHOG_KEY, {
	api_host: PUBLIC_POSTHOG_HOST,
	ui_host: "https://us.posthog.com",
	defaults: "2026-01-30",
	capture_exceptions: true,
});

export const handleError: HandleClientError = async ({
	error,
	status,
	message,
}) => {
	posthog.captureException(error);
	return { message, status };
};
