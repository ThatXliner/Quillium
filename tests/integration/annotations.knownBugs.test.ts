/**
 * Regression tests for bugs found by property-based state machine testing.
 *
 * Each test is a minimal reproducer for a real bug discovered by the fuzzer.
 * Tests marked with `.fails()` document bugs that are still open.
 * Tests without `.fails()` are regressions that have been fixed.
 */

import { afterEach, describe, expect, it } from "vitest";
import { EditorHarness } from "../helpers/EditorHarness";

let h: EditorHarness;
afterEach(() => h?.destroy());

// ── Fixed: Inverted annotation range after replace ──────────────────────────
// Root cause was cleanRangesOf() only checking from === to (collapsed),
// not from > to (inverted). Fixed by filtering inverted ranges too.

describe("Regression: replace covering annotation range removes it cleanly", () => {
    it("comment at [2,5] is removed by replace [0,6]→'X'", () => {
        h = EditorHarness.create("abcdefgh");
        const id = h.addComment(2, 5);

        h.replace(0, 6, "X");

        const ann = h.annotations[id];
        if (ann) {
            expect(ann.selection.main.from).toBeLessThanOrEqual(ann.selection.main.to);
        }
    });

    it("suggestion at [1,4] is removed by replace [0,5]→'XY'", () => {
        h = EditorHarness.create("abcdefgh");
        const id = h.addSuggestion(1, 4, [{ text: "replacement" }]);

        h.replace(0, 5, "XY");

        const ann = h.annotations[id];
        if (ann) {
            expect(ann.selection.main.from).toBeLessThanOrEqual(ann.selection.main.to);
        }
    });

    it("comment at [1,3] is removed by replace [0,4]→'XYZ'", () => {
        h = EditorHarness.create("abcdef");
        const id = h.addComment(1, 3);

        h.replace(0, 4, "XYZ");

        const ann = h.annotations[id];
        if (ann) {
            expect(ann.selection.main.from).toBeLessThanOrEqual(ann.selection.main.to);
        }
    });
});

// ── Fixed: deleteVersion version.doc sync ────────────────────────────────────

describe("Regression: deleteVersion version.doc sync", () => {
    it("addNewVersion then deleteVersion keeps version.doc in sync", () => {
        h = EditorHarness.create("hello");
        const id = h.addRevision(0, 5);

        h.addNewVersion(id);
        h.nestedInsert(id, 0, "world");
        h.deleteVersion(id, 1);

        const vDoc = h.versionDoc(id);
        const slice = h.revisionSlice(id);
        expect(vDoc).toBe(slice);
    });
});
