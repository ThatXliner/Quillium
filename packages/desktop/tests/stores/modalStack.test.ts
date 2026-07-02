import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import { modalStack } from "$lib/stores";
import type { ModalEntry } from "$lib/stores";
import type { EditorView } from "@codemirror/view";

// Minimal EditorView stub — modalStack only stores the reference, never calls methods.
const fakeView = {} as EditorView;

function diffEntry(id = 0): ModalEntry {
    return {
        type: "diff",
        suggestionId: id,
        parentView: fakeView,
        label: `Diff ${id}`,
    };
}

function revisionEntry(id = 0): ModalEntry {
    return {
        type: "revision",
        revisionId: id,
        parentView: fakeView,
        label: `Rev ${id}`,
    };
}

function commentEntry(id = 0, view: EditorView = fakeView): ModalEntry {
    return {
        type: "comment",
        commentId: id,
        parentView: view,
        label: `Comment ${id}`,
    };
}

beforeEach(() => {
    modalStack.clear();
});

// ── push ──────────────────────────────────────────────────────────────────────

describe("modalStack.push", () => {
    it("starts empty", () => {
        expect(get(modalStack)).toHaveLength(0);
    });

    it("adds an entry to the stack", () => {
        modalStack.push(diffEntry(1));
        expect(get(modalStack)).toHaveLength(1);
    });

    it("stacks entries in LIFO order", () => {
        modalStack.push(diffEntry(1));
        modalStack.push(revisionEntry(2));
        const stack = get(modalStack);
        expect(stack[0].type).toBe("diff");
        expect(stack[1].type).toBe("revision");
    });
});

// ── pop ───────────────────────────────────────────────────────────────────────

describe("modalStack.pop", () => {
    it("removes the topmost entry", () => {
        modalStack.push(diffEntry(1));
        modalStack.push(revisionEntry(2));
        modalStack.pop();
        const stack = get(modalStack);
        expect(stack).toHaveLength(1);
        expect(stack[0].type).toBe("diff");
    });

    it("does not throw when the stack is already empty", () => {
        expect(() => modalStack.pop()).not.toThrow();
        expect(get(modalStack)).toHaveLength(0);
    });
});

// ── popTo ─────────────────────────────────────────────────────────────────────

describe("modalStack.popTo", () => {
    it("trims the stack to the target index (inclusive)", () => {
        modalStack.push(diffEntry(0));
        modalStack.push(revisionEntry(1));
        modalStack.push(diffEntry(2));
        modalStack.popTo(1);
        expect(get(modalStack)).toHaveLength(2);
    });

    it("keeps only index 0 when called with 0", () => {
        modalStack.push(diffEntry(0));
        modalStack.push(revisionEntry(1));
        modalStack.popTo(0);
        expect(get(modalStack)).toHaveLength(1);
    });
});

// ── popToAndRebuild ───────────────────────────────────────────────────────────

describe("modalStack.popToAndRebuild", () => {
    it("trims the stack and stamps a rebuildToken on the target", () => {
        modalStack.push(diffEntry(0));
        modalStack.push(revisionEntry(1));
        modalStack.push(diffEntry(2));
        modalStack.popToAndRebuild(0);
        const stack = get(modalStack);
        expect(stack).toHaveLength(1);
        expect((stack[0] as ModalEntry & { rebuildToken?: number }).rebuildToken).toBeTypeOf(
            "number",
        );
    });

    it("each call stamps a new rebuildToken (monotonically increasing)", async () => {
        modalStack.push(diffEntry(0));
        modalStack.popToAndRebuild(0);
        const first = (get(modalStack)[0] as ModalEntry & { rebuildToken?: number }).rebuildToken!;
        // Small delay to ensure Date.now() advances
        await new Promise((r) => setTimeout(r, 2));
        modalStack.popToAndRebuild(0);
        const second = (get(modalStack)[0] as ModalEntry & { rebuildToken?: number }).rebuildToken!;
        expect(second).toBeGreaterThanOrEqual(first);
    });

    it("leaves the stack unchanged when the target index is out of bounds", () => {
        modalStack.push(diffEntry(0));
        modalStack.popToAndRebuild(5);
        // slice(0, 6) on a 1-item array returns the full array;
        // trimmed[5] is undefined so no rebuildToken is stamped
        const stack = get(modalStack);
        expect(stack).toHaveLength(1);
        expect((stack[0] as ModalEntry & { rebuildToken?: number }).rebuildToken).toBeUndefined();
    });
});

// ── duplicate-push prevention ─────────────────────────────────────────────────

describe("modalStack.push duplicate prevention — comment", () => {
    it("does not push the same comment+view twice", () => {
        modalStack.push(commentEntry(1));
        modalStack.push(commentEntry(1));
        expect(get(modalStack)).toHaveLength(1);
    });

    it("pushes a comment with a different commentId", () => {
        modalStack.push(commentEntry(1));
        modalStack.push(commentEntry(2));
        expect(get(modalStack)).toHaveLength(2);
    });

    it("pushes a comment with a different parentView", () => {
        const otherView = {} as EditorView;
        modalStack.push(commentEntry(1, fakeView));
        modalStack.push(commentEntry(1, otherView));
        expect(get(modalStack)).toHaveLength(2);
    });

    it("does not push a duplicate even when it is not at the top of the stack", () => {
        modalStack.push(commentEntry(1));
        modalStack.push(revisionEntry(2));
        modalStack.push(commentEntry(1)); // duplicate of index 0
        expect(get(modalStack)).toHaveLength(2);
    });
});

// ── clear ─────────────────────────────────────────────────────────────────────

describe("modalStack.clear", () => {
    it("empties a non-empty stack", () => {
        modalStack.push(diffEntry(0));
        modalStack.push(revisionEntry(1));
        modalStack.clear();
        expect(get(modalStack)).toHaveLength(0);
    });

    it("is idempotent on an already-empty stack", () => {
        expect(() => modalStack.clear()).not.toThrow();
        expect(get(modalStack)).toHaveLength(0);
    });
});
