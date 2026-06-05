/**
 * autoSurvey.ts — Behavior-triggered auto-prompting for the feedback survey.
 *
 * The "Send Feedback" button shows the survey on demand. Separately, this
 * module decides when to surface it *automatically*. Timing follows in-app
 * survey research rather than a fixed calendar:
 *
 *   - FIRST prompt is engagement-gated: only after the user has written enough
 *     to have a real opinion (cumulative words ≥ WORDS_THRESHOLD). Prompting
 *     before a user has gotten value tanks both response rate and quality.
 *   - RE-prompts honour the ~90-day frequency cap that research converges on
 *     (response rates drop sharply when the same user is surveyed more than
 *     once a quarter).
 *   - Dismissing backs off ~3 months; submitting backs off ~9 (we already have
 *     their feedback).
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
/** Engagement gate: cumulative words before the first auto-prompt is eligible. */
const WORDS_THRESHOLD = 2000;
/** Minimum gap between automatic prompts — the ~once-per-quarter cap. */
const PROMPT_INTERVAL = 90 * DAY;
/** Suppress auto-prompts for this long after the user dismisses the survey. */
const DISMISS_BACKOFF = 90 * DAY; // ~3 months
/** Suppress longer after a submitted response — we already have their feedback. */
const SUBMIT_BACKOFF = 270 * DAY; // ~9 months
/**
 * Per-update cap on counted words. Organic typing adds a handful of words per
 * transaction; a big jump is a document load/switch, not writing — clamp it so
 * loads don't inflate the engagement signal.
 */
const MAX_WORDS_PER_UPDATE = 40;

type AutoSurveyState = {
    /** Cumulative words written (engagement proxy), capped per update. */
    wordsWritten: number;
    /** Live word count at the previous update, to derive the delta. */
    lastWordCount: number;
    /** Last time we auto-showed (or 0 if never). */
    lastShown: number;
    /** Last time the user dismissed the survey without submitting (or 0). */
    lastDismissed: number;
    /** Last time the user submitted a response (or 0). */
    lastSubmitted: number;
};

const EMPTY: AutoSurveyState = {
    wordsWritten: 0,
    lastWordCount: 0,
    lastShown: 0,
    lastDismissed: 0,
    lastSubmitted: 0,
};

function load(): AutoSurveyState {
    if (typeof localStorage === "undefined") return { ...EMPTY };
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? { ...EMPTY, ...JSON.parse(raw) } : { ...EMPTY };
    } catch {
        return { ...EMPTY };
    }
}

function save(state: AutoSurveyState) {
    if (typeof localStorage === "undefined") return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // Non-fatal — auto-prompt state just won't persist.
    }
}

/**
 * Feed the live document word count on each update so cumulative "words
 * written" can accrue. Only positive growth counts, clamped per update so a
 * document load/switch (a large jump) doesn't inflate the signal; shrinking or
 * switching to a smaller doc just resets the baseline.
 */
export function recordWordCount(currentWordCount: number) {
    const state = load();
    const delta = currentWordCount - state.lastWordCount;
    if (delta > 0) {
        state.wordsWritten += Math.min(delta, MAX_WORDS_PER_UPDATE);
    }
    state.lastWordCount = currentWordCount;
    save(state);
}

/**
 * Decide whether the user is eligible for an automatic prompt, and if so, show
 * it. Call once on app launch.
 *
 * Returns true if the survey was shown.
 */
export function maybeShowAutoSurvey(now: number = Date.now()): boolean {
    if (!FEEDBACK_SURVEY_ID) return false;

    const state = load();

    // Engagement gate — don't prompt until they've written enough to have a view.
    if (state.wordsWritten < WORDS_THRESHOLD) return false;

    // Backoff after a submitted response, then after a dismissal.
    if (state.lastSubmitted && now - state.lastSubmitted < SUBMIT_BACKOFF) return false;
    if (state.lastDismissed && now - state.lastDismissed < DISMISS_BACKOFF) return false;

    // Frequency cap: at most one prompt per ~quarter.
    if (state.lastShown && now - state.lastShown < PROMPT_INTERVAL) return false;

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
