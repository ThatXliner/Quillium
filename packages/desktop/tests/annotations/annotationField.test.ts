import { describe, it, expect } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
    annotationField,
    addAnnotation,
    removeAnnotation,
    updateThread,
    addSuggestion,
    previewSuggestion,
    suggestionPreviewField,
    applySuggestion,
    setActiveRevisionVersion,
    createNewRevision,
    deleteRevisionVersion,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    activeVersionIndex,
    createNewAnnotation,
    isAnnotationOfType,
    makeVersion,
    type GenericAnnotation,
} from "$lib/editor/plugins/annotations/models";

// Resolve a positional version index to its stable id off the live state.
function versionIdAt(state: EditorState, annotationId: number, index: number): string {
    const ann = state.field(annotationField)[annotationId];
    if (!ann || !isAnnotationOfType(ann, "revision")) {
        throw new Error(`Annotation ${annotationId} is not a revision`);
    }
    return ann.versions[index].id;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sel(from: number, to: number) {
    return EditorSelection.create([EditorSelection.range(from, to)]);
}

function makeState(doc = "Hello, world!") {
    return EditorState.create({
        doc,
        extensions: [annotationField, suggestionPreviewField],
    });
}

function makeComment(id: number, from: number, to: number): GenericAnnotation {
    return {
        id,
        _type: "comment",
        selection: sel(from, to),
        thread: [],
    };
}

function makeRevision(
    id: number,
    from: number,
    to: number,
    versions: { doc: string }[],
    activeIndex = 0,
): GenericAnnotation {
    const builtVersions = versions.map((v) => makeVersion(v));
    return {
        id,
        _type: "revision",
        selection: sel(from, to),
        thread: [],
        activeVersionId: builtVersions[activeIndex].id,
        versions: builtVersions,
    };
}

function makeSuggestion(
    id: number,
    from: number,
    to: number,
    replacements: { text: string }[],
): GenericAnnotation {
    return {
        id,
        _type: "suggestion",
        selection: sel(from, to),
        thread: [],
        replacements,
    };
}

// ── 1. annotationField.create() ─────────────────────────────────────────────

describe("annotationField.create", () => {
    it("initial state is an empty object", () => {
        const state = makeState();
        const annotations = state.field(annotationField);
        expect(Object.keys(annotations)).toHaveLength(0);
    });
});

// ── 2. addAnnotation effect ─────────────────────────────────────────────────

describe("addAnnotation effect", () => {
    it("adds an annotation to the map", () => {
        const state = makeState();
        const comment = makeComment(0, 0, 5);
        const newState = state.update({
            effects: [addAnnotation.of(comment)],
        }).state;
        const annotations = newState.field(annotationField);
        expect(annotations[0]).toBeDefined();
        expect(annotations[0]._type).toBe("comment");
    });

    it("adds multiple annotations with different IDs", () => {
        let state = makeState();
        const c1 = makeComment(0, 0, 3);
        const c2 = makeComment(1, 4, 7);
        state = state.update({
            effects: [addAnnotation.of(c1), addAnnotation.of(c2)],
        }).state;
        const annotations = state.field(annotationField);
        expect(Object.keys(annotations)).toHaveLength(2);
    });
});

// ── 3. removeAnnotation effect ──────────────────────────────────────────────

describe("removeAnnotation effect", () => {
    it("removes an annotation from the map", () => {
        const state = makeState();
        const comment = makeComment(0, 0, 5);
        const withComment = state.update({
            effects: [addAnnotation.of(comment)],
        }).state;
        const removed = withComment.update({
            effects: [removeAnnotation.of(comment)],
        }).state;
        const annotations = removed.field(annotationField);
        expect(annotations[0]).toBeUndefined();
        expect(Object.keys(annotations)).toHaveLength(0);
    });
});

// ── 4. updateThread effect ──────────────────────────────────────────────────

describe("updateThread effect", () => {
    it("replaces the thread on a comment", () => {
        const state = makeState();
        const comment = makeComment(0, 0, 5);
        const withComment = state.update({
            effects: [addAnnotation.of(comment)],
        }).state;
        const newThread = [{ message: "Hello", author: "alice", time: 1 }];
        const updated = withComment.update({
            effects: [
                updateThread.of({
                    annotationId: 0,
                    newThread,
                }),
            ],
        }).state;
        const annotations = updated.field(annotationField);
        expect(annotations[0].thread).toEqual(newThread);
    });
});

// ── 5. addSuggestion effect ─────────────────────────────────────────────────

describe("addSuggestion effect", () => {
    it("finds targetText in doc and creates suggestion at correct range", () => {
        const state = makeState("The quick brown fox");
        const newState = state.update({
            effects: [
                addSuggestion.of({
                    targetText: "quick",
                    replacements: [{ text: "fast" }],
                }),
            ],
        }).state;
        const annotations = newState.field(annotationField);
        const keys = Object.keys(annotations);
        expect(keys).toHaveLength(1);
        const suggestion = annotations[Number(keys[0])];
        expect(suggestion._type).toBe("suggestion");
        expect(suggestion.selection.main.from).toBe(4);
        expect(suggestion.selection.main.to).toBe(9);
    });

    it("creates multiple suggestions for repeated text", () => {
        const state = makeState("ab ab ab");
        const newState = state.update({
            effects: [
                addSuggestion.of({
                    targetText: "ab",
                    replacements: [{ text: "cd" }],
                }),
            ],
        }).state;
        const annotations = newState.field(annotationField);
        expect(Object.keys(annotations).length).toBe(3);
    });

    it("creates no suggestion when targetText is not found", () => {
        const state = makeState("Hello, world!");
        const newState = state.update({
            effects: [
                addSuggestion.of({
                    targetText: "missing",
                    replacements: [{ text: "found" }],
                }),
            ],
        }).state;
        const annotations = newState.field(annotationField);
        expect(Object.keys(annotations)).toHaveLength(0);
    });
});

// ── 6. previewSuggestion + suggestionPreviewField ───────────────────────────

describe("previewSuggestion + suggestionPreviewField", () => {
    it("starts as null", () => {
        const state = makeState();
        expect(state.field(suggestionPreviewField)).toBeNull();
    });

    it("sets preview via effect", () => {
        const state = makeState();
        const newState = state.update({
            effects: [
                previewSuggestion.of({
                    annotationId: 0,
                    replacementIndex: 1,
                }),
            ],
        }).state;
        expect(newState.field(suggestionPreviewField)).toEqual({
            annotationId: 0,
            replacementIndex: 1,
        });
    });

    it("clears preview on docChanged", () => {
        const state = makeState();
        const withPreview = state.update({
            effects: [
                previewSuggestion.of({
                    annotationId: 0,
                    replacementIndex: 0,
                }),
            ],
        }).state;
        expect(withPreview.field(suggestionPreviewField)).not.toBeNull();
        const afterDocChange = withPreview.update({
            changes: { from: 0, insert: "X" },
        }).state;
        expect(afterDocChange.field(suggestionPreviewField)).toBeNull();
    });

    it("clears preview when set to null", () => {
        const state = makeState();
        const withPreview = state.update({
            effects: [
                previewSuggestion.of({
                    annotationId: 0,
                    replacementIndex: 0,
                }),
            ],
        }).state;
        const cleared = withPreview.update({
            effects: [previewSuggestion.of(null)],
        }).state;
        expect(cleared.field(suggestionPreviewField)).toBeNull();
    });
});

// ── 7. applySuggestion ──────────────────────────────────────────────────────

describe("applySuggestion", () => {
    it("removes annotation and inserts replacement text", () => {
        const state = makeState("The quick brown fox");
        const suggestion = makeSuggestion(0, 4, 9, [{ text: "fast" }]);
        const withSuggestion = state.update({
            effects: [addAnnotation.of(suggestion)],
        }).state;
        const applied = applySuggestion(withSuggestion, 0, 0);
        const newState = withSuggestion.update(applied).state;
        expect(newState.doc.toString()).toBe("The fast brown fox");
        expect(Object.keys(newState.field(annotationField))).toHaveLength(0);
    });
});

// ── 8. setActiveRevisionVersion ─────────────────────────────────────────────

describe("setActiveRevisionVersion", () => {
    it("throws for non-revision annotation", () => {
        const state = makeState("Hello, world!");
        const comment = makeComment(0, 0, 5);
        const withComment = state.update({
            effects: [addAnnotation.of(comment)],
        }).state;
        expect(() => setActiveRevisionVersion(withComment, 0, "v0")).toThrow(
            "Annotation is not a revision",
        );
    });

    it("changes doc content and updates activeVersionIndex", () => {
        const doc = "Hello, world!";
        const state = makeState(doc);
        const revision = makeRevision(0, 0, 5, [{ doc: "Hello" }, { doc: "Howdy" }], 0);
        const withRevision = state.update({
            effects: [addAnnotation.of(revision)],
        }).state;
        const tr = setActiveRevisionVersion(withRevision, 0, versionIdAt(withRevision, 0, 1));
        const newState = withRevision.update(tr).state;
        expect(newState.doc.toString()).toBe("Howdy, world!");
        const ann = newState.field(annotationField)[0];
        expect(ann._type).toBe("revision");
        if (ann._type === "revision") {
            expect(activeVersionIndex(ann)).toBe(1);
        }
    });
});

// ── 9. createNewRevision ────────────────────────────────────────────────────

describe("createNewRevision", () => {
    it("throws for non-revision annotation", () => {
        const state = makeState("Hello, world!");
        const comment = makeComment(0, 0, 5);
        const withComment = state.update({
            effects: [addAnnotation.of(comment)],
        }).state;
        expect(() => createNewRevision(withComment, 0)).toThrow("Annotation is not a revision");
    });

    it("inserts placeholder text and creates a new version", () => {
        const state = makeState("Hello, world!");
        const revision = makeRevision(0, 0, 5, [{ doc: "Hello" }], 0);
        const withRevision = state.update({
            effects: [addAnnotation.of(revision)],
        }).state;
        const tr = createNewRevision(withRevision, 0);
        const newState = withRevision.update(tr).state;
        expect(newState.doc.toString()).toBe(", world!");
        const ann = newState.field(annotationField)[0];
        if (ann._type === "revision") {
            expect(ann.versions).toHaveLength(2);
            expect(activeVersionIndex(ann)).toBe(1);
        }
    });
});

// ── 10. deleteRevisionVersion ───────────────────────────────────────────────

describe("deleteRevisionVersion", () => {
    it("deleting the last version removes the whole revision", () => {
        const state = makeState("Hello, world!");
        const revision = makeRevision(0, 0, 5, [{ doc: "Hello" }], 0);
        const withRevision = state.update({
            effects: [addAnnotation.of(revision)],
        }).state;
        const tr = deleteRevisionVersion(withRevision, 0, versionIdAt(withRevision, 0, 0));
        const newState = withRevision.update(tr).state;
        expect(Object.keys(newState.field(annotationField))).toHaveLength(0);
        // The text covered by the revision is removed
        expect(newState.doc.toString()).toBe(", world!");
    });

    it("deleting the current version switches to a neighbour", () => {
        const state = makeState("Hello, world!");
        const revision = makeRevision(
            0,
            0,
            5,
            [{ doc: "Hello" }, { doc: "Howdy" }, { doc: "Greet" }],
            1,
        );
        const withRevision = state.update({
            effects: [addAnnotation.of(revision)],
        }).state;
        const tr = deleteRevisionVersion(withRevision, 0, versionIdAt(withRevision, 0, 1));
        const newState = withRevision.update(tr).state;
        const ann = newState.field(annotationField)[0];
        expect(ann).toBeDefined();
        if (ann._type === "revision") {
            expect(ann.versions).toHaveLength(2);
            // Should switch to the next available version
            expect(activeVersionIndex(ann)).toBeLessThan(2);
        }
    });

    it("deleting a version before current adjusts activeVersionIndex index", () => {
        const state = makeState("Hello, world!");
        const revision = makeRevision(
            0,
            0,
            5,
            [{ doc: "Hello" }, { doc: "Howdy" }, { doc: "Greet" }],
            2,
        );
        const withRevision = state.update({
            effects: [addAnnotation.of(revision)],
        }).state;
        const tr = deleteRevisionVersion(withRevision, 0, versionIdAt(withRevision, 0, 0));
        const newState = withRevision.update(tr).state;
        const ann = newState.field(annotationField)[0];
        if (ann._type === "revision") {
            expect(ann.versions).toHaveLength(2);
            // Was 2, deleted index 0, so should shift down to 1
            expect(activeVersionIndex(ann)).toBe(1);
        }
    });
});

// ── 11. toJSON / fromJSON round-trip ────────────────────────────────────────

describe("toJSON / fromJSON round-trip", () => {
    it("serializes and deserializes preserving selections", () => {
        const state = makeState("Hello, world!");
        const comment = makeComment(0, 0, 5);
        const revision = makeRevision(1, 7, 12, [{ doc: "world" }], 0);
        const withAnnotations = state.update({
            effects: [addAnnotation.of(comment), addAnnotation.of(revision)],
        }).state;
        const annotations = withAnnotations.field(annotationField);
        const json = withAnnotations.toJSON({
            annotationField,
        });
        const restoredState = EditorState.fromJSON(
            json,
            { extensions: [annotationField] },
            {
                annotationField,
            },
        );
        const restored = restoredState.field(annotationField);
        // Selections must be equal
        expect(restored[0].selection.eq(annotations[0].selection)).toBe(true);
        expect(restored[1].selection.eq(annotations[1].selection)).toBe(true);
        // Types preserved
        expect(restored[0]._type).toBe("comment");
        expect(restored[1]._type).toBe("revision");
    });
});

// ── 12. remapAnnotationSelections ───────────────────────────────────────────

describe("remapAnnotationSelections", () => {
    it("inserting text before annotation shifts its range", () => {
        const state = makeState("Hello, world!");
        const comment = makeComment(0, 7, 12);
        const withComment = state.update({
            effects: [addAnnotation.of(comment)],
        }).state;
        // Insert "XX" at position 0 — shifts everything by 2
        const afterInsert = withComment.update({
            changes: { from: 0, insert: "XX" },
        }).state;
        const ann = afterInsert.field(annotationField)[0];
        expect(ann).toBeDefined();
        expect(ann.selection.main.from).toBe(9);
        expect(ann.selection.main.to).toBe(14);
    });

    it("comment with zero-width range is removed", () => {
        const state = makeState("Hello, world!");
        // Create a comment covering "Hello" (0-5)
        const comment = makeComment(0, 0, 5);
        const withComment = state.update({
            effects: [addAnnotation.of(comment)],
        }).state;
        // Delete "Hello" — comment range collapses to zero-width
        const afterDelete = withComment.update({
            changes: { from: 0, to: 5 },
        }).state;
        const annotations = afterDelete.field(annotationField);
        expect(annotations[0]).toBeUndefined();
    });

    it("revision survives zero-width range", () => {
        const state = makeState("Hello, world!");
        const revision = makeRevision(0, 0, 5, [{ doc: "Hello" }], 0);
        const withRevision = state.update({
            effects: [addAnnotation.of(revision)],
        }).state;
        // Delete the text under the revision — range collapses
        // but revisions survive due to allowEmpty
        const afterDelete = withRevision.update({
            changes: { from: 0, to: 5 },
            annotations: [
                // Need to allow revision doc edit
            ],
        }).state;
        const annotations = afterDelete.field(annotationField);
        expect(annotations[0]).toBeDefined();
        expect(annotations[0]._type).toBe("revision");
    });
});
