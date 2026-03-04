import posthog from "posthog-js";
import type { HandleClientError } from "@sveltejs/kit";

export async function init() {
	posthog.init(import.meta.env.PUBLIC_POSTHOG_KEY, {
		api_host: import.meta.env.PUBLIC_POSTHOG_HOST,
		ui_host: "https://us.posthog.com",
		defaults: "2026-01-30",
		capture_exceptions: true,
	});
}

export const handleError: HandleClientError = async ({
	error,
	status,
	message,
}) => {
	posthog.captureException(error);
	return { message, status };
};
