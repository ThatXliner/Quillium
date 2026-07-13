import {
    DRAFT_PANEL_MAX_WIDTH,
    DRAFT_PANEL_MIN_WIDTH,
    clampDraftPanelWidth,
    getDraftPanelMaxWidth,
    getDraftPanelWidthFromKey,
} from "$lib/editor/draftPanelResize";
import { describe, expect, it } from "vitest";

describe("draft panel resize", () => {
    it("uses the full configured range on wide viewports", () => {
        expect(getDraftPanelMaxWidth(1600)).toBe(DRAFT_PANEL_MAX_WIDTH);
        expect(clampDraftPanelWidth(999, 1600)).toBe(DRAFT_PANEL_MAX_WIDTH);
        expect(clampDraftPanelWidth(0, 1600)).toBe(DRAFT_PANEL_MIN_WIDTH);
    });

    it("caps the panel to preserve the editor margin on narrower windows", () => {
        expect(getDraftPanelMaxWidth(1440)).toBe(280);
        expect(clampDraftPanelWidth(DRAFT_PANEL_MAX_WIDTH, 1440)).toBe(280);
    });

    it("never reports a maximum below the usable minimum", () => {
        expect(getDraftPanelMaxWidth(1000)).toBe(DRAFT_PANEL_MIN_WIDTH);
    });

    it("mirrors arrow keys for a handle on the left edge", () => {
        expect(getDraftPanelWidthFromKey("ArrowLeft", 200, 1600)).toBe(208);
        expect(getDraftPanelWidthFromKey("ArrowRight", 200, 1600)).toBe(192);
        expect(getDraftPanelWidthFromKey("ArrowLeft", 200, 1600, true)).toBe(224);
    });

    it("supports Home and End and ignores unrelated keys", () => {
        expect(getDraftPanelWidthFromKey("Home", 240, 1440)).toBe(DRAFT_PANEL_MIN_WIDTH);
        expect(getDraftPanelWidthFromKey("End", 240, 1440)).toBe(280);
        expect(getDraftPanelWidthFromKey("Enter", 240, 1440)).toBeNull();
    });
});
