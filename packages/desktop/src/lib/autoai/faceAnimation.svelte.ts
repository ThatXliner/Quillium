/**
 * faceAnimation.svelte.ts — AutoAI face playfulness: eye tracking, sleep,
 * wake. Extracted from AutoAIWidget so the widget file stays focused on
 * layout, settings UI, and the engine wiring.
 *
 * Owns three independent concerns that happen to share event plumbing:
 *   1. Eye offset (where the pupils point) — computed from caret or
 *      cursor coordinates and the widget's bounding rect, rAF-throttled.
 *   2. Tracking state — whether eyes should follow anything at all.
 *      Split into two flags so proximity and caret-linger can't interfere:
 *        - isTrackingCaret: timer-gated, 2s linger after typing/caret.
 *        - isMouseNear:     instantaneous, true only while cursor is
 *                           inside PROXIMITY_RADIUS_PX of widget center.
 *      The derived `isTracking` is the union.
 *   3. Sleep/wake — 30s idle → sleeping; any interaction → 1.6s waking
 *      animation before returning to idle.
 *
 * Usage from a .svelte component:
 *   const face = createFaceAnimation({
 *       getWidgetEl: () => widgetEl,
 *       getIsPanelOpen: () => open,
 *       getCanSleep: () => autoAIRunning && !noApiKey && $autoAIPhase === "idle",
 *   });
 *   onMount(() => face.start());
 *   onDestroy(() => face.stop());
 *   // ...then read face.eyeOffsetX, face.isTracking, face.isSleeping, etc.
 */

import { appEventBus } from "$lib/events/appEventBus";

const SLEEP_AFTER_MS = 30_000;
const TRACKING_LINGER_MS = 2_000;
const WAKE_DURATION_MS = 1600;
// Pixels from the widget center within which the face will track the mouse
// even when the user isn't actively typing — the "it noticed you" beat.
const PROXIMITY_RADIUS_PX = 180;
// Sustained-typing gate: tracking only engages after the user has been
// *continuously* typing for this long. A single keystroke or a sub-1s
// burst leaves the eyes where they are. The streak is considered broken
// if TYPING_STREAK_GAP_MS passes between caret events.
const SUSTAINED_TYPING_MS = 1_000;
const TYPING_STREAK_GAP_MS = 500;

export interface FaceAnimationConfig {
    /** The widget's root element, used to compute center for eye offset and proximity. */
    getWidgetEl: () => HTMLElement | null;
    /** When the panel is open the face is hidden, so we skip all work. */
    getIsPanelOpen: () => boolean;
    /**
     * Whether the face is allowed to fall asleep right now. Sleep is
     * suppressed while AutoAI is disabled, has no API key, or is actively
     * reviewing/thinking — the caller owns that judgment.
     */
    getCanSleep: () => boolean;
}

export interface FaceAnimation {
    readonly eyeOffsetX: number;
    readonly eyeOffsetY: number;
    readonly isTracking: boolean;
    readonly isSleeping: boolean;
    readonly isWaking: boolean;
    /** Attach listeners, start the sleep countdown. Safe to call once onMount. */
    start(): void;
    /** Detach listeners and clear all timers. */
    stop(): void;
    /**
     * Wake without playing the yawn animation — used when the panel opens,
     * since the bubble is hidden and the waking eyes wouldn't be visible.
     */
    wakeSilently(): void;
    /** Restart the sleep countdown (e.g. when the panel closes). */
    resetSleep(): void;
}

export function createFaceAnimation(config: FaceAnimationConfig): FaceAnimation {
    let eyeOffsetX = $state(0);
    let eyeOffsetY = $state(0);
    let isTrackingCaret = $state(false);
    let isMouseNear = $state(false);
    let isSleeping = $state(false);
    let isWaking = $state(false);

    let trackingTimer: ReturnType<typeof setTimeout> | null = null;
    let sleepTimer: ReturnType<typeof setTimeout> | null = null;
    let wakeTimer: ReturnType<typeof setTimeout> | null = null;
    let stopCaretTracking: (() => void) | null = null;
    // Sustained-typing tracking: `typingStreakStart` is the timestamp of
    // the first caret event in the current streak, or null if no streak
    // is in progress. `typingStreakTimer` fires TYPING_STREAK_GAP_MS after
    // the last caret event and resets the streak, so a single keystroke
    // or sparse edits never cross the SUSTAINED_TYPING_MS threshold.
    let typingStreakStart: number | null = null;
    let typingStreakTimer: ReturnType<typeof setTimeout> | null = null;

    let eyeRafPending = false;
    let pendingEyeTarget: { x: number; y: number } | null = null;

    function flushEyeOffset() {
        eyeRafPending = false;
        const widgetEl = config.getWidgetEl();
        if (!pendingEyeTarget || !widgetEl) return;
        const { x: targetX, y: targetY } = pendingEyeTarget;
        pendingEyeTarget = null;
        // getBoundingClientRect() is called at most once per animation frame,
        // so multiple pointer/caret events per frame collapse into a single layout read.
        const rect = widgetEl.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = targetX - cx;
        const dy = targetY - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const scale = Math.min(1, dist / 80);
        eyeOffsetX = Number.parseFloat(((dx / dist) * 4 * scale).toFixed(1));
        eyeOffsetY = Number.parseFloat(((dy / dist) * 4 * scale).toFixed(1));
    }

    function scheduleEyeOffset(x: number, y: number) {
        pendingEyeTarget = { x, y };
        if (!eyeRafPending) {
            eyeRafPending = true;
            requestAnimationFrame(flushEyeOffset);
        }
    }

    function resetTrackingTimer() {
        if (trackingTimer !== null) clearTimeout(trackingTimer);
        trackingTimer = setTimeout(() => {
            isTrackingCaret = false;
            trackingTimer = null;
        }, TRACKING_LINGER_MS);
    }

    function resetSleepTimer() {
        if (sleepTimer !== null) clearTimeout(sleepTimer);
        sleepTimer = setTimeout(() => {
            sleepTimer = null;
            if (config.getIsPanelOpen() || !config.getCanSleep()) {
                // Busy, panel open, or not allowed to sleep — reschedule
                // so we don't miss the transition back to idle.
                resetSleepTimer();
                return;
            }
            isSleeping = true;
        }, SLEEP_AFTER_MS);
    }

    function triggerWake() {
        if (!isSleeping) return;
        isSleeping = false;
        isWaking = true;
        if (wakeTimer !== null) clearTimeout(wakeTimer);
        wakeTimer = setTimeout(() => {
            isWaking = false;
            wakeTimer = null;
        }, WAKE_DURATION_MS);
        resetSleepTimer();
    }

    function handleCaretMoved(x: number, y: number) {
        if (config.getIsPanelOpen()) return;
        if (isSleeping) {
            triggerWake();
            return;
        }
        resetSleepTimer();
        if (isTrackingCaret) {
            // Already tracking — follow the caret live and extend the linger.
            scheduleEyeOffset(x, y);
            resetTrackingTimer();
            return;
        }
        // Sustained-typing gate: count how long the user has been typing
        // in an unbroken streak. A single keystroke opens the streak;
        // TYPING_STREAK_GAP_MS of silence closes it. Tracking only kicks
        // in once the streak has lasted SUSTAINED_TYPING_MS.
        const now = performance.now();
        if (typingStreakStart === null) typingStreakStart = now;
        if (typingStreakTimer !== null) clearTimeout(typingStreakTimer);
        typingStreakTimer = setTimeout(() => {
            typingStreakStart = null;
            typingStreakTimer = null;
        }, TYPING_STREAK_GAP_MS);
        if (now - typingStreakStart >= SUSTAINED_TYPING_MS) {
            typingStreakStart = null;
            if (typingStreakTimer !== null) {
                clearTimeout(typingStreakTimer);
                typingStreakTimer = null;
            }
            isTrackingCaret = true;
            scheduleEyeOffset(x, y);
            resetTrackingTimer();
        }
    }

    // Mouse tracking fires when either:
    //   1) The user is actively typing (isTrackingCaret is true for
    //      TRACKING_LINGER_MS after the last caret event) — keeps the
    //      face lively during active use.
    //   2) The cursor is within PROXIMITY_RADIUS_PX of the widget center —
    //      gives an "it noticed you" beat as you approach the bubble.
    // Outside both, we just update isMouseNear (probably to false) and
    // bail; the caret linger timer owns when isTracking flips off.
    function handleMouseMove(e: MouseEvent) {
        if (config.getIsPanelOpen()) return;
        const widgetEl = config.getWidgetEl();
        let near = false;
        if (widgetEl) {
            const rect = widgetEl.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const dx = e.clientX - cx;
            const dy = e.clientY - cy;
            near = dx * dx + dy * dy <= PROXIMITY_RADIUS_PX * PROXIMITY_RADIUS_PX;
        }
        isMouseNear = near;
        if (!isTrackingCaret && !near) return;
        if (isSleeping) {
            triggerWake();
            return;
        }
        scheduleEyeOffset(e.clientX, e.clientY);
        resetSleepTimer();
    }

    function handleAnyInteraction() {
        if (isSleeping) triggerWake();
        else resetSleepTimer();
    }

    return {
        get eyeOffsetX() {
            return eyeOffsetX;
        },
        get eyeOffsetY() {
            return eyeOffsetY;
        },
        get isTracking() {
            return isTrackingCaret || isMouseNear;
        },
        get isSleeping() {
            return isSleeping;
        },
        get isWaking() {
            return isWaking;
        },
        start() {
            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("keydown", handleAnyInteraction);
            stopCaretTracking = appEventBus.on("caret-moved", (event) => {
                handleCaretMoved(event.x, event.y);
            });
            resetSleepTimer();
        },
        stop() {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("keydown", handleAnyInteraction);
            stopCaretTracking?.();
            stopCaretTracking = null;
            if (trackingTimer !== null) clearTimeout(trackingTimer);
            if (sleepTimer !== null) clearTimeout(sleepTimer);
            if (wakeTimer !== null) clearTimeout(wakeTimer);
            if (typingStreakTimer !== null) clearTimeout(typingStreakTimer);
        },
        wakeSilently() {
            if (!isSleeping) return;
            isSleeping = false;
            if (wakeTimer !== null) {
                clearTimeout(wakeTimer);
                wakeTimer = null;
            }
            isWaking = false;
        },
        resetSleep() {
            resetSleepTimer();
        },
    };
}
