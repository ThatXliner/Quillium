import { describe, expect, it } from "vitest";
import {
    includesReadonlyShareTab,
    isReadonlyShareStateV2,
    readonlyShareScopeOf,
} from "../src/types";

describe("readonly share state", () => {
    it("preserves an all-tabs publishing scope", () => {
        const state = {
            kind: "quillium-readonly-share",
            version: 2,
            scope: "all-tabs",
            activeTabId: "tab-1",
            tabs: [],
        };

        expect(isReadonlyShareStateV2(state)).toBe(true);
        expect(readonlyShareScopeOf(state)).toBe("all-tabs");
    });

    it("treats legacy and malformed states as current-tab shares", () => {
        expect(readonlyShareScopeOf({ doc: "Legacy" })).toBe("current-tab");
        expect(
            readonlyShareScopeOf({
                kind: "quillium-readonly-share",
                version: 2,
                activeTabId: "tab-1",
                tabs: [],
            }),
        ).toBe("current-tab");
    });

    it("selects either the current tab or every tab", () => {
        expect(includesReadonlyShareTab("current-tab", "tab-1", "tab-1")).toBe(true);
        expect(includesReadonlyShareTab("current-tab", "tab-2", "tab-1")).toBe(false);
        expect(includesReadonlyShareTab("all-tabs", "tab-2", "tab-1")).toBe(true);
    });
});
