import type { DraftMeta } from "$lib/db/types";
import {
    collectSubtree,
    hasLiveChildren,
    isDeletableDraft,
    isRunHead,
    layoutDraftRows,
} from "$lib/editor/draftTree";
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

describe("layoutDraftRows — rail geometry", () => {
    it("marks an iteration that has a live successor as continuing its run", () => {
        const rows = layoutDraftRows([
            iter("main", null, 0),
            iter("v1", "main", 1),
            iter("v2", "v1", 2),
        ]);
        const byId = Object.fromEntries(rows.map((r) => [r.draft.id, r]));
        expect(byId.main.continuesRun).toBe(true);
        expect(byId.v1.continuesRun).toBe(true);
        expect(byId.v2.continuesRun).toBe(false); // tip — nothing below
        // A flat run draws no ancestor spines and no elbows.
        expect(rows.every((r) => r.spines.length === 0)).toBe(true);
        expect(rows.every((r) => r.branchConnector === null)).toBe(true);
    });

    it("draws a corner elbow for the only branch off a run tip", () => {
        // main → v1 (tip) ; branch b1 off v1. v1 doesn't continue, b1 is last.
        const rows = layoutDraftRows([
            iter("main", null, 0),
            iter("v1", "main", 1),
            branch("b1", "v1", 2),
        ]);
        const byId = Object.fromEntries(rows.map((r) => [r.draft.id, r]));
        expect(byId.b1.branchConnector).toBe("corner");
        expect(byId.b1.spines).toEqual([]); // nothing passes through column 0
    });

    it("draws a tee when the parent run continues below the branch", () => {
        // main → v1 → v2 ; branch b1 off v1. v1 continues to v2, so the elbow
        // is a tee and v1's spine (column 0) passes through b1.
        const rows = layoutDraftRows([
            iter("main", null, 0),
            iter("v1", "main", 1),
            branch("b1", "v1", 2),
            iter("v2", "v1", 3),
        ]);
        const byId = Object.fromEntries(rows.map((r) => [r.draft.id, r]));
        expect(rows.map((r) => r.draft.id)).toEqual(["main", "v1", "b1", "v2"]);
        expect(byId.b1.branchConnector).toBe("tee");
        // b1 is the branch root: it elbows into column 0, so column 0 is NOT a
        // pass-through spine on its own row.
        expect(byId.b1.spines).toEqual([]);
    });

    it("tees every branch but the last off the same parent", () => {
        // v1 (tip) with three branches; only the last is a corner.
        const rows = layoutDraftRows([
            iter("main", null, 0),
            iter("v1", "main", 1),
            branch("b1", "v1", 2),
            branch("b2", "v1", 3),
            branch("b3", "v1", 4),
        ]);
        const byId = Object.fromEntries(rows.map((r) => [r.draft.id, r]));
        expect(byId.b1.branchConnector).toBe("tee");
        expect(byId.b2.branchConnector).toBe("tee");
        expect(byId.b3.branchConnector).toBe("corner");
    });

    it("passes an ancestor run-spine through a nested branch block (v5 case)", () => {
        // The screenshot shape:
        //   Draft → v1 → v2 → v5            (depth-0 run)
        //              └ b1(new take) → v4 → v8   (depth-1 branch run off v2)
        //                                  ├ b2(new take)   (depth-2 branches off v8)
        //                                  └ b3(new take)
        const rows = layoutDraftRows([
            iter("Draft", null, 0),
            iter("v1", "Draft", 1),
            iter("v2", "v1", 2),
            branch("b1", "v2", 3),
            iter("v4", "b1", 4),
            iter("v8", "v4", 5),
            branch("b2", "v8", 6),
            branch("b3", "v8", 7),
            iter("v5", "v2", 8),
        ]);
        const byId = Object.fromEntries(rows.map((r) => [r.draft.id, r]));

        // Display order: each draft, then its branches, then the next iteration.
        expect(rows.map((r) => r.draft.id)).toEqual([
            "Draft",
            "v1",
            "v2",
            "b1",
            "v4",
            "v8",
            "b2",
            "b3",
            "v5",
        ]);

        // Depths.
        expect(byId.v2.depth).toBe(0);
        expect(byId.b1.depth).toBe(1);
        expect(byId.v8.depth).toBe(1);
        expect(byId.b2.depth).toBe(2);
        expect(byId.v5.depth).toBe(0);

        // v2's run continues to v5, so the branch off v2 tees and v2's column 0
        // spine passes through the whole branch block.
        expect(byId.b1.branchConnector).toBe("tee");
        expect(byId.v4.spines).toEqual([0]); // v2's spine passing through
        expect(byId.v8.spines).toEqual([0]);

        // b2 / b3 branch off v8 (the branch-run tip, which doesn't continue),
        // so b2 tees (b3 follows) and b3 corners. While inside them, column 0
        // (v2's run) still passes through; b1's column (1) elbows on the root
        // rows but passes through their non-root rows — here both are roots.
        expect(byId.b2.branchConnector).toBe("tee");
        expect(byId.b3.branchConnector).toBe("corner");
        expect(byId.b2.spines).toEqual([0]); // v2 passes through; col 1 is the elbow
        expect(byId.b3.spines).toEqual([0]);

        // v5 sits below the branch block at depth 0 — no spines pass through it,
        // it's the bottom of v2's run.
        expect(byId.v5.spines).toEqual([]);
        expect(byId.v5.continuesRun).toBe(false);
        expect(byId.v2.continuesRun).toBe(true);
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
    it("allows a leaf when siblings exist", () => {
        const drafts = [iter("main", null, 0), iter("v1", "main", 1)];
        expect(isDeletableDraft("v1", drafts)).toBe(true);
    });
    it("allows a draft with a live iteration after it (no longer leaf-only)", () => {
        const drafts = [iter("main", null, 0), iter("v1", "main", 1)];
        expect(isDeletableDraft("main", drafts)).toBe(true);
    });
    it("allows a draft with a branch off it", () => {
        const drafts = [iter("main", null, 0), iter("v1", "main", 1), branch("b1", "v1", 2)];
        expect(isDeletableDraft("v1", drafts)).toBe(true);
    });
    it("rejects a locked draft (the lock is the only protection)", () => {
        const drafts = [iter("main", null, 0), iter("v1", "main", 1, true)];
        expect(isDeletableDraft("v1", drafts)).toBe(false);
    });
});

describe("hasLiveChildren", () => {
    it("is false for a leaf", () => {
        const drafts = [iter("main", null, 0), iter("v1", "main", 1)];
        expect(hasLiveChildren("v1", drafts)).toBe(false);
    });
    it("is true for a draft with an iteration after it", () => {
        const drafts = [iter("main", null, 0), iter("v1", "main", 1)];
        expect(hasLiveChildren("main", drafts)).toBe(true);
    });
    it("is true for a draft with a branch off it", () => {
        const drafts = [iter("main", null, 0), iter("v1", "main", 1), branch("b1", "v1", 2)];
        expect(hasLiveChildren("v1", drafts)).toBe(true);
    });
});

describe("collectSubtree", () => {
    it("returns just the draft when it's a leaf", () => {
        const drafts = [iter("main", null, 0), iter("v1", "main", 1)];
        expect(collectSubtree("v1", drafts)).toEqual(["v1"]);
    });
    it("collects iterations and branches transitively, root first", () => {
        // main → v1 ; branch b1 off v1 ; b1 → b2. Subtree of v1 = v1,b1,b2.
        const drafts = [
            iter("main", null, 0),
            iter("v1", "main", 1),
            branch("b1", "v1", 2),
            iter("b2", "b1", 3),
        ];
        const sub = collectSubtree("v1", drafts);
        expect(sub[0]).toBe("v1");
        expect(new Set(sub)).toEqual(new Set(["v1", "b1", "b2"]));
        expect(sub).not.toContain("main");
    });
});
