import type { DraftMeta } from "$lib/db/types";
import { isDeletableDraft, isRunHead, layoutDraftRows } from "$lib/editor/draftTree";
import { describe, expect, it } from "vitest";

/** main → v1 → v2 is an iteration run; branches use branchedFrom. */
function iter(id: string, parent: string | null, createdAt: number, locked = false): DraftMeta {
    return mk(id, { parentDraftId: parent, createdAt, locked });
}
function branch(id: string, from: string, createdAt: number): DraftMeta {
    return mk(id, { branchedFrom: from, createdAt });
}
function mk(id: string, over: Partial<DraftMeta>): DraftMeta {
    return {
        id,
        documentId: "doc-1",
        label: id,
        createdAt: 0,
        isActive: true,
        tabId: "tab-1",
        parentDraftId: null,
        branchedFrom: null,
        locked: false,
        ...over,
    };
}

describe("layoutDraftRows", () => {
    it("returns nothing for no drafts", () => {
        expect(layoutDraftRows([])).toEqual([]);
    });

    it("renders an iteration run flat (depth 0) in order", () => {
        const rows = layoutDraftRows([
            iter("main", null, 0),
            iter("v1", "main", 1),
            iter("v2", "v1", 2),
        ]);
        expect(rows.map((r) => [r.draft.id, r.depth])).toEqual([
            ["main", 0],
            ["v1", 1 - 1], // iterations never deepen — depth stays 0
            ["v2", 0],
        ]);
        expect(rows.every((r) => r.depth === 0)).toBe(true);
    });

    it("marks only the run tip (newest live) as editable", () => {
        const rows = layoutDraftRows([
            iter("main", null, 0),
            iter("v1", "main", 1),
            iter("v2", "v1", 2),
        ]);
        expect(rows.find((r) => r.draft.id === "v2")?.isRunTip).toBe(true);
        expect(rows.find((r) => r.draft.id === "v1")?.isRunTip).toBe(false);
        expect(rows.find((r) => r.draft.id === "main")?.isRunTip).toBe(false);
    });

    it("indents a branch one level under its source and starts a new run", () => {
        // main → v1 ; branch b1 off v1 ; b1 → b2
        const rows = layoutDraftRows([
            iter("main", null, 0),
            iter("v1", "main", 1),
            branch("b1", "v1", 2),
            iter("b2", "b1", 3),
        ]);
        const byId = Object.fromEntries(rows.map((r) => [r.draft.id, r]));
        expect(byId.main.depth).toBe(0);
        expect(byId.v1.depth).toBe(0);
        expect(byId.b1.depth).toBe(1);
        expect(byId.b2.depth).toBe(1);
        // Each run has its own tip.
        expect(byId.v1.isRunTip).toBe(true); // main-run tip
        expect(byId.b2.isRunTip).toBe(true); // branch-run tip
        expect(byId.b1.isRunTip).toBe(false);
    });

    it("emits a branch immediately after its source draft", () => {
        const rows = layoutDraftRows([
            iter("main", null, 0),
            iter("v1", "main", 1),
            branch("b1", "main", 2),
        ]);
        // b1 (branched off main) appears right after main, before v1.
        expect(rows.map((r) => r.draft.id)).toEqual(["main", "b1", "v1"]);
    });
});

describe("isRunHead", () => {
    it("is true for a draft with no parent iteration", () => {
        expect(isRunHead(iter("main", null, 0))).toBe(true);
        expect(isRunHead(branch("b1", "v1", 0))).toBe(true); // branch root
    });
    it("is false for an iteration", () => {
        expect(isRunHead(iter("v1", "main", 1))).toBe(false);
    });
});

describe("isDeletableDraft", () => {
    it("rejects the only draft", () => {
        expect(isDeletableDraft("main", [iter("main", null, 0)])).toBe(false);
    });
    it("rejects a draft with a live iteration after it", () => {
        const drafts = [iter("main", null, 0), iter("v1", "main", 1)];
        expect(isDeletableDraft("main", drafts)).toBe(false);
    });
    it("rejects a draft with a branch off it", () => {
        const drafts = [iter("main", null, 0), iter("v1", "main", 1), branch("b1", "v1", 2)];
        expect(isDeletableDraft("v1", drafts)).toBe(false);
    });
    it("allows a leaf when siblings exist", () => {
        const drafts = [iter("main", null, 0), iter("v1", "main", 1)];
        expect(isDeletableDraft("v1", drafts)).toBe(true);
    });
});
