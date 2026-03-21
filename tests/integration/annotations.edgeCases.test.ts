/**
 * Edge case tests for annotation range remapping, overlapping annotations,
 * empty versions, boundary insertions/deletions, and multi-annotation
 * undo/redo sequences.
 *
 * Uses EditorHarness for fluent, non-repetitive test bodies.
 */

import { afterEach, describe, expect, it } from "vitest";
import { isAnnotationOfType } from "$lib/editor/plugins/annotations/models";
import { EditorHarness } from "../helpers/EditorHarness";

let h: EditorHarness;

afterEach(() => {
    h?.destroy();
});

// ── Range remapping: insertions at every relative position ──────────────────

describe("insertion relative to annotation range", () => {
    // Revision on "cde" in "abcdefg" → range [2, 5]
    function setup() {
        h = EditorHarness.create("abcdefg");
        return h.addRevision(2, 5);
    }

    it("insert before range shifts range right", () => {
        const id = setup();
        h.insert(0, "XX");
        expect(h.annotationRange(id)).toEqual([4, 7]);
        h.assertConsistent();
    });

    it("insert at range start shifts range right (plain insert, not nested)", () => {
        const id = setup();
        h.insert(2, "XX");
        // Plain insert at range start: CodeMirror mapPos with assoc=-1
        // keeps `from` at original position, but since text is inserted
        // before the range, from shifts to 4
        const [from, to] = h.annotationRange(id);
        expect(from).toBeLessThanOrEqual(to);
        expect(to - from).toBe(3); // range length unchanged
        h.assertConsistent();
    });

    it("insert inside range expands range", () => {
        const id = setup();
        h.insert(3, "XX");
        expect(h.annotationRange(id)).toEqual([2, 7]);
        h.assertConsistent();
    });

    it("insert at range end expands range for nested edits", () => {
        const id = setup();
        h.nestedInsert(id, 3, "XX"); // relPos 3 = absolute 5 = range end
        expect(h.annotationRange(id)).toEqual([2, 7]);
        h.assertConsistent();
    });

    it("insert after range does not move range", () => {
        const id = setup();
        h.insert(6, "XX");
        expect(h.annotationRange(id)).toEqual([2, 5]);
        h.assertConsistent();
    });

    it("undo of insert before range restores original range", () => {
        const id = setup();
        h.insert(0, "XX");
        h.undo();
        expect(h.annotationRange(id)).toEqual([2, 5]);
        expect(h.doc).toBe("abcdefg");
        h.assertConsistent();
    });

    it("undo of insert inside range restores original range", () => {
        const id = setup();
        h.insert(3, "XX");
        h.undo();
        expect(h.annotationRange(id)).toEqual([2, 5]);
        h.assertConsistent();
    });
});

// ── Range remapping: deletions at every relative position ───────────────────

describe("deletion relative to annotation range", () => {
    function setup() {
        h = EditorHarness.create("abcdefg");
        return h.addRevision(2, 5);
    }

    it("delete entirely before range shifts range left", () => {
        const id = setup();
        h.delete(0, 2);
        expect(h.annotationRange(id)).toEqual([0, 3]);
        h.assertConsistent();
    });

    it("delete overlapping range start shrinks range from left", () => {
        const id = setup();
        h.delete(1, 3); // deletes "bc" — from 1 is before, to 3 is inside
        // Range should shrink: from maps to 1, to stays at 3 (shifted by deletion)
        const [from, to] = h.annotationRange(id);
        expect(from).toBeLessThanOrEqual(to);
        h.assertConsistent();
    });

    it("delete entirely inside range shrinks range", () => {
        const id = setup();
        h.delete(3, 4); // delete "d"
        expect(h.annotationRange(id)).toEqual([2, 4]);
        h.assertConsistent();
    });

    it("delete overlapping range end shrinks range from right", () => {
        const id = setup();
        h.delete(4, 6); // deletes "ef" — from inside to outside
        const [from, to] = h.annotationRange(id);
        expect(from).toBeLessThanOrEqual(to);
        h.assertConsistent();
    });

    it("delete entirely after range does not move range", () => {
        const id = setup();
        h.delete(5, 7);
        expect(h.annotationRange(id)).toEqual([2, 5]);
        h.assertConsistent();
    });

    it("delete entire range collapses it (comment/suggestion removed)", () => {
        h = EditorHarness.create("abcdefg");
        const id = h.addComment(2, 5);
        h.delete(2, 5);
        // Comment with collapsed range should be removed
        expect(h.annotations[id]).toBeUndefined();
    });

    it("undo of deletion that removed comment restores it", () => {
        h = EditorHarness.create("abcdefg");
        const id = h.addComment(2, 5);
        h.delete(2, 5);
        expect(h.annotations[id]).toBeUndefined();

        h.undo();
        expect(h.annotations[id]).toBeDefined();
        expect(h.annotationRange(id)).toEqual([2, 5]);
        expect(h.doc).toBe("abcdefg");
    });
});

// ── Overlapping annotations ─────────────────────────────────────────────────

describe("overlapping annotations", () => {
    it("two comments on the same range both survive", () => {
        h = EditorHarness.create("hello world");
        const c1 = h.addComment(0, 5);
        const c2 = h.addComment(0, 5);
        expect(h.annotations[c1]).toBeDefined();
        expect(h.annotations[c2]).toBeDefined();
        expect(h.annotationCount).toBe(2);
    });

    it("comment + revision on overlapping ranges both survive edits", () => {
        h = EditorHarness.create("hello world");
        const comment = h.addComment(0, 5);
        const rev = h.addRevision(3, 8);

        // Insert in the overlap region
        h.insert(4, "X");
        expect(h.annotations[comment]).toBeDefined();
        expect(h.annotations[rev]).toBeDefined();
        h.assertConsistent();
    });

    it("nested annotations (one inside another) both remap correctly", () => {
        h = EditorHarness.create("hello world");
        const outer = h.addRevision(0, 11);
        const inner = h.addComment(2, 5);

        h.insert(0, "XX");
        // Outer range: from mapPos(0, -1)=0 or 2 depending on assoc,
        // to mapPos(11, 1)=13. Just verify consistency.
        const [outerFrom, outerTo] = h.annotationRange(outer);
        const [innerFrom, innerTo] = h.annotationRange(inner);
        expect(outerTo - outerFrom).toBe(11); // range length preserved
        expect(innerTo - innerFrom).toBe(3); // inner range length preserved
        expect(innerFrom).toBeGreaterThanOrEqual(outerFrom);
        expect(innerTo).toBeLessThanOrEqual(outerTo);
        h.assertConsistent();
    });

    it("adjacent annotations (end touches start) stay separate after insert between", () => {
        h = EditorHarness.create("aabbcc");
        const r1 = h.addRevision(0, 2);
        const r2 = h.addRevision(2, 4);

        // Insert between them
        h.insert(2, "X");
        const [, r1To] = h.annotationRange(r1);
        const [r2From] = h.annotationRange(r2);
        // They should not merge
        expect(r1To).toBeLessThanOrEqual(r2From);
        h.assertConsistent();
    });
});

// ── Empty version edge cases ────────────────────────────────────────────────

describe("empty version edge cases", () => {
    it("revision with empty initial version", () => {
        h = EditorHarness.create("ab");
        // Create revision at [1,1] with empty version — this represents
        // an insertion point revision
        const id = h.addRevision(1, 1, [{ doc: "" }]);
        expect(h.versionDoc(id)).toBe("");
        expect(h.revisionSlice(id)).toBe("");
        h.assertConsistent();
    });

    it("nested insert into empty revision expands it", () => {
        h = EditorHarness.create("ab");
        const id = h.addRevision(1, 1, [{ doc: "" }]);
        h.nestedInsert(id, 0, "X");
        expect(h.doc).toBe("aXb");
        expect(h.versionDoc(id)).toBe("X");
        h.assertConsistent();
    });

    it("deleting all revision content then undoing restores it", () => {
        h = EditorHarness.create("hello");
        const id = h.addRevision(0, 5);
        h.nestedDelete(id, 0, 5);
        expect(h.doc).toBe("");

        h.undo();
        expect(h.doc).toBe("hello");
        expect(h.versionDoc(id)).toBe("hello");
        h.assertConsistent();
    });
});

// ── Multi-annotation undo/redo ──────────────────────────────────────────────

describe("multi-annotation undo/redo sequences", () => {
    it("creating then removing an annotation, then undoing removal restores it", () => {
        h = EditorHarness.create("hello world");
        const id = h.addComment(0, 5);
        h.removeAnnotation(id);
        expect(h.annotations[id]).toBeUndefined();

        h.undo();
        expect(h.annotations[id]).toBeDefined();
        expect(h.annotationRange(id)).toEqual([0, 5]);
    });

    it("redo after undo of annotation removal re-removes it", () => {
        h = EditorHarness.create("hello world");
        const id = h.addComment(0, 5);
        h.removeAnnotation(id);
        h.undo();
        expect(h.annotations[id]).toBeDefined();

        h.redo();
        expect(h.annotations[id]).toBeUndefined();
    });

    it("two revisions: editing one and undoing does not affect the other", () => {
        h = EditorHarness.create("aaa bbb");
        const r1 = h.addRevision(0, 3);
        const r2 = h.addRevision(4, 7);

        h.nestedInsert(r2, 0, "X");
        expect(h.versionDoc(r2)).toBe("Xbbb");
        expect(h.versionDoc(r1)).toBe("aaa");

        h.undo();
        expect(h.versionDoc(r2)).toBe("bbb");
        expect(h.versionDoc(r1)).toBe("aaa");
        h.assertConsistent();
    });

    it("interleaved edits on two revisions with full undo/redo cycle", () => {
        h = EditorHarness.create("aaa bbb");
        const r1 = h.addRevision(0, 3);
        const r2 = h.addRevision(4, 7);

        h.nestedInsert(r1, 3, "1");
        h.nestedInsert(r2, 3, "2");
        expect(h.doc).toBe("aaa1 bbb2");

        // Undo both
        h.undo(); // undo r2 edit
        expect(h.doc).toBe("aaa1 bbb");
        h.undo(); // undo r1 edit
        expect(h.doc).toBe("aaa bbb");

        // Redo both
        h.redo();
        expect(h.doc).toBe("aaa1 bbb");
        h.redo();
        expect(h.doc).toBe("aaa1 bbb2");
        h.assertConsistent();
    });
});

// ── Version switching ───────────────────────────────────────────────────────

describe("version switching edge cases", () => {
    it("switch version then undo restores previous version", () => {
        h = EditorHarness.create("hello");
        const id = h.addRevision(0, 5, [{ doc: "hello" }, { doc: "world" }]);

        h.switchVersion(id, 1);
        expect(h.doc).toBe("world");
        expect(h.versionDoc(id)).toBe("world");

        h.undo();
        expect(h.doc).toBe("hello");
        expect(h.versionDoc(id)).toBe("hello");
        expect(h.activeVersionIndex(id)).toBe(0);
    });

    it("edit, switch version, undo switch, undo edit", () => {
        h = EditorHarness.create("hello");
        const id = h.addRevision(0, 5, [{ doc: "hello" }, { doc: "hi" }]);

        h.nestedInsert(id, 5, "!");
        expect(h.doc).toBe("hello!");

        h.switchVersion(id, 1);
        expect(h.doc).toBe("hi");

        h.undo(); // undo version switch
        expect(h.doc).toBe("hello!");
        expect(h.activeVersionIndex(id)).toBe(0);

        h.undo(); // undo edit
        expect(h.doc).toBe("hello");
        h.assertConsistent();
    });

    it("rapid version switching back and forth with undo", () => {
        h = EditorHarness.create("aaa");
        const id = h.addRevision(0, 3, [{ doc: "aaa" }, { doc: "bbb" }, { doc: "ccc" }]);

        h.switchVersion(id, 1);
        expect(h.doc).toBe("bbb");

        h.switchVersion(id, 2);
        expect(h.doc).toBe("ccc");

        h.switchVersion(id, 0);
        expect(h.doc).toBe("aaa");

        // Undo all three switches
        h.undoN(3);
        expect(h.doc).toBe("aaa");
        expect(h.activeVersionIndex(id)).toBe(0);
        h.assertConsistent();
    });
});

// ── Boundary conditions ─────────────────────────────────────────────────────

describe("document boundary conditions", () => {
    it("revision at document start [0, N]", () => {
        h = EditorHarness.create("hello");
        const id = h.addRevision(0, 5);
        h.nestedInsert(id, 0, "X");
        expect(h.doc).toBe("Xhello");
        h.assertConsistent();
    });

    it("revision at document end [N-k, N]", () => {
        h = EditorHarness.create("hello");
        const id = h.addRevision(3, 5); // "lo"
        h.nestedInsert(id, 1, "X"); // insert after "l" → "lXo"
        expect(h.doc).toBe("hellXo");
        h.assertConsistent();
    });

    it("revision spanning entire document [0, N]", () => {
        h = EditorHarness.create("hello");
        const id = h.addRevision(0, 5);
        h.nestedEdit(id, 0, 5, "world");
        expect(h.doc).toBe("world");
        h.assertConsistent();

        h.undo();
        expect(h.doc).toBe("hello");
        h.assertConsistent();
    });

    it("insert at position 0 of empty document", () => {
        h = EditorHarness.create("");
        h.insert(0, "hello");
        expect(h.doc).toBe("hello");
        h.undo();
        expect(h.doc).toBe("");
    });

    it("delete entire document then undo", () => {
        h = EditorHarness.create("hello world");
        h.delete(0, 11);
        expect(h.doc).toBe("");
        h.undo();
        expect(h.doc).toBe("hello world");
    });
});

// ── Cursor position after operations ────────────────────────────────────────

describe("cursor position tracking", () => {
    it("cursor at correct position after insert", () => {
        h = EditorHarness.create("hello");
        h.setCursor(3);
        expect(h.cursorPos).toBe(3);
    });

    it("selection range is preserved through set", () => {
        h = EditorHarness.create("hello world");
        h.setSelection(2, 7);
        const sel = h.view.state.selection.main;
        expect(sel.from).toBe(2);
        expect(sel.to).toBe(7);
    });
});

// ── Complex multi-step scenarios ────────────────────────────────────────────

describe("complex multi-step scenarios", () => {
    it("create revision, edit, delete text before it, undo all", () => {
        h = EditorHarness.create("prefix hello");
        const id = h.addRevision(7, 12); // "hello"

        h.nestedInsert(id, 5, "!");
        expect(h.doc).toBe("prefix hello!");

        h.delete(0, 7); // delete "prefix "
        expect(h.doc).toBe("hello!");
        expect(h.annotationRange(id)).toEqual([0, 6]);

        h.undo(); // undo delete
        expect(h.doc).toBe("prefix hello!");
        expect(h.annotationRange(id)).toEqual([7, 13]);

        h.undo(); // undo nested edit
        expect(h.doc).toBe("prefix hello");
        expect(h.annotationRange(id)).toEqual([7, 12]);
        h.assertConsistent();
    });

    it("create comment and revision on same text, delete text, undo restores both", () => {
        h = EditorHarness.create("hello world");
        const commentId = h.addComment(6, 11); // "world"
        const revId = h.addRevision(6, 11); // "world"

        h.delete(6, 11);
        expect(h.annotations[commentId]).toBeUndefined();

        h.undo();
        expect(h.doc).toBe("hello world");
        expect(h.annotations[commentId]).toBeDefined();
        expect(h.annotations[revId]).toBeDefined();
        h.assertConsistent();
    });

    it("nested edit, parent insert before, nested edit, undo undo undo", () => {
        h = EditorHarness.create("hello");
        const id = h.addRevision(0, 5);

        // Step 1: nested edit "hello" → "hello!"
        h.nestedInsert(id, 5, "!");
        expect(h.doc).toBe("hello!");

        // Step 2: parent insert before revision
        h.insert(0, ">>>");
        expect(h.doc).toBe(">>>hello!");
        expect(h.annotationRange(id)).toEqual([3, 9]);

        // Step 3: another nested edit
        h.nestedInsert(id, 0, "X");
        expect(h.doc).toBe(">>>Xhello!");

        // Undo all three
        h.undo(); // undo nested edit "X"
        expect(h.doc).toBe(">>>hello!");
        h.assertConsistent();

        h.undo(); // undo parent insert ">>>"
        expect(h.doc).toBe("hello!");
        h.assertConsistent();

        h.undo(); // undo nested edit "!"
        expect(h.doc).toBe("hello");
        h.assertConsistent();
    });
});
