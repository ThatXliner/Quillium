import posthog from "$lib/posthog";
import type { HandleClientError } from "@sveltejs/kit";

export const handleError: HandleClientError = async ({ error, status, message }) => {
    posthog.captureException(error);
    return { message, status };
};
