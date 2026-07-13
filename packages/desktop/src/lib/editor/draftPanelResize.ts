/**
 * draftPanelResize.ts — Shared geometry and keyboard semantics for the drafts panel.
 *
 * The panel is anchored beside the centered 816px document and grows toward
 * the viewport's left edge. Its persisted preferred width is therefore
 * clamped at render time to preserve a margin around the editor on narrower
 * desktop windows.
 */

export const DRAFT_PANEL_MIN_WIDTH = 192;
export const DRAFT_PANEL_MAX_WIDTH = 360;
export const DRAFT_PANEL_DEFAULT_WIDTH = 192;

const EDITOR_HALF_WIDTH = 408;
const PANEL_EDITOR_GAP = 16;
const VIEWPORT_MARGIN = 16;
const KEYBOARD_RESIZE_STEP = 8;
const KEYBOARD_RESIZE_LARGE_STEP = 24;

export function getDraftPanelMaxWidth(viewportWidth: number): number {
    const availableWidth = Math.floor(
        viewportWidth / 2 - EDITOR_HALF_WIDTH - PANEL_EDITOR_GAP - VIEWPORT_MARGIN,
    );
    return Math.max(DRAFT_PANEL_MIN_WIDTH, Math.min(DRAFT_PANEL_MAX_WIDTH, availableWidth));
}

export function clampDraftPanelWidth(width: number, viewportWidth: number): number {
    return Math.min(
        getDraftPanelMaxWidth(viewportWidth),
        Math.max(DRAFT_PANEL_MIN_WIDTH, Math.round(width)),
    );
}

export function getDraftPanelWidthFromKey(
    key: string,
    currentWidth: number,
    viewportWidth: number,
    largeStep = false,
): number | null {
    const maxWidth = getDraftPanelMaxWidth(viewportWidth);
    const step = largeStep ? KEYBOARD_RESIZE_LARGE_STEP : KEYBOARD_RESIZE_STEP;

    switch (key) {
        // The handle is on the panel's left edge, so moving it left widens
        // the panel and moving it right narrows it.
        case "ArrowLeft":
            return Math.min(maxWidth, currentWidth + step);
        case "ArrowRight":
            return Math.max(DRAFT_PANEL_MIN_WIDTH, currentWidth - step);
        case "Home":
            return DRAFT_PANEL_MIN_WIDTH;
        case "End":
            return maxWidth;
        default:
            return null;
    }
}
