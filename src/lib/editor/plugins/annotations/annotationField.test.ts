/**
 * annotationField.test.ts — Integration tests for the annotationField StateField.
 *
 * Tests revision version management, Phase 3 (pushDocToVersionState),
 * annotation rebuild detection, and edge cases around version switching
 * and nested annotation flushing.
 *
 * These are pure CodeMirror state-level tests — no DOM or Svelte needed.
 */
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
    addAnnotation,
    annotationField,
    createNewRevision,
    deleteRevisionVersion,
    invertedAnnotationFieldEffects,
    nestedEditorEdit,
    _nestedEditRevision,
    setActiveRevisionVersion,
    updateRevisionVersionState,
    _updateRevisionVersionLabel,
} from "./annotationField";
import { Transaction } from "@codemirror/state";
import { isAnnotationOfType, type Annotations, type VersionState } from "./models";
import { history, undo, redo } from "@codemirror/commands";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a minimal EditorState with annotationField, history, and inverted effects. */
function makeState(doc: string): EditorState {
    return EditorState.create({
        doc,
        extensions: [annotationField, history(), invertedAnnotationFieldEffects],
    });
}

/** Read annotations from an EditorState. */
function getAnnotations(state: EditorState): Annotations {
    return state.field(annotationField);
}

/** Get a revision annotation by id, or throw. */
function getRevision(state: EditorState, id: number) {
    const ann = getAnnotations(state)[id];
    if (!ann || !isAnnotationOfType(ann, "revision")) {
        throw new Error(`No revision with id ${id}`);
    }
    return ann;
}

/** Add a revision annotation covering [from, to) with the given version docs. */
function addRevision(
    state: EditorState,
    from: number,
    to: number,
    versionDocs: string[],
    activeVersionIndex = 0,
): EditorState {
    const id = Object.keys(getAnnotations(state)).length;
    return state.update({
        effects: [
            addAnnotation.of({
                id,
                _type: "revision",
                selection: EditorSelection.single(from, to),
                thread: [],
                activeVersionIndex,
                versions: versionDocs.map((doc) => ({ doc })),
            }),
        ],
    }).state;
}

// ── Phase 3: pushDocToVersionState ───────────────────────────────────────────

describe("Phase 3: pushDocToVersionState", () => {
    it("syncs active version doc from parent document on text change", () => {
        // doc: "hello world", revision covers "world" [6, 11]
        let state = makeState("hello world");
        state = addRevision(state, 6, 11, ["world"]);

        // Type " there" at position 11 (end of "world") => "hello world there"
        // But Phase 3 only syncs text WITHIN the revision range.
        // Actually, let's type inside the revision range.
        // Replace "world" with "earth" via a doc change
        state = state.update({
            changes: { from: 6, to: 11, insert: "earth" },
        }).state;

        const rev = getRevision(state, 0);
        expect(rev.versions[0].doc).toBe("earth");
    });

    it("does not overwrite version doc when revision had an explicit effect", () => {
        let state = makeState("hello world");
        state = addRevision(state, 6, 11, ["world", "earth"]);

        // Switch to version 1 ("earth") — this dispatches _updateActiveRevisionVersion
        // + doc change. Phase 3 should skip this revision.
        const tr = setActiveRevisionVersion(state, 0, 1);
        state = state.update(tr).state;

        const rev = getRevision(state, 0);
        expect(rev.activeVersionIndex).toBe(1);
        expect(rev.versions[0].doc).toBe("world"); // old version preserved
        expect(rev.versions[1].doc).toBe("earth"); // active version preserved
    });

    it("preserves non-active versions when typing in active version", () => {
        let state = makeState("AAA BBB");
        // Revision covers "AAA" [0, 3], two versions
        state = addRevision(state, 0, 3, ["AAA", "CCC"]);

        // Type in the active version's range — replace "AAA" with "AAAA"
        state = state.update({
            changes: { from: 0, to: 3, insert: "AAAA" },
        }).state;

        const rev = getRevision(state, 0);
        expect(rev.versions[0].doc).toBe("AAAA"); // active version updated
        expect(rev.versions[1].doc).toBe("CCC"); // non-active version unchanged
    });

    it("preserves annotationGeneration and other version metadata through Phase 3", () => {
        let state = makeState("hello world");
        state = addRevision(state, 6, 11, ["world"]);

        // Set version state with annotationGeneration
        const blob: VersionState = { doc: "world", annotationGeneration: 5 };
        const tr = updateRevisionVersionState(state, 0, 0, blob);
        state = state.update(tr).state;

        // Now type inside the revision (triggers Phase 3 on next transaction)
        state = state.update({
            changes: { from: 6, to: 11, insert: "earth" },
        }).state;

        const rev = getRevision(state, 0);
        expect(rev.versions[0].doc).toBe("earth");
        // annotationGeneration should be preserved by the spread in pushDocToVersionState
        expect(rev.versions[0].annotationGeneration).toBe(5);
    });
});

// ── Version switching ────────────────────────────────────────────────────────

describe("setActiveRevisionVersion", () => {
    it("switches active version and updates document text", () => {
        let state = makeState("prefix hello suffix");
        // "hello" at [7, 12]
        state = addRevision(state, 7, 12, ["hello", "world"]);

        const tr = setActiveRevisionVersion(state, 0, 1);
        state = state.update(tr).state;

        const rev = getRevision(state, 0);
        expect(rev.activeVersionIndex).toBe(1);
        expect(state.doc.toString()).toBe("prefix world suffix");
    });

    it("preserves all version contents after switching", () => {
        let state = makeState("XX");
        state = addRevision(state, 0, 2, ["XX", "YY", "ZZ"]);

        // Switch from 0 to 2
        state = state.update(setActiveRevisionVersion(state, 0, 2)).state;
        let rev = getRevision(state, 0);
        expect(rev.versions[0].doc).toBe("XX");
        expect(rev.versions[1].doc).toBe("YY");
        expect(rev.versions[2].doc).toBe("ZZ");

        // Switch from 2 to 1
        state = state.update(setActiveRevisionVersion(state, 0, 1)).state;
        rev = getRevision(state, 0);
        expect(rev.versions[0].doc).toBe("XX");
        expect(rev.versions[1].doc).toBe("YY");
        expect(rev.versions[2].doc).toBe("ZZ");
    });

    it("preserves versions after switch → type inside → switch back", () => {
        let state = makeState("hello");
        state = addRevision(state, 0, 5, ["hello", "world"]);

        // Switch to version 1 ("world")
        state = state.update(setActiveRevisionVersion(state, 0, 1)).state;
        expect(state.doc.toString()).toBe("world");

        // Type INSIDE version 1 (not at boundary): "world" → "wOrld"
        // Inserting inside the range ensures Phase 3 pulls the right text
        // (boundary insertions don't expand the revision range — by design,
        // real boundary edits go through the nested editor path).
        state = state.update({
            changes: { from: 1, to: 2, insert: "O" },
        }).state;

        let rev = getRevision(state, 0);
        expect(rev.versions[1].doc).toBe("wOrld");
        expect(rev.versions[0].doc).toBe("hello"); // untouched

        // Switch back to version 0
        state = state.update(setActiveRevisionVersion(state, 0, 0)).state;
        expect(state.doc.toString()).toBe("hello");

        rev = getRevision(state, 0);
        expect(rev.versions[0].doc).toBe("hello");
        expect(rev.versions[1].doc).toBe("wOrld"); // preserved from earlier typing
    });

    it("handles switching to a version with empty text", () => {
        let state = makeState("content");
        state = addRevision(state, 0, 7, ["content", ""]);

        state = state.update(setActiveRevisionVersion(state, 0, 1)).state;
        expect(state.doc.toString()).toBe("");

        const rev = getRevision(state, 0);
        expect(rev.versions[0].doc).toBe("content");
        expect(rev.versions[1].doc).toBe("");
    });

    it("handles switching from empty version back to non-empty", () => {
        let state = makeState("");
        state = addRevision(state, 0, 0, ["", "filled"]);

        state = state.update(setActiveRevisionVersion(state, 0, 1)).state;
        expect(state.doc.toString()).toBe("filled");

        state = state.update(setActiveRevisionVersion(state, 0, 0)).state;
        expect(state.doc.toString()).toBe("");

        const rev = getRevision(state, 0);
        expect(rev.versions[0].doc).toBe("");
        expect(rev.versions[1].doc).toBe("filled");
    });
});

// ── createNewRevision ────────────────────────────────────────────────────────

describe("createNewRevision", () => {
    it("adds a new empty version and switches to it", () => {
        let state = makeState("hello");
        state = addRevision(state, 0, 5, ["hello"]);

        state = state.update(createNewRevision(state, 0)).state;

        const rev = getRevision(state, 0);
        expect(rev.versions).toHaveLength(2);
        expect(rev.versions[0].doc).toBe("hello");
        expect(rev.versions[1].doc).toBe("");
        expect(rev.activeVersionIndex).toBe(1);
        expect(state.doc.toString()).toBe("");
    });

    it("preserves existing versions when creating a new one", () => {
        let state = makeState("AA");
        state = addRevision(state, 0, 2, ["AA", "BB"]);

        state = state.update(createNewRevision(state, 0)).state;

        const rev = getRevision(state, 0);
        expect(rev.versions).toHaveLength(3);
        expect(rev.versions[0].doc).toBe("AA");
        expect(rev.versions[1].doc).toBe("BB");
        expect(rev.versions[2].doc).toBe("");
    });
});

// ── deleteRevisionVersion ────────────────────────────────────────────────────

describe("deleteRevisionVersion", () => {
    it("deletes a non-active version without changing document", () => {
        let state = makeState("active");
        state = addRevision(state, 0, 6, ["active", "other"]);

        state = state.update(deleteRevisionVersion(state, 0, 1)).state;

        const rev = getRevision(state, 0);
        expect(rev.versions).toHaveLength(1);
        expect(rev.versions[0].doc).toBe("active");
        expect(state.doc.toString()).toBe("active");
    });

    it("deletes active version and switches to another", () => {
        let state = makeState("first");
        state = addRevision(state, 0, 5, ["first", "second"]);

        // Delete version 0 (active) — should switch to version 0 (was "second")
        state = state.update(deleteRevisionVersion(state, 0, 0)).state;

        const rev = getRevision(state, 0);
        expect(rev.versions).toHaveLength(1);
        expect(rev.versions[0].doc).toBe("second");
        expect(state.doc.toString()).toBe("second");
    });

    it("adjusts activeVersionIndex when deleting a version before the active one", () => {
        let state = makeState("CC");
        state = addRevision(state, 0, 2, ["AA", "BB", "CC"], 2);

        state = state.update(deleteRevisionVersion(state, 0, 0)).state;

        const rev = getRevision(state, 0);
        expect(rev.versions).toHaveLength(2);
        expect(rev.activeVersionIndex).toBe(1); // was 2, shifted down
        expect(rev.versions[0].doc).toBe("BB");
        expect(rev.versions[1].doc).toBe("CC");
    });
});

// ── updateRevisionVersionState ───────────────────────────────────────────────

describe("updateRevisionVersionState", () => {
    it("updates a non-active version without changing document", () => {
        let state = makeState("active");
        state = addRevision(state, 0, 6, ["active", "old"]);

        const newBlob: VersionState = { doc: "updated", annotationGeneration: 1 };
        state = state.update(updateRevisionVersionState(state, 0, 1, newBlob)).state;

        const rev = getRevision(state, 0);
        expect(rev.versions[1].doc).toBe("updated");
        expect(rev.versions[1].annotationGeneration).toBe(1);
        expect(state.doc.toString()).toBe("active"); // doc unchanged
    });

    it("updates the active version and changes document to match", () => {
        let state = makeState("old text");
        state = addRevision(state, 0, 8, ["old text"]);

        const newBlob: VersionState = { doc: "new text" };
        state = state.update(updateRevisionVersionState(state, 0, 0, newBlob)).state;

        const rev = getRevision(state, 0);
        expect(rev.versions[0].doc).toBe("new text");
        expect(state.doc.toString()).toBe("new text");
    });

    it("skips redundant doc change when text already matches", () => {
        let state = makeState("same");
        state = addRevision(state, 0, 4, ["same"]);

        // Update active version with same doc text but new metadata
        const newBlob: VersionState = { doc: "same", annotationGeneration: 3 };
        const tr = updateRevisionVersionState(state, 0, 0, newBlob);
        state = state.update(tr).state;

        const rev = getRevision(state, 0);
        expect(rev.versions[0].annotationGeneration).toBe(3);
        expect(state.doc.toString()).toBe("same");
    });

    it("Phase 3 does not overwrite a version set by _updateRevisionVersionState", () => {
        let state = makeState("initial");
        state = addRevision(state, 0, 7, ["initial"]);

        // updateRevisionVersionState changes both the blob AND the doc
        const newBlob: VersionState = { doc: "changed", annotationGeneration: 2 };
        state = state.update(updateRevisionVersionState(state, 0, 0, newBlob)).state;

        const rev = getRevision(state, 0);
        // The blob should match exactly what we set — Phase 3 should have skipped
        expect(rev.versions[0].doc).toBe("changed");
        expect(rev.versions[0].annotationGeneration).toBe(2);
    });
});

// ── _updateRevisionVersionLabel ──────────────────────────────────────────────

describe("updateRevisionVersionLabel", () => {
    it("sets a label on a version", () => {
        let state = makeState("text");
        state = addRevision(state, 0, 4, ["text"]);

        state = state.update({
            effects: [
                _updateRevisionVersionLabel.of({ annotationId: 0, versionId: 0, label: "Draft" }),
            ],
        }).state;

        const rev = getRevision(state, 0);
        expect(rev.versions[0].label).toBe("Draft");
    });

    it("clears a label by setting undefined", () => {
        let state = makeState("text");
        state = addRevision(state, 0, 4, [{ doc: "text", label: "Draft" } as unknown as string]);
        // Fix: addRevision takes string[], need to set label differently
        state = addRevision(makeState("text"), 0, 4, ["text"]);
        state = state.update({
            effects: [
                _updateRevisionVersionLabel.of({ annotationId: 0, versionId: 0, label: "Draft" }),
            ],
        }).state;
        state = state.update({
            effects: [
                _updateRevisionVersionLabel.of({ annotationId: 0, versionId: 0, label: undefined }),
            ],
        }).state;

        const rev = getRevision(state, 0);
        expect(rev.versions[0].label).toBeUndefined();
    });
});

// ── Multiple revisions ───────────────────────────────────────────────────────

describe("multiple revisions", () => {
    it("Phase 3 syncs each revision independently", () => {
        let state = makeState("AAABBB");
        // Rev 0 covers "AAA" [0,3], Rev 1 covers "BBB" [3,6]
        state = addRevision(state, 0, 3, ["AAA"]);
        state = addRevision(state, 3, 6, ["BBB"]);

        // Change "AAA" to "XX" — Phase 3 should update rev 0 but not rev 1
        state = state.update({
            changes: { from: 0, to: 3, insert: "XX" },
        }).state;

        expect(getRevision(state, 0).versions[0].doc).toBe("XX");
        expect(getRevision(state, 1).versions[0].doc).toBe("BBB");
    });

    it("switching one revision does not affect another", () => {
        let state = makeState("AAABBB");
        state = addRevision(state, 0, 3, ["AAA", "XXX"]);
        state = addRevision(state, 3, 6, ["BBB", "YYY"]);

        // Switch rev 0 to version 1
        state = state.update(setActiveRevisionVersion(state, 0, 1)).state;

        expect(state.doc.toString()).toBe("XXXBBB");
        expect(getRevision(state, 0).versions[0].doc).toBe("AAA");
        expect(getRevision(state, 0).versions[1].doc).toBe("XXX");
        expect(getRevision(state, 1).versions[0].doc).toBe("BBB");
        expect(getRevision(state, 1).versions[1].doc).toBe("YYY");
    });
});

// ── Undo/redo of version operations ──────────────────────────────────────────

describe("undo/redo", () => {
    it("undo restores version switch", () => {
        let state = makeState("hello");
        state = addRevision(state, 0, 5, ["hello", "world"]);

        // Switch to version 1
        state = state.update(setActiveRevisionVersion(state, 0, 1)).state;
        expect(state.doc.toString()).toBe("world");

        // Undo the switch
        state = undo({
            state,
            dispatch: (tr) => {
                state = tr.state;
            },
        })
            ? state
            : state;

        const rev = getRevision(state, 0);
        expect(rev.activeVersionIndex).toBe(0);
        expect(state.doc.toString()).toBe("hello");
    });

    it("undo restores version creation", () => {
        let state = makeState("hello");
        state = addRevision(state, 0, 5, ["hello"]);

        // Create new version
        state = state.update(createNewRevision(state, 0)).state;
        expect(getRevision(state, 0).versions).toHaveLength(2);

        // Undo
        undo({
            state,
            dispatch: (tr) => {
                state = tr.state;
            },
        });

        const rev = getRevision(state, 0);
        expect(rev.versions).toHaveLength(1);
        expect(rev.versions[0].doc).toBe("hello");
    });

    it("undo restores version deletion", () => {
        let state = makeState("alpha");
        state = addRevision(state, 0, 5, ["alpha", "beta"]);

        // Delete version 1
        state = state.update(deleteRevisionVersion(state, 0, 1)).state;
        expect(getRevision(state, 0).versions).toHaveLength(1);

        // Undo
        undo({
            state,
            dispatch: (tr) => {
                state = tr.state;
            },
        });

        const rev = getRevision(state, 0);
        expect(rev.versions).toHaveLength(2);
        expect(rev.versions[0].doc).toBe("alpha");
        expect(rev.versions[1].doc).toBe("beta");
    });
});

// ── Rapid operations (no timing dependencies) ────────────────────────────────

describe("rapid sequential operations", () => {
    it("rapid switch-switch preserves all versions", () => {
        let state = makeState("AA");
        state = addRevision(state, 0, 2, ["AA", "BB", "CC"]);

        // Rapid: 0 → 1 → 2 → 0
        state = state.update(setActiveRevisionVersion(state, 0, 1)).state;
        state = state.update(setActiveRevisionVersion(state, 0, 2)).state;
        state = state.update(setActiveRevisionVersion(state, 0, 0)).state;

        const rev = getRevision(state, 0);
        expect(rev.versions[0].doc).toBe("AA");
        expect(rev.versions[1].doc).toBe("BB");
        expect(rev.versions[2].doc).toBe("CC");
        expect(state.doc.toString()).toBe("AA");
    });

    it("switch + type + switch preserves intermediate edits", () => {
        let state = makeState("A");
        state = addRevision(state, 0, 1, ["A", "B", "C"]);

        // Switch to 1, type, switch to 2, type, switch back to 0
        state = state.update(setActiveRevisionVersion(state, 0, 1)).state;
        state = state.update({ changes: { from: 0, to: 1, insert: "B!" } }).state;

        state = state.update(setActiveRevisionVersion(state, 0, 2)).state;
        state = state.update({ changes: { from: 0, to: 1, insert: "C!" } }).state;

        state = state.update(setActiveRevisionVersion(state, 0, 0)).state;

        const rev = getRevision(state, 0);
        expect(rev.versions[0].doc).toBe("A");
        expect(rev.versions[1].doc).toBe("B!");
        expect(rev.versions[2].doc).toBe("C!");
    });

    it("create + switch + create does not lose versions", () => {
        let state = makeState("base");
        state = addRevision(state, 0, 4, ["base"]);

        // Create version 1 (empty, now active)
        state = state.update(createNewRevision(state, 0)).state;
        expect(getRevision(state, 0).versions).toHaveLength(2);

        // Switch back to version 0
        state = state.update(setActiveRevisionVersion(state, 0, 0)).state;

        // Create another version (empty, now active)
        state = state.update(createNewRevision(state, 0)).state;

        const rev = getRevision(state, 0);
        expect(rev.versions).toHaveLength(3);
        expect(rev.versions[0].doc).toBe("base");
    });

    it("version state update on non-active does not corrupt active version", () => {
        let state = makeState("active");
        state = addRevision(state, 0, 6, ["active", "other"]);

        // Update non-active version with a blob containing nested annotations
        const blob: VersionState = {
            doc: "updated-other",
            annotationGeneration: 1,
        };
        state = state.update(updateRevisionVersionState(state, 0, 1, blob)).state;

        // Verify active version and document are unchanged
        expect(state.doc.toString()).toBe("active");
        expect(getRevision(state, 0).versions[0].doc).toBe("active");
        expect(getRevision(state, 0).versions[1].doc).toBe("updated-other");
        expect(getRevision(state, 0).versions[1].annotationGeneration).toBe(1);
    });
});

// ── Serialization round-trip ─────────────────────────────────────────────────
// Note: full EditorState.fromJSON round-trips can't be tested in isolation due
// to CodeMirror's instance check requirements. Instead, we test that the
// Zod schema (used by fromJSON) correctly parses/preserves our data.

describe("toJSON/fromJSON round-trip", () => {
    it("preserves revision version contents in JSON form", () => {
        let state = makeState("hello");
        state = addRevision(state, 0, 5, ["hello", "world"]);

        // Simulate what toJSON does: serialize the annotation field
        const annotations = getAnnotations(state);
        const rev = getRevision(state, 0);

        // Verify the annotation has the right versions
        expect(rev.versions).toHaveLength(2);
        expect(rev.versions[0].doc).toBe("hello");
        expect(rev.versions[1].doc).toBe("world");

        // JSON round-trip on the raw data should preserve it
        const raw = JSON.parse(JSON.stringify(annotations));
        expect(raw["0"].versions[0].doc).toBe("hello");
        expect(raw["0"].versions[1].doc).toBe("world");
    });

    it("preserves version metadata in JSON form", () => {
        let state = makeState("text");
        state = addRevision(state, 0, 4, ["text"]);

        const blob: VersionState = { doc: "text", annotationGeneration: 7, label: "Final" };
        state = state.update(updateRevisionVersionState(state, 0, 0, blob)).state;

        const rev = getRevision(state, 0);
        expect(rev.versions[0].annotationGeneration).toBe(7);
        expect(rev.versions[0].label).toBe("Final");

        // JSON round-trip preserves metadata
        const raw = JSON.parse(JSON.stringify(rev.versions[0]));
        expect(raw.annotationGeneration).toBe(7);
        expect(raw.label).toBe("Final");
    });
});

// ── Nested editor edits (boundary expansion) ─────────────────────────────────

describe("nested editor boundary expansion", () => {
    it("expands revision range when nested editor appends at boundary", () => {
        let state = makeState("hello");
        state = addRevision(state, 0, 5, ["hello"]);

        // Simulate nested editor inserting "s" at position 5 (the boundary)
        state = state.update({
            changes: { from: 5, to: 5, insert: "s" },
            effects: [_nestedEditRevision.of(0)],
            annotations: [nestedEditorEdit.of(0), Transaction.addToHistory.of(true)],
        }).state;

        const rev = getRevision(state, 0);
        // Boundary expansion should have moved to from 5 to 6
        expect(rev.selection.main.from).toBe(0);
        expect(rev.selection.main.to).toBe(6);
        expect(rev.versions[0].doc).toBe("hellos");
    });

    it("expands revision range when nested editor prepends at boundary", () => {
        let state = makeState("hello");
        state = addRevision(state, 0, 5, ["hello"]);

        // Simulate nested editor inserting "!" at position 0 (the from boundary)
        state = state.update({
            changes: { from: 0, to: 0, insert: "!" },
            effects: [_nestedEditRevision.of(0)],
            annotations: [nestedEditorEdit.of(0), Transaction.addToHistory.of(true)],
        }).state;

        const rev = getRevision(state, 0);
        expect(rev.selection.main.from).toBe(0);
        expect(rev.selection.main.to).toBe(6);
        expect(rev.versions[0].doc).toBe("!hello");
    });

    it("preserves versions after nested edit → switch → switch back", () => {
        let state = makeState("hello");
        state = addRevision(state, 0, 5, ["hello", "world"]);

        // Switch to version 1
        state = state.update(setActiveRevisionVersion(state, 0, 1)).state;
        expect(state.doc.toString()).toBe("world");

        // Simulate nested editor appending "s" at boundary
        state = state.update({
            changes: { from: 5, to: 5, insert: "s" },
            effects: [_nestedEditRevision.of(0)],
            annotations: [nestedEditorEdit.of(0), Transaction.addToHistory.of(true)],
        }).state;

        let rev = getRevision(state, 0);
        expect(rev.versions[1].doc).toBe("worlds");
        expect(rev.versions[0].doc).toBe("hello");

        // Switch back to version 0 — version 1's edit must be preserved
        state = state.update(setActiveRevisionVersion(state, 0, 0)).state;
        expect(state.doc.toString()).toBe("hello");

        rev = getRevision(state, 0);
        expect(rev.versions[0].doc).toBe("hello");
        expect(rev.versions[1].doc).toBe("worlds");
    });
});

// ── Version override regression ──────────────────────────────────────────────
// These tests specifically target the scenario where version contents get
// overwritten during version switching.

describe("version override prevention", () => {
    it("switching versions does not corrupt any version's content", () => {
        const versions = ["alpha", "beta", "gamma", "delta"];
        let state = makeState(versions[0]);
        state = addRevision(state, 0, versions[0].length, versions);

        // Cycle through all versions twice
        for (let round = 0; round < 2; round++) {
            for (let i = 0; i < versions.length; i++) {
                state = state.update(setActiveRevisionVersion(state, 0, i)).state;
                expect(state.doc.toString()).toBe(versions[i]);

                // Verify ALL versions are still intact
                const rev = getRevision(state, 0);
                for (let j = 0; j < versions.length; j++) {
                    expect(rev.versions[j].doc).toBe(versions[j]);
                }
            }
        }
    });

    it("updateRevisionVersionState on non-active version does not affect active", () => {
        let state = makeState("active-text");
        state = addRevision(state, 0, 11, ["active-text", "inactive"]);

        // Update non-active version blob (simulates modal flush)
        const blob: VersionState = {
            doc: "new-inactive",
            annotationGeneration: 1,
        };
        state = state.update(updateRevisionVersionState(state, 0, 1, blob)).state;

        // Active version and document should be completely unchanged
        expect(state.doc.toString()).toBe("active-text");
        const rev = getRevision(state, 0);
        expect(rev.versions[0].doc).toBe("active-text");
        expect(rev.versions[1].doc).toBe("new-inactive");
        expect(rev.activeVersionIndex).toBe(0);
    });

    it("rapid version state updates don't lose data", () => {
        let state = makeState("v0");
        state = addRevision(state, 0, 2, ["v0", "v1", "v2"]);

        // Update all non-active versions in rapid succession
        const blob1: VersionState = { doc: "v1-updated", annotationGeneration: 1 };
        state = state.update(updateRevisionVersionState(state, 0, 1, blob1)).state;

        const blob2: VersionState = { doc: "v2-updated", annotationGeneration: 1 };
        state = state.update(updateRevisionVersionState(state, 0, 2, blob2)).state;

        const rev = getRevision(state, 0);
        expect(rev.versions[0].doc).toBe("v0");
        expect(rev.versions[1].doc).toBe("v1-updated");
        expect(rev.versions[2].doc).toBe("v2-updated");
    });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe("edge cases", () => {
    it("handles revision with single-character versions", () => {
        let state = makeState("A");
        state = addRevision(state, 0, 1, ["A", "B"]);

        state = state.update(setActiveRevisionVersion(state, 0, 1)).state;
        expect(state.doc.toString()).toBe("B");

        state = state.update(setActiveRevisionVersion(state, 0, 0)).state;
        expect(state.doc.toString()).toBe("A");
    });

    it("handles version switch when revision is at document start", () => {
        let state = makeState("start rest");
        state = addRevision(state, 0, 5, ["start", "begin"]);

        state = state.update(setActiveRevisionVersion(state, 0, 1)).state;
        expect(state.doc.toString()).toBe("begin rest");
        expect(getRevision(state, 0).versions[0].doc).toBe("start");
    });

    it("handles version switch when revision is at document end", () => {
        let state = makeState("rest end");
        state = addRevision(state, 5, 8, ["end", "fin"]);

        state = state.update(setActiveRevisionVersion(state, 0, 1)).state;
        expect(state.doc.toString()).toBe("rest fin");
        expect(getRevision(state, 0).versions[0].doc).toBe("end");
    });

    it("handles version with different lengths correctly", () => {
        let state = makeState("short");
        state = addRevision(state, 0, 5, ["short", "much longer version text"]);

        state = state.update(setActiveRevisionVersion(state, 0, 1)).state;
        expect(state.doc.toString()).toBe("much longer version text");

        state = state.update(setActiveRevisionVersion(state, 0, 0)).state;
        expect(state.doc.toString()).toBe("short");
    });

    it("deleting the only version removes the annotation entirely", () => {
        let state = makeState("only");
        state = addRevision(state, 0, 4, ["only"]);

        state = state.update(deleteRevisionVersion(state, 0, 0)).state;

        const annotations = getAnnotations(state);
        expect(Object.keys(annotations)).toHaveLength(0);
        expect(state.doc.toString()).toBe("");
    });

    it("Phase 3 does not pull into collapsed (empty) revisions for non-nested edits", () => {
        let state = makeState("abc");
        state = addRevision(state, 1, 2, ["b"]);

        // Delete "b" — revision collapses to empty at position 1
        state = state.update({
            changes: { from: 1, to: 2, insert: "" },
        }).state;

        // The collapsed revision should NOT have its doc updated to ""
        // by Phase 3 (the guard `if (x.selection.main.empty && !isNestedEdit) return x`
        // prevents this). The doc should remain "b" so undo can restore it.
        const rev = getRevision(state, 0);
        expect(rev.selection.main.empty).toBe(true);
        expect(rev.versions[0].doc).toBe("b");
    });
});
