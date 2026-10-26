import { dev } from "$app/environment";
import { env } from "$env/dynamic/public";
import type { HandleClientError } from "@sveltejs/kit";
import posthog from "posthog-js";

export async function init() {
    if (dev || window.location.pathname === "/join") return;
    if (!env.PUBLIC_POSTHOG_PROJECT_TOKEN) return;

    posthog.init(env.PUBLIC_POSTHOG_PROJECT_TOKEN, {
        api_host: env.PUBLIC_POSTHOG_HOST,
        get_current_url: () => {
            const url = new URL(window.location.href);
            if (url.pathname === "/join") url.hash = "";
            return url.href;
        },
        before_send: (event) => {
            if (window.location.pathname === "/join") return null;
            const payload = JSON.stringify(event);
            return /quillium:\/\/join\/|quillium\.bryanhu\.com\/join#/.test(payload) ? null : event;
        },
        defaults: "2026-01-30",
        opt_out_capturing_by_default: false,
        capture_exceptions: true,
        persistence: "localStorage+cookie",
        cookieless_mode: "on_reject",
    });
    posthog.register({ app: "landing" });
    console.log("[PostHog] Initialized successfully");
}

export const handleError: HandleClientError = async ({ error, status, message }) => {
    if (window.location.pathname !== "/join") posthog.captureException(error);
    return { message, status };
};
