/**
 * Known bugs found by property-based state machine testing.
 *
 * These tests document real bugs in the annotation subsystem that were
 * discovered by the state machine fuzzer. Each test is a minimal
 * reproducer. They are marked with `.fails()` so CI stays green while
 * the bugs are tracked for fixing.
 *
 * When a bug is fixed, remove `.fails()` to turn it into a regression test.
 */

import { afterEach, describe, expect, it } from "vitest";
import { EditorHarness } from "../helpers/EditorHarness";

let h: EditorHarness;
afterEach(() => h?.destroy());

// ── Bug 1: Inverted annotation range after replace ──────────────────────────

describe("BUG: replace covering annotation range leaves inverted from > to", () => {
    it.fails("comment at [2,5] survives replace [0,6]→'X' with from=1, to=0", () => {
        h = EditorHarness.create("abcdefgh");
        const id = h.addComment(2, 5); // comment on "cde"

        // Replace [0,6] with "X" — fully covers the comment range.
        // Expected: comment should be removed (range collapsed).
        // Actual: comment survives with inverted range [1, 0].
        h.replace(0, 6, "X");

        const ann = h.annotations[id];
        if (ann) {
            // If it survived, range must at least be valid
            expect(ann.selection.main.from).toBeLessThanOrEqual(
                ann.selection.main.to,
            );
        }
        // Either removed or valid — both acceptable
    });

    it.fails("suggestion at [1,4] survives replace [0,5]→'XY' with inverted range", () => {
        h = EditorHarness.create("abcdefgh");
        const id = h.addSuggestion(1, 4, [{ text: "replacement" }]);

        h.replace(0, 5, "XY");

        const ann = h.annotations[id];
        if (ann) {
            expect(ann.selection.main.from).toBeLessThanOrEqual(
                ann.selection.main.to,
            );
        }
    });

    it.fails("comment at [1,3] survives replace [0,4]→'XYZ' with inverted range", () => {
        h = EditorHarness.create("abcdef");
        const id = h.addComment(1, 3); // comment on "bc"

        // Replace [0,4] with "XYZ" — fully covers the comment.
        h.replace(0, 4, "XYZ");

        const ann = h.annotations[id];
        if (ann) {
            expect(ann.selection.main.from).toBeLessThanOrEqual(
                ann.selection.main.to,
            );
        }
    });
});

// ── Bug 2: version.doc mismatch after deleteVersion ─────────────────────────

describe("Regression: deleteVersion version.doc sync", () => {
    it("addNewVersion then deleteVersion keeps version.doc in sync", () => {
        h = EditorHarness.create("hello");
        const id = h.addRevision(0, 5); // version 0 = "hello"

        // Add a new empty version (switches to it, replaces doc with "")
        h.addNewVersion(id);
        // Now: version 0 = "hello", version 1 = "" (active), doc = ""

        // Type into the new version
        h.nestedInsert(id, 0, "world");
        // version 1 = "world", doc = "world"

        // Delete version 1 — should switch back to version 0
        h.deleteVersion(id, 1);

        // version.doc should match the doc slice
        const vDoc = h.versionDoc(id);
        const slice = h.revisionSlice(id);
        expect(vDoc).toBe(slice);
    });
});

// ── Root cause analysis ─────────────────────────────────────────────────────
//
// The bug is in `mapRange()` in utils.ts. When `EditorSelection.map(change)`
// is called, it maps `from` with `assoc=-1` and `to` with `assoc=1`.
//
// For a replace change `{from: 0, to: 6, insert: "X"}` applied to an
// annotation at `[2, 5]`:
//   - `mapPos(2, -1)` → 1  (left side of insert, biased left)
//   - `mapPos(5, +1)` → 0  (left side of insert, biased right but still
//     before insert end since the deleted range is collapsed)
//
// This produces `from=1 > to=0`, an inverted range.
//
// `cleanRangesOf()` only checks for `from === to` (collapsed), not
// `from > to` (inverted). The annotation survives with an invalid range.
//
// Fix options:
//   1. In `cleanRangesOf()`, also filter ranges where `from > to`.
//   2. In `mapRange()`, normalize after mapping: if `from > to`, treat
//      as collapsed and remove (or for revisions, swap to [from, from]).
//   3. In the Phase 1 remapping loop, add a post-map normalization step.
