import type { DraftMeta } from "$lib/db/types";
import { buildDraftTree, flattenDraftTree, isDeletableDraft } from "$lib/editor/draftTree";
import { describe, expect, it } from "vitest";

function makeDraft(
    id: string,
    parentDraftId: string | null = null,
    createdAt = 0,
    locked = false,
): DraftMeta {
    return {
        id,
        documentId: "doc-1",
        label: id,
        createdAt,
        isActive: true,
        tabId: "tab-1",
        parentDraftId,
        locked,
    };
}

describe("buildDraftTree", () => {
    it("returns an empty list for no drafts", () => {
        expect(buildDraftTree([])).toEqual([]);
    });

    it("builds a single root for one draft", () => {
        const roots = buildDraftTree([makeDraft("main")]);
        expect(roots).toHaveLength(1);
        expect(roots[0].draft.id).toBe("main");
        expect(roots[0].depth).toBe(0);
        expect(roots[0].children).toHaveLength(0);
    });

    it("links children to parents with increasing depth", () => {
        const roots = buildDraftTree([
            makeDraft("main", null, 0),
            makeDraft("v1", "main", 1),
            makeDraft("v1.5", "v1", 2),
        ]);
        expect(roots).toHaveLength(1);
        const main = roots[0];
        expect(main.children).toHaveLength(1);
        expect(main.children[0].draft.id).toBe("v1");
        expect(main.children[0].depth).toBe(1);
        expect(main.children[0].children[0].draft.id).toBe("v1.5");
        expect(main.children[0].children[0].depth).toBe(2);
    });

    it("orders siblings by creation time", () => {
        const roots = buildDraftTree([
            makeDraft("main", null, 0),
            makeDraft("later", "main", 10),
            makeDraft("earlier", "main", 5),
        ]);
        expect(roots[0].children.map((c) => c.draft.id)).toEqual(["earlier", "later"]);
    });

    it("treats drafts with missing parents as roots", () => {
        const roots = buildDraftTree([makeDraft("main", null, 0), makeDraft("orphan", "gone", 1)]);
        expect(roots.map((r) => r.draft.id)).toEqual(["main", "orphan"]);
        expect(roots[1].depth).toBe(0);
    });

    it("supports multiple branches from one parent", () => {
        const roots = buildDraftTree([
            makeDraft("main", null, 0),
            makeDraft("a", "main", 1),
            makeDraft("b", "main", 2),
        ]);
        expect(roots[0].children.map((c) => c.draft.id)).toEqual(["a", "b"]);
    });
});

describe("flattenDraftTree", () => {
    it("flattens in DFS order, parents before children", () => {
        const roots = buildDraftTree([
            makeDraft("main", null, 0),
            makeDraft("v1", "main", 1),
            makeDraft("v2", "main", 3),
            makeDraft("v1.5", "v1", 2),
        ]);
        const flat = flattenDraftTree(roots).map((n) => n.draft.id);
        expect(flat).toEqual(["main", "v1", "v1.5", "v2"]);
    });

    it("returns empty for empty input", () => {
        expect(flattenDraftTree([])).toEqual([]);
    });
});

describe("isDeletableDraft", () => {
    it("rejects the only draft in a tab", () => {
        const drafts = [makeDraft("main")];
        expect(isDeletableDraft("main", drafts)).toBe(false);
    });

    it("rejects drafts that have children", () => {
        const drafts = [makeDraft("main"), makeDraft("v1", "main", 1)];
        expect(isDeletableDraft("main", drafts)).toBe(false);
    });

    it("allows leaf drafts when siblings exist", () => {
        const drafts = [makeDraft("main"), makeDraft("v1", "main", 1)];
        expect(isDeletableDraft("v1", drafts)).toBe(true);
    });
});
