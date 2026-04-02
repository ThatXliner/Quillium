import posthog from "posthog-js";
import { dev } from "$app/environment";
import { PUBLIC_POSTHOG_KEY, PUBLIC_POSTHOG_HOST } from "$env/static/public";
import { appSettings } from "$lib/settings.svelte";

declare const __APP_VERSION__: string;
const appVersion = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

if (!dev && PUBLIC_POSTHOG_KEY && PUBLIC_POSTHOG_HOST) {
    posthog.init(PUBLIC_POSTHOG_KEY, {
        api_host: PUBLIC_POSTHOG_HOST,
        ui_host: "https://us.posthog.com",
        defaults: "2026-01-30",
        capture_exceptions: true,
        session_recording: appSettings.privateDocumentAnalytics
            ? { maskTextSelector: ".cm-content" }
            : {},
    });

    posthog.register({ app_version: appVersion, app: "desktop" });

    // Respect the user's analytics preference
    if (!appSettings.analyticsEnabled) {
        posthog.opt_out_capturing();
    }

    console.log(
        `%c 🪶 Quillium (${appVersion}) %c PostHog analytics ${appSettings.analyticsEnabled ? "active" : "opted out"}`,
        "background:#3b82f6;color:#fff;font-weight:700;padding:2px 6px;border-radius:4px 0 0 4px;",
        "background:#1d4ed8;color:#fff;font-weight:400;padding:2px 8px;border-radius:0 4px 4px 0;",
    );
} else {
    if (dev) {
        console.warn("[Quillium] Dev mode — analytics disabled.");
    } else {
        console.warn("[Quillium] PostHog env vars missing — analytics disabled.");
    }
}

/**
 * Call after changing `appSettings.analyticsEnabled` to sync PostHog state.
 */
export function syncAnalyticsOptOut(enabled: boolean) {
    if (enabled) {
        posthog.opt_in_capturing();
    } else {
        posthog.opt_out_capturing();
    }
}

/**
 * Keys that contain document content and should be redacted
 * when privateDocumentAnalytics is enabled.
 */
export const REDACTED_KEYS: ReadonlySet<string> = new Set(["synonym", "word"]);

/**
 * Privacy-aware capture wrapper. Strips document-content properties
 * when the user has privateDocumentAnalytics enabled.
 */
export function capture(event: string, props?: Record<string, unknown>) {
    if (!props || !appSettings.privateDocumentAnalytics) {
        posthog.capture(event, props);
        return;
    }
    const hasRedacted = Object.keys(props).some((k) => REDACTED_KEYS.has(k));
    if (!hasRedacted) {
        posthog.capture(event, props);
        return;
    }
    const cleaned = { ...props };
    for (const key of REDACTED_KEYS) {
        delete cleaned[key];
    }
    posthog.capture(event, cleaned);
}

/**
 * Update session recording text masking at runtime.
 * Call after changing `appSettings.privateDocumentAnalytics`.
 */
export function syncPrivateAnalytics(enabled: boolean) {
    posthog.set_config({
        session_recording: { maskTextSelector: enabled ? ".cm-content" : undefined },
    });
}

export default posthog;
