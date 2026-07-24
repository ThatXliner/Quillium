import { dev } from "$app/environment";
import { PUBLIC_POSTHOG_HOST, PUBLIC_POSTHOG_KEY } from "$env/static/public";
import { FEEDBACK_SURVEY_ID } from "$lib/constants";
import { debugForceSurvey } from "$lib/debug/store.svelte";
import { appSettings } from "$lib/settings.svelte";
import PrivacyNudgeToast from "$lib/ui/PrivacyNudgeToast.svelte";
import posthog, { DisplaySurveyType, SurveyPosition } from "posthog-js";
import { toast } from "svelte-sonner";
import { get } from "svelte/store";

const appVersion = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

/**
 * CSS selector matching all elements that contain user document content.
 * Used by PostHog session recording to always mask text (document sharing is disabled).
 * TODO(#191): conditionally unmask when shareDocumentAnalytics is re-enabled.
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
    for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
        if (!link.crossOrigin) link.crossOrigin = "anonymous";
    }

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

let posthogInitialised = false;

/** Whether the PostHog client has been initialized and can serve feature flags. */
export function isPostHogInitialised(): boolean {
    return posthogInitialised;
}

function getPostHogEnv(): { key: string; host: string } | null {
    // $env/static/public, NOT import.meta.env — see supabase.ts for why.
    const key = PUBLIC_POSTHOG_KEY;
    const host = PUBLIC_POSTHOG_HOST;
    return key && host ? { key, host } : null;
}

/** Initialise PostHog once. Idempotent — safe to call from startup or the dev override. */
function initPostHog() {
    if (posthogInitialised) return;
    const config = getPostHogEnv();
    if (!config) return;

    posthogInitialised = true;
    patchStylesheetCORS();
    posthog.init(config.key, {
        api_host: config.host,
        ui_host: "https://us.posthog.com",
        defaults: "2026-01-30",
        capture_exceptions: true,
        session_recording: {
            // TODO(#191): conditionally clear maskTextSelector when shareDocumentAnalytics is re-enabled
            maskTextSelector: DOCUMENT_CONTENT_SELECTOR,
        },
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
}

if (!dev && getPostHogEnv()) {
    initPostHog();
} else {
    if (dev) {
        console.warn("[Quillium] Dev mode — analytics disabled.");
    } else {
        console.warn("[Quillium] PostHog env vars missing — analytics disabled.");
    }
}

/**
 * DEV only: initialise PostHog on demand so the feedback survey can be tested
 * locally. Gated by the debug-panel "Force survey" switch; no-op in production
 * (where PostHog is already initialised at startup) or without env vars.
 */
export function ensurePostHogForDebug() {
    if (!dev || !getPostHogEnv()) return;
    initPostHog();
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
 * Open the general app-feedback survey (PostHog-hosted popover).
 *
 * The user invoked this explicitly (Help → Send Feedback, or the Settings
 * footer), so we `ignoreConditions`/`ignoreDelay` to show it on demand rather
 * than waiting on dashboard targeting. PostHog emits `survey shown`/`sent`/
 * `dismissed` events automatically.
 *
 * Captures `feedback_menu_opened` on intent (not gated behind the survey
 * showing) so opted-out users and not-yet-configured surveys are still counted;
 * `source` distinguishes the entry point and `outcome` records what happened.
 *
 * No-ops the survey itself when PostHog is uninitialised (dev / missing env),
 * the user has opted out of analytics, or no survey ID is configured. Returns
 * whether it was shown so callers can fall back (e.g. to the bug-report form).
 *
 * In dev the survey only runs when the debug-panel "Force survey" switch is on
 * (which also initialises PostHog on demand); otherwise it stays disabled.
 *
 * Always centered: the survey is launched on demand (not tied to a page corner),
 * and the configured bottom-right position sits flush against the window edge
 * with no margin, overlapping the editor's side panels. Centering reads as a
 * deliberate modal instead.
 */
export function showFeedbackSurvey(
    source: "menu" | "settings" | "auto" | "nested_revision_link",
): boolean {
    if (!getPostHogEnv()) return false;
    if (dev) {
        if (!get(debugForceSurvey)) return false;
        ensurePostHogForDebug();
    }
    if (!appSettings.analyticsEnabled) return false;
    if (!FEEDBACK_SURVEY_ID) {
        console.warn("[Quillium] FEEDBACK_SURVEY_ID is not set — survey unavailable.");
        capture("feedback_menu_opened", { source, outcome: "unavailable" });
        return false;
    }
    capture("feedback_menu_opened", { source, outcome: "shown" });
    posthog.displaySurvey(FEEDBACK_SURVEY_ID, {
        displayType: DisplaySurveyType.Popover,
        position: SurveyPosition.MiddleCenter,
        ignoreConditions: true,
        ignoreDelay: true,
    });
    return true;
}

/**
 * Keys that contain document content and should be redacted
 * when the user has not opted in to sharing.
 */
export const REDACTED_KEYS: ReadonlySet<string> = new Set(["synonym", "word", "original"]);

/**
 * Privacy-aware capture wrapper. Always strips document-content properties.
 * TODO(#191): conditionally pass through when shareDocumentAnalytics is re-enabled.
 */
export function capture(event: string, props?: Record<string, unknown>) {
    if (!props) {
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
 * captureException wrapper that accepts any thrown value, coercing
 * non-Errors so PostHog always receives an Error instance.
 */
export function captureException(error: unknown) {
    posthog.captureException(error instanceof Error ? error : new Error(String(error)));
}

// TODO(#191): restore syncShareDocumentAnalytics when document sharing is re-enabled
// export function syncShareDocumentAnalytics(sharing: boolean, key: string) { ... }

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
