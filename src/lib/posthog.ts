import posthog from "posthog-js";
import { dev } from "$app/environment";
import { PUBLIC_POSTHOG_KEY, PUBLIC_POSTHOG_HOST } from "$env/static/public";
import { appSettings } from "$lib/settings.svelte";
import { toast } from "svelte-sonner";
import PrivacyNudgeToast from "$lib/ui/PrivacyNudgeToast.svelte";

const appVersion = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

/**
 * CSS selector matching all elements that contain user document content.
 * Used by PostHog session recording to mask text when `shareDocumentAnalytics` is off.
 */
export const DOCUMENT_CONTENT_SELECTOR = [
    ".cm-content", // main editor
    ".annotation-card", // sidebar annotation cards
    ".annotation-card-inline", // inline annotation cards
    ".revision-modal", // revision editor modal
    ".diff-modal", // diff comparison modal
    "#ai-sidebar", // AI chat/feedback/revise panels
    ".dictionary-popover", // dictionary lookup results
    ".autoai-container", // AutoAI feedback widget
    ".ph-mask-text", // generic mask class for library cards, preview panel, etc.
].join(", ");

/**
 * Tauri serves assets via `tauri://localhost`, a custom protocol that browsers
 * treat as cross-origin. This prevents rrweb (PostHog's session replay engine)
 * from reading `stylesheet.cssRules` — so CSS is missing in replays.
 *
 * Fix: set `crossOrigin` on all `<link rel="stylesheet">` elements before
 * the recorder takes its first DOM snapshot. Also observe future additions
 * for dynamically injected stylesheets (e.g. from SvelteKit's HMR/code-split).
 */
function patchStylesheetCORS() {
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]').forEach((link) => {
        if (!link.crossOrigin) link.crossOrigin = "anonymous";
    });

    new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (
                    node instanceof HTMLLinkElement &&
                    node.rel === "stylesheet" &&
                    !node.crossOrigin
                ) {
                    node.crossOrigin = "anonymous";
                }
            }
        }
    }).observe(document.head, { childList: true });
}

if (!dev && PUBLIC_POSTHOG_KEY && PUBLIC_POSTHOG_HOST) {
    patchStylesheetCORS();
    posthog.init(PUBLIC_POSTHOG_KEY, {
        api_host: PUBLIC_POSTHOG_HOST,
        ui_host: "https://us.posthog.com",
        defaults: "2026-01-30",
        capture_exceptions: true,
        session_recording: {
            ...(appSettings.shareDocumentAnalytics
                ? {}
                : { maskTextSelector: DOCUMENT_CONTENT_SELECTOR }),
            console_log_recording_enabled: true,
        },
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
        session_recording: {
            ...(sharing ? {} : { maskTextSelector: DOCUMENT_CONTENT_SELECTOR }),
            console_log_recording_enabled: true,
        },
    });
    if (sharing && key.trim()) {
        posthog.register({ share_document_key: key.trim() });
    } else {
        posthog.unregister("share_document_key");
    }
}

/**
 * Generate a short incident code.
 * Format: QIR-XXXX (Quillium Incident Report).
 * Exported so callers can attach a code to events even when
 * document sharing is on (for user-facing correlation).
 */
export function generateIncidentCode(): string {
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
