import posthog from "posthog-js";
import { dev } from "$app/environment";
import { PUBLIC_POSTHOG_KEY, PUBLIC_POSTHOG_HOST } from "$env/static/public";
import { appSettings } from "$lib/settings.svelte";
import { toast } from "svelte-sonner";
import PrivacyNudgeToast from "$lib/ui/PrivacyNudgeToast.svelte";

declare const __APP_VERSION__: string;
const appVersion = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

if (!dev && PUBLIC_POSTHOG_KEY && PUBLIC_POSTHOG_HOST) {
    posthog.init(PUBLIC_POSTHOG_KEY, {
        api_host: PUBLIC_POSTHOG_HOST,
        ui_host: "https://us.posthog.com",
        defaults: "2026-01-30",
        capture_exceptions: true,
        session_recording: appSettings.shareDocumentAnalytics
            ? {}
            : { maskTextSelector: ".cm-content" },
    });

    posthog.register({ app_version: appVersion, app: "desktop" });

    // Register share-document key if sharing is enabled
    if (appSettings.shareDocumentAnalytics && appSettings.shareDocumentKey.trim()) {
        posthog.register({ share_document_key: appSettings.shareDocumentKey.trim() });
    }

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
 * when the user has not opted in to sharing.
 */
export const REDACTED_KEYS: ReadonlySet<string> = new Set(["synonym", "word", "original"]);

/**
 * Privacy-aware capture wrapper. Strips document-content properties
 * unless the user has opted in to shareDocumentAnalytics.
 */
export function capture(event: string, props?: Record<string, unknown>) {
    if (!props || appSettings.shareDocumentAnalytics) {
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
 * Sync session recording masking and the share-document super property.
 * Call after changing `appSettings.shareDocumentAnalytics` or `shareDocumentKey`.
 */
export function syncShareDocumentAnalytics(sharing: boolean, key: string) {
    posthog.set_config({
        session_recording: sharing ? {} : { maskTextSelector: ".cm-content" },
    });
    if (sharing && key.trim()) {
        posthog.register({ share_document_key: key.trim() });
    } else {
        posthog.unregister("share_document_key");
    }
}

/**
 * Generate a short incident code for privacy-nudge toasts.
 * Format: QIR-XXXX (Quillium Incident Report).
 */
function generateIncidentCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O, 1/I
    let code = "";
    for (let i = 0; i < 4; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return `QIR-${code}`;
}

/**
 * Show a glassmorphism toast nudging the user to enable document analytics.
 * Returns the incident code so the caller can include it in the (redacted)
 * PostHog event.
 *
 * `openSettings` receives the setting ID to scroll to. Callers should pass
 * e.g. `(id) => settingsOpen.set(id)` to avoid circular imports.
 */
export function showPrivacyNudge(
    summary: string,
    openSettings?: (settingId: string) => void,
): string {
    const code = generateIncidentCode();
    const toastId = toast.custom(PrivacyNudgeToast, {
        duration: 15_000,
        componentProps: {
            summary,
            code,
            onaction: () => {
                toast.dismiss(toastId);
                openSettings?.("share-document-analytics");
            },
            ondismiss: () => toast.dismiss(toastId),
        },
    });
    return code;
}

export default posthog;
