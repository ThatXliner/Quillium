import {
    deleteRevisionVersion as _deleteRevisionVersion,
    _nestedEditRevision,
    setActiveRevisionVersion as _setActiveRevisionVersion,
    _updateRevisionVersionLabel,
    updateRevisionVersionState as _updateRevisionVersionState,
    addAnnotation,
    annotationField,
    applySuggestion,
    createNewRevision,
    deserializeAnnotationHistoryEffect,
    invertedAnnotationFieldEffects,
    nestedEditorEdit,
    removeAnnotation,
    revisionInternalEdit,
    updateThread,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    type Annotations,
    type GenericAnnotation,
    activeVersionIndex as activeVersionIndexOf,
    isAnnotationOfType,
    makeVersion,
} from "$lib/editor/plugins/annotations/models";
import { history, isolateHistory, redo, undo, undoDepth } from "@codemirror/commands";
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
import type { TransactionSpec } from "@codemirror/state";
import { Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";

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

// Positional index of the active version (versions migrated to stable ids).
function activeVersionIndex(rev: ReturnType<typeof getRevision>): number {
    return activeVersionIndexOf(rev);
}

// Resolve a positional version index to its stable id off the live state.
function versionIdAt(state: EditorState, id: number, index: number): string {
    return getRevision(state, id).versions[index].id;
}

// Index-based wrappers around the now id-based builders, keeping the existing
// index-oriented test bodies declarative.
function setActiveRevisionVersion(state: EditorState, id: number, index: number): TransactionSpec {
    return _setActiveRevisionVersion(state, id, versionIdAt(state, id, index));
}
function deleteRevisionVersion(state: EditorState, id: number, index: number): TransactionSpec {
    return _deleteRevisionVersion(state, id, versionIdAt(state, id, index));
}
// A version blob without a stable id (the reducer assigns the target version's
// id, so the blob's id is irrelevant). May carry extra fields (e.g. nested
// annotationField) for the sub-annotation tests.
type TestBlob = { doc: string; label?: string } & Record<string, unknown>;
function updateRevisionVersionState(
    state: EditorState,
    id: number,
    index: number,
    blob: TestBlob,
    options?: { addToHistory?: boolean },
): TransactionSpec {
    // The reducer overrides the id with the target version's; mint a throwaway
    // one only to satisfy the VersionState signature.
    return _updateRevisionVersionState(
        state,
        id,
        versionIdAt(state, id, index),
        makeVersion(blob),
        options,
    );
}

/** Add a revision annotation covering [from, to) with the given version docs. */
function addRevision(
    state: EditorState,
    from: number,
    to: number,
    versionDocs: Array<string | ({ doc: string } & Record<string, unknown>)>,
    activeIndex = 0,
): EditorState {
    const id = Object.keys(getAnnotations(state)).length;
    const versions = versionDocs.map((v) => makeVersion(typeof v === "string" ? { doc: v } : v));
    return state.update({
        effects: [
            addAnnotation.of({
                id,
                _type: "revision",
                status: "active" as const,
                selection: EditorSelection.single(from, to),
                thread: [],
                activeVersionId: versions[activeIndex].id,
                versions,
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
        expect(activeVersionIndex(rev)).toBe(1);
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

    it("preserves label and other version metadata through Phase 3", () => {
        let state = makeState("hello world");
        state = addRevision(state, 6, 11, ["world"]);

        // Set version state with a label
        const blob: TestBlob = { doc: "world", label: "test-label" };
        const tr = updateRevisionVersionState(state, 0, 0, blob);
        state = state.update(tr).state;

        // Now type inside the revision (triggers Phase 3 on next transaction)
        state = state.update({
            changes: { from: 6, to: 11, insert: "earth" },
        }).state;

        const rev = getRevision(state, 0);
        expect(rev.versions[0].doc).toBe("earth");
        // label should be preserved by the spread in pushDocToVersionState
        expect(rev.versions[0].label).toBe("test-label");
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
        expect(activeVersionIndex(rev)).toBe(1);
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
        expect(activeVersionIndex(rev)).toBe(1);
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

    it("does not join version creation with an adjacent parent deletion", () => {
        let state = makeState("aa");
        state = addRevision(state, 1, 2, ["a", ""]);

        state = state.update(createNewRevision(state, 0)).state;
        const depthAfterVersionCreation = undoDepth(state);

        state = state.update({ changes: { from: 0, to: 1 } }).state;
        expect(undoDepth(state)).toBe(depthAfterVersionCreation + 1);

        undo({
            state,
            dispatch: (transaction) => {
                state = transaction.state;
            },
        });
        expect(state.doc.toString()).toBe("a");
        expect(getRevision(state, 0).selection.main.from).toBe(1);
        expect(getRevision(state, 0).selection.main.to).toBe(1);
        expect(getRevision(state, 0).versions).toHaveLength(3);

        undo({
            state,
            dispatch: (transaction) => {
                state = transaction.state;
            },
        });
        expect(state.doc.toString()).toBe("aa");
        expect(getRevision(state, 0).selection.main.from).toBe(1);
        expect(getRevision(state, 0).selection.main.to).toBe(2);
        expect(getRevision(state, 0).versions).toHaveLength(2);
    });

    it("restores legacy joined version creation from its exact revision snapshot", () => {
        let state = makeState("aa");
        state = addRevision(state, 1, 2, ["a", ""]);

        // Persisted histories created before revision operations were isolated
        // may contain this exact joined event. Rebuild the old transaction shape
        // without isolateHistory so its inverse remains backward-compatible.
        const versionCreation = createNewRevision(state, 0);
        state = state.update({
            changes: versionCreation.changes,
            effects: versionCreation.effects,
            selection: EditorSelection.cursor(1),
            annotations: [
                revisionInternalEdit.of(true),
                Transaction.addToHistory.of(true),
                // Suppress the prospective extender's `after` boundary while
                // retaining the legacy ability to join with the next edit.
                isolateHistory.of("before"),
            ],
        }).state;
        const joinedDepth = undoDepth(state);

        state = state.update({ changes: { from: 0, to: 1 } }).state;
        expect(undoDepth(state)).toBe(joinedDepth);

        undo({
            state,
            dispatch: (transaction) => {
                state = transaction.state;
            },
        });
        const restored = getRevision(state, 0);
        expect(state.doc.toString()).toBe("aa");
        expect(restored.selection.main.from).toBe(1);
        expect(restored.selection.main.to).toBe(2);
        expect(restored.versions).toHaveLength(2);
        expect(restored.versions[0].doc).toBe("a");
        expect(restored.versions[1].doc).toBe("");
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
        expect(activeVersionIndex(rev)).toBe(1); // was 2, shifted down
        expect(rev.versions[0].doc).toBe("BB");
        expect(rev.versions[1].doc).toBe("CC");
    });
});

// ── updateRevisionVersionState ───────────────────────────────────────────────

describe("updateRevisionVersionState", () => {
    it("updates a non-active version without changing document", () => {
        let state = makeState("active");
        state = addRevision(state, 0, 6, ["active", "old"]);

        const newBlob: TestBlob = { doc: "updated", label: "test" };
        state = state.update(updateRevisionVersionState(state, 0, 1, newBlob)).state;

        const rev = getRevision(state, 0);
        expect(rev.versions[1].doc).toBe("updated");
        expect(rev.versions[1].label).toBe("test");
        expect(state.doc.toString()).toBe("active"); // doc unchanged
    });

    it("updates the active version and changes document to match", () => {
        let state = makeState("old text");
        state = addRevision(state, 0, 8, ["old text"]);

        const newBlob: TestBlob = { doc: "new text" };
        state = state.update(updateRevisionVersionState(state, 0, 0, newBlob)).state;

        const rev = getRevision(state, 0);
        expect(rev.versions[0].doc).toBe("new text");
        expect(state.doc.toString()).toBe("new text");
        expect(rev.selection.main.from).toBe(0);
        expect(rev.selection.main.to).toBe(8);
    });

    it("keeps an active version range valid when growing from empty", () => {
        let state = makeState("");
        state = addRevision(state, 0, 0, [""]);

        state = state.update(updateRevisionVersionState(state, 0, 0, { doc: "hi" })).state;

        const rev = getRevision(state, 0);
        expect(state.doc.toString()).toBe("hi");
        expect(rev.selection.main.from).toBe(0);
        expect(rev.selection.main.to).toBe(2);
        expect(state.sliceDoc(rev.selection.main.from, rev.selection.main.to)).toBe("hi");
    });

    it("skips redundant doc change when text already matches", () => {
        let state = makeState("same");
        state = addRevision(state, 0, 4, ["same"]);

        // Update active version with same doc text but new metadata
        const newBlob: TestBlob = { doc: "same", label: "meta" };
        const tr = updateRevisionVersionState(state, 0, 0, newBlob);
        state = state.update(tr).state;

        const rev = getRevision(state, 0);
        expect(rev.versions[0].label).toBe("meta");
        expect(state.doc.toString()).toBe("same");
    });

    it("Phase 3 does not overwrite a version set by _updateRevisionVersionState", () => {
        let state = makeState("initial");
        state = addRevision(state, 0, 7, ["initial"]);

        // updateRevisionVersionState changes both the blob AND the doc
        const newBlob: TestBlob = { doc: "changed", label: "meta" };
        state = state.update(updateRevisionVersionState(state, 0, 0, newBlob)).state;

        const rev = getRevision(state, 0);
        // The blob should match exactly what we set — Phase 3 should have skipped
        expect(rev.versions[0].doc).toBe("changed");
        expect(rev.versions[0].label).toBe("meta");
    });
});

// ── _updateRevisionVersionLabel ──────────────────────────────────────────────

describe("updateRevisionVersionLabel", () => {
    it("sets a label on a version", () => {
        let state = makeState("text");
        state = addRevision(state, 0, 4, ["text"]);

        state = state.update({
            effects: [
                _updateRevisionVersionLabel.of({
                    annotationId: 0,
                    versionId: versionIdAt(state, 0, 0),
                    label: "Draft",
                }),
            ],
        }).state;

        const rev = getRevision(state, 0);
        expect(rev.versions[0].label).toBe("Draft");
    });

    it("clears a label by setting undefined", () => {
        let state = addRevision(makeState("text"), 0, 4, [{ doc: "text", label: "Draft" }]);
        state = state.update({
            effects: [
                _updateRevisionVersionLabel.of({
                    annotationId: 0,
                    versionId: versionIdAt(state, 0, 0),
                    label: "Draft",
                }),
            ],
        }).state;
        state = state.update({
            effects: [
                _updateRevisionVersionLabel.of({
                    annotationId: 0,
                    versionId: versionIdAt(state, 0, 0),
                    label: undefined,
                }),
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
    it("restores a lossy range without reverting later non-history metadata", () => {
        let state = makeState("abcdef");
        const annotation = {
            id: 0,
            _type: "comment",
            status: "active" as const,
            selection: EditorSelection.single(1, 5),
            thread: [{ message: "old", author: "User", time: 1 }],
        } satisfies GenericAnnotation;
        state = state.update({
            effects: addAnnotation.of(annotation),
            annotations: Transaction.addToHistory.of(false),
        }).state;
        state = state.update({ changes: { from: 0, to: 3 } }).state;
        state = state.update({
            effects: updateThread.of({
                annotationId: 0,
                newThread: [{ message: "new", author: "User", time: 2 }],
            }),
            annotations: Transaction.addToHistory.of(false),
        }).state;

        undo({
            state,
            dispatch: (transaction) => {
                state = transaction.state;
            },
        });
        expect(state.doc.toString()).toBe("abcdef");
        expect(getAnnotations(state)[0].selection.main.from).toBe(1);
        expect(getAnnotations(state)[0].selection.main.to).toBe(5);
        expect(getAnnotations(state)[0].thread[0].message).toBe("new");

        redo({
            state,
            dispatch: (transaction) => {
                state = transaction.state;
            },
        });
        expect(state.doc.toString()).toBe("def");
        expect(getAnnotations(state)[0].selection.main.from).toBe(0);
        expect(getAnnotations(state)[0].selection.main.to).toBe(2);
        expect(getAnnotations(state)[0].thread[0].message).toBe("new");
    });

    it("does not leave a latent redo deletion when a conditional restore is skipped", () => {
        let state = makeState("abcdef");
        const annotation = {
            id: 0,
            _type: "comment",
            status: "active" as const,
            selection: EditorSelection.single(1, 5),
            thread: [{ message: "old", author: "User", time: 1 }],
        } satisfies GenericAnnotation;
        state = state.update({
            effects: addAnnotation.of(annotation),
            annotations: Transaction.addToHistory.of(false),
        }).state;
        state = state.update({ changes: { from: 0, to: 3 } }).state;
        state = state.update({
            effects: removeAnnotation.of(state.field(annotationField)[0]),
            annotations: Transaction.addToHistory.of(false),
        }).state;

        undo({
            state,
            dispatch: (transaction) => {
                state = transaction.state;
            },
        });
        expect(getAnnotations(state)[0]).toBeUndefined();

        const fresh = {
            id: 0,
            _type: "comment",
            status: "active" as const,
            selection: EditorSelection.single(4, 6),
            thread: [{ message: "fresh", author: "User", time: 2 }],
        } satisfies GenericAnnotation;
        state = state.update({
            effects: addAnnotation.of(fresh),
            annotations: Transaction.addToHistory.of(false),
        }).state;
        redo({
            state,
            dispatch: (transaction) => {
                state = transaction.state;
            },
        });

        expect(state.doc.toString()).toBe("def");
        expect(getAnnotations(state)[0].thread[0].message).toBe("fresh");
        expect(getAnnotations(state)[0].selection.main.from).toBe(1);
        expect(getAnnotations(state)[0].selection.main.to).toBe(3);
    });

    it("does not overwrite a fresh annotation that reused a restored annotation ID", () => {
        let state = makeState("abcdef");
        const annotation = {
            id: 0,
            _type: "comment",
            status: "active" as const,
            selection: EditorSelection.single(1, 5),
            thread: [{ message: "old", author: "User", time: 1 }],
        } satisfies GenericAnnotation;
        state = state.update({
            effects: addAnnotation.of(annotation),
            annotations: Transaction.addToHistory.of(false),
        }).state;
        state = state.update({ changes: { from: 0, to: 3 } }).state;
        state = state.update({
            effects: removeAnnotation.of(state.field(annotationField)[0]),
            annotations: Transaction.addToHistory.of(false),
        }).state;
        state = state.update({
            effects: addAnnotation.of({
                id: 0,
                _type: "comment",
                status: "active" as const,
                // Exactly matches the removed annotation's post-delete range.
                // Numeric ID, type, and coordinates alone cannot distinguish it.
                selection: EditorSelection.single(0, 2),
                thread: [{ message: "fresh", author: "User", time: 2 }],
            }),
            annotations: Transaction.addToHistory.of(false),
        }).state;

        undo({
            state,
            dispatch: (transaction) => {
                state = transaction.state;
            },
        });

        expect(state.doc.toString()).toBe("abcdef");
        expect(getAnnotations(state)[0].thread[0].message).toBe("fresh");
        expect(getAnnotations(state)[0]._historyId).toBeTruthy();
        expect(getAnnotations(state)[0].selection.main.from).toBe(3);
        expect(getAnnotations(state)[0].selection.main.to).toBe(5);
    });

    it.each([
        {
            label: "comment",
            annotation: {
                id: 0,
                _type: "comment",
                status: "active" as const,
                selection: EditorSelection.single(0, 2),
                thread: [{ message: "note", author: "User", time: 1 }],
            } satisfies GenericAnnotation,
        },
        {
            label: "suggestion",
            annotation: {
                id: 0,
                _type: "suggestion",
                status: "active" as const,
                selection: EditorSelection.single(0, 2),
                thread: [{ message: "replace", author: "User", time: 1 }],
                replacements: [{ text: "YZ" }],
            } satisfies GenericAnnotation,
        },
    ])("preserves a $label range through non-history text on undo and redo", ({ annotation }) => {
        let state = makeState("abcd");
        state = state.update({ effects: [addAnnotation.of(annotation)] }).state;
        state = state.update({ changes: { from: 0, to: 2, insert: "YZ" } }).state;
        state = state.update({
            changes: { from: 1, insert: "Q" },
            annotations: Transaction.addToHistory.of(false),
        }).state;

        expect(state.doc.toString()).toBe("YQZcd");
        expect(getAnnotations(state)[0].selection.main.from).toBe(0);
        expect(getAnnotations(state)[0].selection.main.to).toBe(3);

        undo({
            state,
            dispatch: (transaction) => {
                state = transaction.state;
            },
        });
        expect(state.doc.toString()).toBe("abQcd");
        expect(getAnnotations(state)[0].selection.main.from).toBe(0);
        expect(getAnnotations(state)[0].selection.main.to).toBe(3);

        redo({
            state,
            dispatch: (transaction) => {
                state = transaction.state;
            },
        });
        expect(state.doc.toString()).toBe("YQZcd");
        expect(getAnnotations(state)[0].selection.main.from).toBe(0);
        expect(getAnnotations(state)[0].selection.main.to).toBe(3);
    });

    it.each([
        {
            label: "comment",
            annotation: {
                id: 0,
                _type: "comment",
                status: "active" as const,
                selection: EditorSelection.single(2, 3),
                thread: [{ message: "note", author: "User", time: 1 }],
            } satisfies GenericAnnotation,
        },
        {
            label: "suggestion",
            annotation: {
                id: 0,
                _type: "suggestion",
                status: "active" as const,
                selection: EditorSelection.single(2, 3),
                thread: [{ message: "replace", author: "User", time: 1 }],
                replacements: [{ text: "x" }],
            } satisfies GenericAnnotation,
        },
    ])(
        "does not resurrect a $label removed by a later non-history replacement",
        ({ annotation }) => {
            let state = makeState("aaaa");
            state = state.update({
                effects: [addAnnotation.of(annotation)],
                annotations: Transaction.addToHistory.of(false),
            }).state;
            state = state.update({ changes: { from: 0, to: 1 } }).state;
            state = state.update({
                changes: { from: 0, to: 3, insert: "a" },
                annotations: Transaction.addToHistory.of(false),
            }).state;

            expect(state.doc.toString()).toBe("a");
            expect(getAnnotations(state)[0]).toBeUndefined();

            undo({
                state,
                dispatch: (transaction) => {
                    state = transaction.state;
                },
            });
            expect(getAnnotations(state)[0]).toBeUndefined();

            redo({
                state,
                dispatch: (transaction) => {
                    state = transaction.state;
                },
            });
            expect(state.doc.toString()).toBe("a");
            expect(getAnnotations(state)[0]).toBeUndefined();
        },
    );

    it("isolates suggestion application from following typing before non-history edits", () => {
        let state = makeState("a");
        state = state.update({
            effects: [
                addAnnotation.of({
                    id: 0,
                    _type: "suggestion",
                    status: "active" as const,
                    selection: EditorSelection.single(0, 1),
                    thread: [{ message: "remove", author: "User", time: 1 }],
                    replacements: [{ text: "" }],
                }),
            ],
        }).state;
        state = state.update(applySuggestion(state, 0, 0)).state;
        const depthAfterSuggestion = undoDepth(state);

        state = state.update({ changes: { from: 0, insert: "a" } }).state;
        expect(undoDepth(state)).toBe(depthAfterSuggestion + 1);
        state = state.update({
            changes: { from: 0, insert: "a" },
            annotations: Transaction.addToHistory.of(false),
        }).state;

        undo({
            state,
            dispatch: (transaction) => {
                state = transaction.state;
            },
        });
        expect(state.doc.toString()).toBe("a");
        expect(getAnnotations(state)[0]).toBeUndefined();

        undo({
            state,
            dispatch: (transaction) => {
                state = transaction.state;
            },
        });
        const restored = getAnnotations(state)[0];
        expect(state.doc.toString()).toBe("aa");
        expect(isAnnotationOfType(restored, "suggestion")).toBe(true);
        expect(restored.selection.main.from).toBe(1);
        expect(restored.selection.main.to).toBe(2);
    });

    it("undoes nested metadata without reverting later non-history text bookkeeping", () => {
        const oldNestedComment = {
            id: 7,
            _type: "comment",
            status: "active" as const,
            selection: {
                ranges: [{ anchor: 0, head: 2 }],
                main: 0,
            },
            thread: [{ message: "old", author: "User", time: 1 }],
        };
        const newNestedComment = {
            ...oldNestedComment,
            thread: [{ message: "new", author: "User", time: 2 }],
        };
        let state = makeState("abcd");
        state = addRevision(state, 0, 4, [
            { doc: "abcd", annotationField: { 7: oldNestedComment } },
        ]);

        state = state.update(
            updateRevisionVersionState(state, 0, 0, {
                doc: "abcd",
                annotationField: { 7: newNestedComment },
            }),
        ).state;
        state = state.update({
            changes: { from: 1, insert: "Q" },
            annotations: Transaction.addToHistory.of(false),
        }).state;
        state = state.update(
            updateRevisionVersionState(
                state,
                0,
                0,
                {
                    doc: "aQbcd",
                    annotationField: {
                        7: {
                            ...newNestedComment,
                            selection: {
                                ranges: [{ anchor: 0, head: 3 }],
                                main: 0,
                            },
                        },
                    },
                },
                { addToHistory: false },
            ),
        ).state;

        undo({
            state,
            dispatch: (transaction) => {
                state = transaction.state;
            },
        });

        const revisionAfterUndo = getRevision(state, 0);
        const versionAfterUndo = revisionAfterUndo.versions[0] as Record<string, unknown>;
        const annotationsAfterUndo = versionAfterUndo.annotationField as Record<
            string,
            typeof oldNestedComment
        >;
        expect(state.doc.toString()).toBe("aQbcd");
        expect(revisionAfterUndo.selection.main.to).toBe(5);
        expect(versionAfterUndo.doc).toBe("aQbcd");
        expect(annotationsAfterUndo[7].selection.ranges[0]).toEqual({ anchor: 0, head: 3 });
        expect(annotationsAfterUndo[7].thread[0].message).toBe("old");

        redo({
            state,
            dispatch: (transaction) => {
                state = transaction.state;
            },
        });
        const versionAfterRedo = getRevision(state, 0).versions[0] as Record<string, unknown>;
        const annotationsAfterRedo = versionAfterRedo.annotationField as Record<
            string,
            typeof oldNestedComment
        >;
        expect(versionAfterRedo.doc).toBe("aQbcd");
        expect(annotationsAfterRedo[7].selection.ranges[0]).toEqual({ anchor: 0, head: 3 });
        expect(annotationsAfterRedo[7].thread[0].message).toBe("new");
    });

    it("preserves a later non-history insert through an active version update undo and redo", () => {
        let state = makeState("abcd");
        state = addRevision(state, 0, 4, ["abcd"]);
        state = state.update(updateRevisionVersionState(state, 0, 0, { doc: "WXYZ" })).state;
        state = state.update({
            changes: { from: 2, insert: "Q" },
            annotations: Transaction.addToHistory.of(false),
        }).state;

        expect(state.doc.toString()).toBe("WXQYZ");
        expect(getRevision(state, 0).versions[0].doc).toBe("WXQYZ");

        undo({
            state,
            dispatch: (transaction) => {
                state = transaction.state;
            },
        });
        // CodeMirror rebases an insertion inside a fully-replaced span to the
        // trailing boundary. The important invariant is that the external Q is
        // preserved and remains part of the active revision.
        expect(state.doc.toString()).toBe("abcdQ");
        expect(getRevision(state, 0).selection.main.to).toBe(5);
        expect(getRevision(state, 0).versions[0].doc).toBe("abcdQ");

        redo({
            state,
            dispatch: (transaction) => {
                state = transaction.state;
            },
        });
        expect(state.doc.toString()).toBe("WXQYZ");
        expect(getRevision(state, 0).selection.main.to).toBe(5);
        expect(getRevision(state, 0).versions[0].doc).toBe("WXQYZ");
    });

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
        expect(activeVersionIndex(rev)).toBe(0);
        expect(state.doc.toString()).toBe("hello");
    });

    it("undo and redo restore the exact version-creation range", () => {
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
        expect(rev.selection.main.from).toBe(0);
        expect(rev.selection.main.to).toBe(5);
        expect(state.sliceDoc(rev.selection.main.from, rev.selection.main.to)).toBe("hello");

        redo({
            state,
            dispatch: (tr) => {
                state = tr.state;
            },
        });
        expect(state.doc.toString()).toBe("");
        expect(getRevision(state, 0).selection.main.empty).toBe(true);

        undo({
            state,
            dispatch: (tr) => {
                state = tr.state;
            },
        });
        expect(getRevision(state, 0).selection.main.from).toBe(0);
        expect(getRevision(state, 0).selection.main.to).toBe(5);
    });

    it("repeatedly traverses an active version-state update to empty", () => {
        let state = makeState("hello");
        state = addRevision(state, 0, 5, ["hello"]);
        state = state.update(updateRevisionVersionState(state, 0, 0, { doc: "" })).state;

        for (let cycle = 0; cycle < 3; cycle++) {
            undo({
                state,
                dispatch: (tr) => {
                    state = tr.state;
                },
            });
            expect(state.doc.toString()).toBe("hello");
            expect(getRevision(state, 0).selection.main.from).toBe(0);
            expect(getRevision(state, 0).selection.main.to).toBe(5);

            redo({
                state,
                dispatch: (tr) => {
                    state = tr.state;
                },
            });
            expect(state.doc.toString()).toBe("");
            expect(getRevision(state, 0).selection.main.from).toBe(0);
            expect(getRevision(state, 0).selection.main.to).toBe(0);
        }
    });

    it("keeps an intentional collapsed revision anchored across a neighboring edit", () => {
        let state = makeState("a");
        state = addRevision(state, 0, 0, [""]);
        state = state.update({ changes: { from: 0, to: 1 } }).state;

        for (let cycle = 0; cycle < 3; cycle++) {
            undo({
                state,
                dispatch: (tr) => {
                    state = tr.state;
                },
            });
            expect(state.doc.toString()).toBe("a");
            expect(getRevision(state, 0).selection.main.from).toBe(0);
            expect(getRevision(state, 0).selection.main.to).toBe(0);

            redo({
                state,
                dispatch: (tr) => {
                    state = tr.state;
                },
            });
            expect(state.doc.toString()).toBe("");
            expect(getRevision(state, 0).selection.main.from).toBe(0);
        }
    });

    it("preserves a collapsed predecessor when undoing a nested delete to empty", () => {
        let state = makeState("A");
        state = addRevision(state, 0, 0, [""]);
        state = addRevision(state, 0, 1, ["A"]);

        state = state.update({
            changes: { from: 0, to: 1 },
            effects: [_nestedEditRevision.of(1)],
            annotations: [nestedEditorEdit.of(1)],
        }).state;
        expect(getRevision(state, 0).selection.main.from).toBe(0);
        expect(getRevision(state, 1).selection.main.empty).toBe(true);

        undo({
            state,
            dispatch: (tr) => {
                state = tr.state;
            },
        });

        expect(state.doc.toString()).toBe("A");
        expect(getRevision(state, 0).selection.main.from).toBe(0);
        expect(getRevision(state, 0).selection.main.to).toBe(0);
        expect(getRevision(state, 1).selection.main.from).toBe(0);
        expect(getRevision(state, 1).selection.main.to).toBe(1);
    });

    it("rebases an exact restore through a non-history document edit", () => {
        let state = makeState("abcdef");
        state = state.update({
            effects: [
                addAnnotation.of({
                    id: 0,
                    _type: "comment",
                    status: "pending" as const,
                    selection: EditorSelection.create([EditorSelection.range(5, 1)]),
                    thread: [{ message: "note", author: "User", time: 1 }],
                }),
            ],
        }).state;
        state = state.update({ changes: { from: 0, to: 3 } }).state;
        state = state.update({
            changes: { from: 0, insert: "!" },
            annotations: Transaction.addToHistory.of(false),
        }).state;

        undo({
            state,
            dispatch: (tr) => {
                state = tr.state;
            },
        });

        const restored = getAnnotations(state)[0];
        expect(state.doc.toString()).toBe("!abcdef");
        expect(restored.selection.main.anchor).toBe(6);
        expect(restored.selection.main.head).toBe(2);
    });

    it("rebases a restored suggestion through a non-history prefix edit", () => {
        let state = makeState("a");
        state = state.update({
            effects: [
                addAnnotation.of({
                    id: 0,
                    _type: "suggestion",
                    status: "active" as const,
                    selection: EditorSelection.single(0, 1),
                    thread: [{ message: "replace", author: "User", time: 1 }],
                    replacements: [{ text: "" }],
                }),
            ],
        }).state;
        state = state.update(applySuggestion(state, 0, 0)).state;
        state = state.update({
            changes: { from: 0, insert: "a" },
            annotations: Transaction.addToHistory.of(false),
        }).state;

        undo({
            state,
            dispatch: (tr) => {
                state = tr.state;
            },
        });

        const restored = getAnnotations(state)[0];
        expect(state.doc.toString()).toBe("aa");
        expect(isAnnotationOfType(restored, "suggestion")).toBe(true);
        if (!restored || !isAnnotationOfType(restored, "suggestion")) return;
        expect(restored.selection.main.from).toBe(1);
        expect(restored.selection.main.to).toBe(2);
    });

    it("does not move a collapsed neighbor while undoing adjacent version creation", () => {
        let state = makeState("Aa");
        state = addRevision(state, 0, 1, ["A"]);
        state = addRevision(state, 1, 2, ["a"]);

        state = state.update(createNewRevision(state, 0)).state;
        state = state.update(createNewRevision(state, 1)).state;

        // CodeMirror may group the two rapid version creations. Traverse until
        // both are restored, whether that takes one history item or two.
        for (let step = 0; step < 2 && state.doc.toString() !== "Aa"; step++) {
            undo({
                state,
                dispatch: (tr) => {
                    state = tr.state;
                },
            });
        }

        expect(state.doc.toString()).toBe("Aa");
        expect(getRevision(state, 0).selection.main.from).toBe(0);
        expect(getRevision(state, 0).selection.main.to).toBe(1);
        expect(getRevision(state, 1).selection.main.from).toBe(1);
        expect(getRevision(state, 1).selection.main.to).toBe(2);
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

describe("thread undo/redo", () => {
    it("undoes the first revision message without deleting the revision", () => {
        let state = makeState("hello");
        state = addRevision(state, 0, 5, ["hello"]);
        state = state.update({
            effects: [
                updateThread.of({
                    annotationId: 0,
                    newThread: [{ message: "Review", author: "User", time: 1 }],
                }),
            ],
        }).state;
        expect(getAnnotations(state)[0]?.status).toBe("active");

        undo({
            state,
            dispatch: (tr) => {
                state = tr.state;
            },
        });
        expect(getRevision(state, 0).thread).toEqual([]);

        redo({
            state,
            dispatch: (tr) => {
                state = tr.state;
            },
        });
        expect(getRevision(state, 0).thread).toEqual([
            { message: "Review", author: "User", time: 1 },
        ]);
    });

    it("redo restores the first pending-comment message", () => {
        let state = makeState("hello");
        state = state.update({
            effects: [
                addAnnotation.of({
                    id: 0,
                    _type: "comment",
                    status: "pending" as const,
                    selection: EditorSelection.single(0, 5),
                    thread: [],
                }),
            ],
        }).state;
        state = state.update({
            effects: [
                updateThread.of({
                    annotationId: 0,
                    newThread: [{ message: "Note", author: "User", time: 1 }],
                }),
            ],
        }).state;
        expect(getAnnotations(state)[0]?.status).toBe("active");

        undo({
            state,
            dispatch: (tr) => {
                state = tr.state;
            },
        });
        expect(getAnnotations(state)[0]).toBeUndefined();

        redo({
            state,
            dispatch: (tr) => {
                state = tr.state;
            },
        });
        expect(getAnnotations(state)[0]?.thread).toEqual([
            { message: "Note", author: "User", time: 1 },
        ]);
    });

    it("undo restores an active empty-thread comment instead of deleting it", () => {
        let state = makeState("hello");
        state = state.update({
            effects: [
                addAnnotation.of({
                    id: 0,
                    _type: "comment",
                    status: "active",
                    selection: EditorSelection.single(0, 5),
                    thread: [],
                }),
            ],
        }).state;
        state = state.update({
            effects: [
                updateThread.of({
                    annotationId: 0,
                    newThread: [{ message: "Note", author: "User", time: 1 }],
                }),
            ],
        }).state;

        undo({
            state,
            dispatch: (tr) => {
                state = tr.state;
            },
        });
        expect(getAnnotations(state)[0]?.status).toBe("active");
        expect(getAnnotations(state)[0]?.thread).toEqual([]);
    });
});

describe("annotation status transitions", () => {
    it("activates a pending revision when its first version is added", () => {
        let state = makeState("");
        state = state.update({
            effects: [
                addAnnotation.of({
                    id: 0,
                    _type: "revision",
                    status: "pending",
                    selection: EditorSelection.single(0),
                    thread: [],
                    activeVersionId: "",
                    versions: [],
                }),
            ],
        }).state;

        state = createNewRevision(state, 0).state;
        expect(getRevision(state, 0).status).toBe("active");
        expect(getRevision(state, 0).versions).toHaveLength(1);
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
        const blob: TestBlob = {
            doc: "updated-other",
            label: "v2",
        };
        state = state.update(updateRevisionVersionState(state, 0, 1, blob)).state;

        // Verify active version and document are unchanged
        expect(state.doc.toString()).toBe("active");
        expect(getRevision(state, 0).versions[0].doc).toBe("active");
        expect(getRevision(state, 0).versions[1].doc).toBe("updated-other");
        expect(getRevision(state, 0).versions[1].label).toBe("v2");
    });
});

// ── Serialization round-trip ─────────────────────────────────────────────────
// Note: full EditorState.fromJSON round-trips can't be tested in isolation due
// to CodeMirror's instance check requirements. Instead, we test that the
// Zod schema (used by fromJSON) correctly parses/preserves our data.

describe("toJSON/fromJSON round-trip", () => {
    it("rejects a known persisted-history annotation without a lineage identity", () => {
        expect(() =>
            deserializeAnnotationHistoryEffect({
                type: "annotation.add",
                value: {
                    id: 0,
                    _type: "comment",
                    status: "active" as const,
                    selection: { ranges: [{ anchor: 0, head: 1 }], main: 0 },
                    thread: [],
                },
            }),
        ).toThrow("Invalid annotation identity in persisted history");
    });

    it.each([
        {
            label: "missing version id",
            versions: [{ doc: "a" }],
            activeVersionId: "v1",
        },
        {
            label: "empty version id",
            versions: [{ id: "", doc: "a" }],
            activeVersionId: "",
        },
        {
            label: "duplicate version ids",
            versions: [
                { id: "v1", doc: "a" },
                { id: "v1", doc: "b" },
            ],
            activeVersionId: "v1",
        },
        {
            label: "unresolved active version id",
            versions: [{ id: "v1", doc: "a" }],
            activeVersionId: "missing",
        },
    ])("rejects $label in a known persisted-history effect", ({ versions, activeVersionId }) => {
        expect(() =>
            deserializeAnnotationHistoryEffect({
                type: "annotation.add",
                value: {
                    id: 0,
                    _type: "revision",
                    status: "active" as const,
                    _historyId: "history-test",
                    selection: { ranges: [{ anchor: 0, head: 1 }], main: 0 },
                    thread: [],
                    versions,
                    activeVersionId,
                },
            }),
        ).toThrow("Invalid revision identity in persisted history");
    });

    it.each([
        {
            type: "revision.addVersion",
            value: { annotationId: 0, newVersion: { id: "", doc: "a" } },
        },
        {
            type: "revision.deleteVersion",
            value: { annotationId: 0, versionId: "" },
        },
        {
            type: "revision.activeVersion",
            value: { annotationId: 0, to: "" },
        },
        {
            type: "revision.versionState",
            value: { annotationId: 0, versionId: "v1", versionState: { id: "", doc: "a" } },
        },
    ])("rejects empty version identity in $type history", (serialized) => {
        expect(() => deserializeAnnotationHistoryEffect(serialized)).toThrow(
            `Invalid ${serialized.type} effect in persisted history`,
        );
    });

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

        const blob: TestBlob = { doc: "text", label: "Final" };
        state = state.update(updateRevisionVersionState(state, 0, 0, blob)).state;

        const rev = getRevision(state, 0);
        expect(rev.versions[0].label).toBe("Final");

        // JSON round-trip preserves metadata
        const raw = JSON.parse(JSON.stringify(rev.versions[0]));
        expect(raw.label).toBe("Final");
    });
});

// ── Nested editor edits (boundary expansion) ─────────────────────────────────

describe("nested editor boundary expansion", () => {
    it("isolates a nested collapse from a following adjacent parent delete", () => {
        let state = makeState("aa");
        state = addRevision(state, 1, 2, ["a", ""]);

        state = state.update({
            changes: { from: 1, to: 2 },
            effects: [_nestedEditRevision.of(0)],
            annotations: [nestedEditorEdit.of(0), Transaction.addToHistory.of(true)],
        }).state;
        const depthAfterNestedDelete = undoDepth(state);
        state = state.update({ changes: { from: 0, to: 1 } }).state;

        expect(state.doc.toString()).toBe("");
        expect(getRevision(state, 0).selection.main.empty).toBe(true);
        expect(undoDepth(state)).toBe(depthAfterNestedDelete + 1);

        undo({
            state,
            dispatch: (transaction) => {
                state = transaction.state;
            },
        });
        expect(state.doc.toString()).toBe("a");
        expect(getRevision(state, 0).selection.main.empty).toBe(true);

        undo({
            state,
            dispatch: (transaction) => {
                state = transaction.state;
            },
        });

        expect(state.doc.toString()).toBe("aa");
        expect(getRevision(state, 0).selection.main.from).toBe(1);
        expect(getRevision(state, 0).selection.main.to).toBe(2);
        expect(getRevision(state, 0).versions[0].doc).toBe("a");
    });

    it("isolates a nested collapse from a preceding adjacent parent delete", () => {
        let state = makeState("aa");
        state = addRevision(
            state,
            0,
            1,
            [
                { doc: "a", label: "Original" },
                { doc: "", label: "Alternative" },
            ],
            0,
        );

        // Delete the unannotated second character, then delete the revision's
        // only character through its nested editor. The collapse must form a
        // separate history event so neither range loses its anchor.
        state = state.update({
            changes: { from: 1, to: 2 },
            annotations: [Transaction.time.of(1_000), Transaction.userEvent.of("delete")],
        }).state;
        const depthAfterParentDelete = undoDepth(state);
        state = state.update({
            changes: { from: 0, to: 1 },
            effects: [_nestedEditRevision.of(0)],
            annotations: [
                nestedEditorEdit.of(0),
                Transaction.addToHistory.of(true),
                Transaction.time.of(1_100),
            ],
        }).state;

        expect(state.doc.toString()).toBe("");
        expect(getRevision(state, 0).selection.main.empty).toBe(true);
        expect(getRevision(state, 0).versions[0].doc).toBe("");
        expect(undoDepth(state)).toBe(depthAfterParentDelete + 1);

        undo({
            state,
            dispatch: (transaction) => {
                state = transaction.state;
            },
        });

        expect(state.doc.toString()).toBe("a");
        expect(getRevision(state, 0).selection.main.from).toBe(0);
        expect(getRevision(state, 0).selection.main.to).toBe(1);

        undo({
            state,
            dispatch: (transaction) => {
                state = transaction.state;
            },
        });

        expect(state.doc.toString()).toBe("aa");
        expect(getRevision(state, 0).selection.main.from).toBe(0);
        expect(getRevision(state, 0).selection.main.to).toBe(1);
        expect(getRevision(state, 0).versions[0].doc).toBe("a");
        expect(getRevision(state, 0).versions[1].doc).toBe("");
    });

    it("keeps an empty previous sibling outside a prepended revision", () => {
        let state = makeState("AZ");
        state = addRevision(state, 0, 1, ["A"]);
        state = addRevision(state, 1, 2, ["Z"]);

        // Empty the first revision, prepend to the second, then refill the first.
        state = state.update({
            changes: { from: 0, to: 1 },
            effects: [_nestedEditRevision.of(0)],
            annotations: [nestedEditorEdit.of(0), Transaction.addToHistory.of(true)],
        }).state;
        state = state.update({
            changes: { from: 0, insert: "Y" },
            effects: [_nestedEditRevision.of(1)],
            annotations: [nestedEditorEdit.of(1), Transaction.addToHistory.of(true)],
        }).state;

        expect(getRevision(state, 0).selection.main.from).toBe(0);
        expect(getRevision(state, 0).selection.main.to).toBe(0);
        expect(getRevision(state, 1).selection.main.from).toBe(0);
        expect(getRevision(state, 1).selection.main.to).toBe(2);

        state = state.update({
            changes: { from: 0, insert: "X" },
            effects: [_nestedEditRevision.of(0)],
            annotations: [nestedEditorEdit.of(0), Transaction.addToHistory.of(true)],
        }).state;
        expect(state.doc.toString()).toBe("XYZ");
        expect(getRevision(state, 0).selection.main.from).toBe(0);
        expect(getRevision(state, 0).selection.main.to).toBe(1);
        expect(getRevision(state, 1).selection.main.from).toBe(1);
        expect(getRevision(state, 1).selection.main.to).toBe(3);

        state = state.update(createNewRevision(state, 1)).state;
        expect(state.doc.toString()).toBe("X");
        expect(getRevision(state, 0).versions[0].doc).toBe("X");
        expect(getRevision(state, 0).selection.main.from).toBe(0);
        expect(getRevision(state, 0).selection.main.to).toBe(1);
    });

    it("keeps an empty following sibling outside an appended revision", () => {
        let state = makeState("ZA");
        state = addRevision(state, 0, 1, ["Z"]);
        state = addRevision(state, 1, 2, ["A"]);

        state = state.update({
            changes: { from: 1, to: 2 },
            effects: [_nestedEditRevision.of(1)],
            annotations: [nestedEditorEdit.of(1), Transaction.addToHistory.of(true)],
        }).state;
        state = state.update({
            changes: { from: 1, insert: "Y" },
            effects: [_nestedEditRevision.of(0)],
            annotations: [nestedEditorEdit.of(0), Transaction.addToHistory.of(true)],
        }).state;

        expect(state.doc.toString()).toBe("ZY");
        expect(getRevision(state, 0).selection.main.from).toBe(0);
        expect(getRevision(state, 0).selection.main.to).toBe(2);
        expect(getRevision(state, 1).selection.main.from).toBe(2);
        expect(getRevision(state, 1).selection.main.to).toBe(2);
    });

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
        const blob: TestBlob = {
            doc: "new-inactive",
            label: "flush",
        };
        state = state.update(updateRevisionVersionState(state, 0, 1, blob)).state;

        // Active version and document should be completely unchanged
        expect(state.doc.toString()).toBe("active-text");
        const rev = getRevision(state, 0);
        expect(rev.versions[0].doc).toBe("active-text");
        expect(rev.versions[1].doc).toBe("new-inactive");
        expect(activeVersionIndex(rev)).toBe(0);
    });

    it("rapid version state updates don't lose data", () => {
        let state = makeState("v0");
        state = addRevision(state, 0, 2, ["v0", "v1", "v2"]);

        // Update all non-active versions in rapid succession
        const blob1: TestBlob = { doc: "v1-updated" };
        state = state.update(updateRevisionVersionState(state, 0, 1, blob1)).state;

        const blob2: TestBlob = { doc: "v2-updated" };
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

    it("flushToParent after version switch does not overwrite versions", () => {
        // Models the exact sequence that happens in the real app when:
        // 1. Modal is open for a revision (with nested editor running)
        // 2. Version is switched (from pill or keyboard)
        // 3. Modal's destroyEditor() calls flushToParent() with old content
        //
        // flushToParent uses updateRevisionVersionState with addToHistory: false
        // targeting the OLD version index. If the blob's doc is contaminated
        // (e.g. contains the NEW version's text), it overwrites the old version.
        let state = makeState("hello");
        state = addRevision(state, 0, 5, ["hello", "world"]);

        // Step 1: Switch from version 0 ("hello") to version 1 ("world")
        state = state.update(setActiveRevisionVersion(state, 0, 1)).state;
        expect(state.doc.toString()).toBe("world");
        expect(activeVersionIndex(getRevision(state, 0))).toBe(1);

        // Step 2: flushToParent fires with OLD version's content to OLD index
        // (this is the correct case — modal editor wasn't synced yet)
        const correctBlob: TestBlob = { doc: "hello" };
        state = state.update(
            updateRevisionVersionState(state, 0, 0, correctBlob, { addToHistory: false }),
        ).state;

        const rev = getRevision(state, 0);
        expect(rev.versions[0].doc).toBe("hello"); // old version preserved
        expect(rev.versions[1].doc).toBe("world"); // new version preserved
        expect(activeVersionIndex(rev)).toBe(1);
    });

    it("version switch does not drop comment annotations outside the revision", () => {
        // doc: "AAA hello BBB"
        //       0123456789012
        // Revision covers "hello" at [4, 9]
        // Comment covers "BBB" at [10, 13] — entirely outside the revision
        let state = makeState("AAA hello BBB");
        state = addRevision(state, 4, 9, ["hello", "world"]);
        state = state.update({
            effects: [
                addAnnotation.of({
                    id: 1,
                    _type: "comment",
                    status: "active" as const,
                    selection: EditorSelection.single(10, 13),
                    thread: [{ author: "user", message: "note", time: Date.now() }],
                }),
            ],
        }).state;

        // Both annotations should exist before the switch
        expect(Object.keys(getAnnotations(state))).toHaveLength(2);

        // Switch to version 1 ("world") — replaces "hello" with "world"
        state = state.update(setActiveRevisionVersion(state, 0, 1)).state;

        // Comment should still exist — it's outside the revision range
        const anns = getAnnotations(state);
        expect(Object.keys(anns)).toHaveLength(2);
        const comment = anns[1];
        expect(comment).toBeDefined();
        expect(isAnnotationOfType(comment, "comment")).toBe(true);
        // Comment positions should be remapped correctly
        // "AAA world BBB" — "BBB" is still at [10, 13]
        expect(comment.selection.main.from).toBe(10);
        expect(comment.selection.main.to).toBe(13);
    });

    it("version switch does not drop comment annotations before the revision", () => {
        // doc: "AAA hello BBB"
        // Comment covers "AAA" at [0, 3] — before the revision
        let state = makeState("AAA hello BBB");
        state = addRevision(state, 4, 9, ["hello", "world"]);
        state = state.update({
            effects: [
                addAnnotation.of({
                    id: 1,
                    _type: "comment",
                    status: "active" as const,
                    selection: EditorSelection.single(0, 3),
                    thread: [{ author: "user", message: "note", time: Date.now() }],
                }),
            ],
        }).state;

        state = state.update(setActiveRevisionVersion(state, 0, 1)).state;

        const anns = getAnnotations(state);
        expect(Object.keys(anns)).toHaveLength(2);
        expect(anns[1]).toBeDefined();
        expect(anns[1].selection.main.from).toBe(0);
        expect(anns[1].selection.main.to).toBe(3);
    });

    it("version switch to different-length text preserves comment after revision", () => {
        // doc: "XX YYY"
        //       012345
        // Revision covers "XX" at [0, 2], versions ["XX", "XXXXX"]
        // Comment covers "YYY" at [3, 6]
        let state = makeState("XX YYY");
        state = addRevision(state, 0, 2, ["XX", "XXXXX"]);
        state = state.update({
            effects: [
                addAnnotation.of({
                    id: 1,
                    _type: "comment",
                    status: "active" as const,
                    selection: EditorSelection.single(3, 6),
                    thread: [{ author: "user", message: "note", time: Date.now() }],
                }),
            ],
        }).state;

        // Switch to version 1 ("XXXXX") — doc becomes "XXXXX YYY"
        state = state.update(setActiveRevisionVersion(state, 0, 1)).state;

        const anns = getAnnotations(state);
        expect(Object.keys(anns)).toHaveLength(2);
        const comment = anns[1];
        expect(comment).toBeDefined();
        // "XXXXX YYY" — "YYY" shifted to [6, 9]
        expect(state.doc.toString()).toBe("XXXXX YYY");
        expect(comment.selection.main.from).toBe(6);
        expect(comment.selection.main.to).toBe(9);
    });

    it("version switch between different-length versions preserves second revision", () => {
        // doc: "AAA BBB"
        //       0123456
        // Revision 0 covers "AAA" at [0, 3], versions ["AAA", "A"]
        // Revision 1 covers "BBB" at [4, 7]
        let state = makeState("AAA BBB");
        state = addRevision(state, 0, 3, ["AAA", "A"]);
        const rev1Version = makeVersion({ doc: "BBB" });
        state = state.update({
            effects: [
                addAnnotation.of({
                    id: 1,
                    _type: "revision",
                    status: "active" as const,
                    selection: EditorSelection.single(4, 7),
                    thread: [],
                    activeVersionId: rev1Version.id,
                    versions: [rev1Version],
                }),
            ],
        }).state;

        // Switch revision 0 to version 1 ("A") — doc becomes "A BBB"
        state = state.update(setActiveRevisionVersion(state, 0, 1)).state;

        const anns = getAnnotations(state);
        expect(Object.keys(anns)).toHaveLength(2);
        expect(state.doc.toString()).toBe("A BBB");
        // Revision 1 should be remapped: "BBB" at [2, 5]
        const rev1 = anns[1];
        expect(rev1).toBeDefined();
        expect(rev1.selection.main.from).toBe(2);
        expect(rev1.selection.main.to).toBe(5);
    });

    it("version switch drops comment whose range is inside the revision", () => {
        // doc: "AAA hello BBB"
        //       0123456789012
        // Revision covers "hello" at [4, 9]
        // Comment covers "ell" at [5, 8] — inside the revision
        let state = makeState("AAA hello BBB");
        state = addRevision(state, 4, 9, ["hello", "world"]);
        state = state.update({
            effects: [
                addAnnotation.of({
                    id: 1,
                    _type: "comment",
                    status: "active" as const,
                    selection: EditorSelection.single(5, 8),
                    thread: [{ author: "user", message: "note", time: Date.now() }],
                }),
            ],
        }).state;

        expect(Object.keys(getAnnotations(state))).toHaveLength(2);

        // Switch to version 1 ("world") — the text "hello" is replaced with "world"
        // The comment at [5, 8] gets its range mapped through the replacement.
        // Since the entire range [4, 9] is replaced, positions 5 and 8 both map
        // to position 4 (start of replacement), creating an empty range.
        // cleanRangesOf drops empty non-revision ranges.
        state = state.update(setActiveRevisionVersion(state, 0, 1)).state;

        // The comment should be dropped (its range collapsed)
        const anns = getAnnotations(state);
        expect(Object.keys(anns)).toHaveLength(1); // only revision remains
    });

    it("flush with contaminated annotations overwrites old version's sub-annotations", () => {
        // Demonstrates the data-loss scenario that the activeVersionIndex guard
        // in flushToParent/flushAnnotationStateToParent prevents:
        //
        // 1. Version 0 has sub-annotations (annotationField blob)
        // 2. Version switch fires
        // 3. syncFromParent patches the nested editor with new version's text
        // 4. The doc change in step 3 collapses/drops sub-annotations
        // 5. flushToParent writes the now-empty annotationField to version 0's blob
        // 6. Switching back to version 0 shows no sub-annotations
        let state = makeState("hello");
        const subAnnotations = {
            0: {
                id: 0,
                _type: "comment",
                status: "active" as const,
                selection: { ranges: [{ anchor: 1, head: 4 }], main: 0 },
                thread: [{ author: "user", message: "note", time: Date.now() }],
            },
        };
        state = addRevision(state, 0, 5, [
            { doc: "hello", annotationField: subAnnotations },
            "world",
        ]);

        // Switch to version 1
        state = state.update(setActiveRevisionVersion(state, 0, 1)).state;
        expect(state.doc.toString()).toBe("world");

        // Simulate a contaminated flush: the nested editor was synced to "world"
        // which collapsed the sub-annotations, then flushed to version 0's blob.
        // This is the BAD path the guard prevents.
        const contaminatedBlob: TestBlob = {
            doc: "hello", // doc is preserved by merge-only flush
            annotationField: {}, // but annotations were collapsed/dropped
        };
        state = state.update(
            updateRevisionVersionState(state, 0, 0, contaminatedBlob, { addToHistory: false }),
        ).state;

        // Version 0's sub-annotations are now gone — this is the bug.
        const rev = getRevision(state, 0);
        const v0Anns = (rev.versions[0] as { annotationField?: unknown }).annotationField;
        expect(v0Anns).toEqual({}); // contaminated — sub-annotations lost
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
