/**
 * store.svelte.ts — Svelte 5 rune store for the debug panel.
 *
 * Uses a writable rune so any component can toggle the panel
 * open/closed without importing from stores.ts (which has CodeMirror
 * dependencies that complicate tree-shaking in production).
 */

import { writable } from "svelte/store";

/** Whether the debug panel overlay is currently open. */
export const debugPanelActive = writable(false);

/** DEV only: make auth signup UI behave like production waitlist gating. */
export const debugAuthWaitlistMode = writable(false);

/**
 * DEV only: force the PostHog feedback survey to work in dev.
 *
 * PostHog (and thus surveys) is normally stripped from dev builds, so
 * `showFeedbackSurvey()` no-ops and the "Send Feedback" button falls back to
 * the bug form. When this is on, PostHog is initialised on demand and the
 * survey path runs — letting the real flow be tested without a prod build.
 */
export const debugForceSurvey = writable(false);
