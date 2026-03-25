/**
 * Unit tests for draftTree.ts — the pure tree-building utilities used by DraftStack.
 */
import { describe, expect, it } from "vitest";
import { hasBranching, linearChain, treeSize, type DraftNode } from "./draftTree";
import type { DocumentMeta } from "$lib/db/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDoc(id: string): DocumentMeta {
    return {
        id,
        title: id,
        createdAt: 0,
        updatedAt: 0,
        wordCount: 0,
        previewText: "",
        tags: "[]",
        deletedAt: null,
        parentDocumentId: null,
        branchedFromSnapshotId: null,
    };
}

function node(id: string, children: DraftNode[] = [], depth = 0): DraftNode {
    return { doc: makeDoc(id), children, depth };
}

// ── hasBranching ─────────────────────────────────────────────────────────────

describe("hasBranching", () => {
    it("returns false for a single node", () => {
        expect(hasBranching(node("a"))).toBe(false);
    });

    it("returns false for a linear chain", () => {
        const tree = node("a", [node("b", [node("c")])]);
        expect(hasBranching(tree)).toBe(false);
    });

    it("returns true when root has two children", () => {
        const tree = node("a", [node("b"), node("c")]);
        expect(hasBranching(tree)).toBe(true);
    });

    it("returns true when branching is deep in the tree", () => {
        const tree = node("a", [
            node("b", [
                node("c", [node("d"), node("e")]),
            ]),
        ]);
        expect(hasBranching(tree)).toBe(true);
    });

    it("returns false for a wide but non-branching structure (single child at each level)", () => {
        const tree = node("a", [node("b", [node("c", [node("d")])])]);
        expect(hasBranching(tree)).toBe(false);
    });
});

// ── linearChain ──────────────────────────────────────────────────────────────

describe("linearChain", () => {
    it("returns [root] when target is root", () => {
        const tree = node("a");
        const chain = linearChain(tree, "a");
        expect(chain.map((n) => n.doc.id)).toEqual(["a"]);
    });

    it("returns the full path to a deep node", () => {
        const tree = node("a", [node("b", [node("c")])]);
        expect(linearChain(tree, "c").map((n) => n.doc.id)).toEqual(["a", "b", "c"]);
    });

    it("returns [] when target is not in tree", () => {
        const tree = node("a", [node("b")]);
        expect(linearChain(tree, "z")).toEqual([]);
    });

    it("finds a node in a branching tree", () => {
        const tree = node("a", [node("b"), node("c", [node("d")])]);
        expect(linearChain(tree, "d").map((n) => n.doc.id)).toEqual(["a", "c", "d"]);
    });

    it("finds the first branch when both branches have the same depth", () => {
        const tree = node("a", [node("b"), node("c")]);
        const chainB = linearChain(tree, "b");
        const chainC = linearChain(tree, "c");
        expect(chainB.map((n) => n.doc.id)).toEqual(["a", "b"]);
        expect(chainC.map((n) => n.doc.id)).toEqual(["a", "c"]);
    });
});

// ── treeSize ─────────────────────────────────────────────────────────────────

describe("treeSize", () => {
    it("returns 1 for a leaf", () => {
        expect(treeSize(node("a"))).toBe(1);
    });

    it("counts all nodes in a linear chain", () => {
        expect(treeSize(node("a", [node("b", [node("c")])]))).toBe(3);
    });

    it("counts all nodes in a branching tree", () => {
        const tree = node("a", [node("b", [node("d"), node("e")]), node("c")]);
        expect(treeSize(tree)).toBe(5);
    });
});
