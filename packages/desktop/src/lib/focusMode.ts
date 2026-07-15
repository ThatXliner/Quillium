/**
 * focusMode.ts — Shared focus-mode keyboard and timing rules.
 *
 * Kept outside the route component so shortcut behavior is independently
 * testable and stays consistent across native-menu and webview entry points.
 */

export const FOCUS_CONTROLS_HIDE_DELAY_MS = 2200;
export const FOCUS_MODE_FEATURE_FLAG = "novel-november";

export function isFocusModeFeatureEnabled(value: boolean | string | undefined): boolean {
    return value === true;
}

export function isFocusModeShortcut(event: KeyboardEvent): boolean {
    if (event.key === "F11" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        return true;
    }

    return (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "f"
    );
}
