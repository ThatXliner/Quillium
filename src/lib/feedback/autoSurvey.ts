/**
 * autoSurvey.ts — Time-based auto-prompting for the feedback survey.
 *
 * The "Send Feedback" button shows the survey on demand. Separately, this
 * module decides when to surface it *automatically*: ~30 days after first use,
 * then every ~30 days — backing off when the user dismisses or submits.
 *
 * State lives in localStorage (per-device, works even when analytics is opted
 * out). PostHog's own targeting is disabled via an always-off linked flag, so
 * this app-side logic is the sole driver of automatic display.
 *
 * Dismiss/submit are detected by subscribing to PostHog's `survey dismissed` /
 * `survey sent` lifecycle events (keyed by survey id), which fire whether the
 * survey was opened manually or automatically.
 */

import { FEEDBACK_SURVEY_ID } from "$lib/constants";
import { showFeedbackSurvey } from "$lib/posthog";
import posthog from "$lib/posthog";

const STORAGE_KEY = "quillium-auto-survey";

const DAY = 24 * 60 * 60 * 1000;
/** Minimum gap between automatic prompts (and before the first one). */
const PROMPT_INTERVAL = 30 * DAY;
/** Suppress auto-prompts for this long after the user dismisses the survey. */
const DISMISS_BACKOFF = 90 * DAY; // ~3 months
/** Suppress longer after a submitted response — we already have their feedback. */
const SUBMIT_BACKOFF = 270 * DAY; // ~9 months

type AutoSurveyState = {
    /** First time the app recorded this device — auto-prompt waits one interval from here. */
    firstUse: number;
    /** Last time we auto-showed (or 0 if never). */
    lastShown: number;
    /** Last time the user dismissed the survey without submitting (or 0). */
    lastDismissed: number;
    /** Last time the user submitted a response (or 0). */
    lastSubmitted: number;
};

function load(): AutoSurveyState {
    const empty: AutoSurveyState = {
        firstUse: 0,
        lastShown: 0,
        lastDismissed: 0,
        lastSubmitted: 0,
    };
    if (typeof localStorage === "undefined") return empty;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? { ...empty, ...JSON.parse(raw) } : empty;
    } catch {
        return empty;
    }
}

function save(state: AutoSurveyState) {
    if (typeof localStorage === "undefined") return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // Non-fatal — auto-prompt timing just won't persist.
    }
}

/**
 * Decide whether enough time has passed to auto-show the survey, and if so,
 * show it. Call once on app launch. The first call only records first-use; the
 * survey can first appear PROMPT_INTERVAL later.
 *
 * Returns true if the survey was shown.
 */
export function maybeShowAutoSurvey(now: number = Date.now()): boolean {
    if (!FEEDBACK_SURVEY_ID) return false;

    const state = load();

    // First launch on this device: start the clock, don't interrupt yet.
    if (!state.firstUse) {
        save({ ...state, firstUse: now });
        return false;
    }

    // Backoff after a submitted response, then after a dismissal.
    if (state.lastSubmitted && now - state.lastSubmitted < SUBMIT_BACKOFF) return false;
    if (state.lastDismissed && now - state.lastDismissed < DISMISS_BACKOFF) return false;

    // Wait one interval from the last prompt, or from first use if never shown.
    const since = state.lastShown || state.firstUse;
    if (now - since < PROMPT_INTERVAL) return false;

    // showFeedbackSurvey() may still decline (analytics off, dev without the
    // force switch). Only record a "shown" when it actually displayed, so we
    // don't burn the interval on a no-op.
    if (!showFeedbackSurvey("auto")) return false;

    save({ ...state, lastShown: now });
    return true;
}

/**
 * Subscribe to survey lifecycle events so dismiss/submit update the backoff
 * timers. Returns an unsubscribe function. Safe to call when PostHog is
 * uninitialised — it just won't fire.
 */
export function registerSurveyLifecycleListeners(): () => void {
    if (typeof posthog.on !== "function") return () => {};
    return posthog.on(
        "eventCaptured",
        (event: { event?: string; properties?: Record<string, unknown> }) => {
            if (event?.properties?.$survey_id !== FEEDBACK_SURVEY_ID) return;
            const now = Date.now();
            if (event.event === "survey dismissed") {
                save({ ...load(), lastDismissed: now });
            } else if (event.event === "survey sent") {
                save({ ...load(), lastSubmitted: now });
            }
        },
    );
}
