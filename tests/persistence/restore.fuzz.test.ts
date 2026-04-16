/**
 * Property-based fuzz tests for the restore/healing system.
 *
 * Targets:
 *   - restoreBackup function correctness
 *   - Annotation re-anchoring via text search
 *   - Nested annotation healing inside revisions
 *   - Edge cases where anchor text is not found
 */
import fc from "fast-check";
import { describe, expect, it, afterEach } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, historyField } from "@codemirror/commands";
import { annotationField } from "$lib/editor/plugins/annotations/annotationField";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import { addAnnotation } from "$lib/editor/plugins/annotations/annotationField";
import {
    createNewAnnotation,
    isAnnotationOfType,
    type GenericAnnotation,
} from "$lib/editor/plugins/annotations/models";
import { restoreBackup } from "$lib/editor/restore";

const savedFields = { historyField, annotationField };

// ── Test utilities ───────────────────────────────────────────────────────────

let views: EditorView[] = [];

function createView(doc: string) {
    const state = EditorState.create({
        doc,
        extensions: [history(), annotationExtensions()],
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({ state, parent });
    views.push(view);
    return view;
}

afterEach(() => {
    views.forEach((v) => v.destroy());
    views = [];
});

// ── Basic restore functionality ──────────────────────────────────────────────

describe("restoreBackup basic", () => {
    it("restores document text correctly", () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 10, maxLength: 200 }).map((s) => s.replace(/\r/g, "")),
                fc.string({ minLength: 10, maxLength: 200 }).map((s) => s.replace(/\r/g, "")),
                (originalDoc, backupDoc) => {
                    const view = createView(originalDoc);

                    restoreBackup(view, backupDoc);

                    expect(view.state.doc.toString()).toBe(backupDoc);
                },
            ),
            { numRuns: 30 },
        );
    });

    it("restores empty document", () => {
        const view = createView("Some content here");
        restoreBackup(view, "");
        expect(view.state.doc.toString()).toBe("");
    });

    it("restores to longer document", () => {
        const view = createView("Short");
        const longDoc = "This is a much longer document with more content";
        restoreBackup(view, longDoc);
        expect(view.state.doc.toString()).toBe(longDoc);
    });
});

// ── Annotation re-anchoring ──────────────────────────────────────────────────

describe("Annotation re-anchoring", () => {
    it("re-anchors comment when anchor text exists in backup", () => {
        const originalDoc = "The quick brown fox jumps over the lazy dog";
        const view = createView(originalDoc);

        const annotation = createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(10, 15),
            "comment",
        );
        view.dispatch({ effects: [addAnnotation.of(annotation)] });

        expect(view.state.doc.sliceString(10, 15)).toBe("brown");

        const backupDoc = "A brown animal appeared";
        restoreBackup(view, backupDoc);

        expect(view.state.doc.toString()).toBe(backupDoc);

        const annotations = view.state.field(annotationField);
        expect(annotations[annotation.id]).toBeDefined();

        const restoredAnn = annotations[annotation.id];
        const from = restoredAnn.selection.main.from;
        const to = restoredAnn.selection.main.to;
        expect(view.state.doc.sliceString(from, to)).toBe("brown");
    });

    it("places annotation at position 0 when anchor text not found", () => {
        const originalDoc = "Hello world";
        const view = createView(originalDoc);

        const annotation = createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(6, 11),
            "comment",
        );
        view.dispatch({ effects: [addAnnotation.of(annotation)] });

        expect(view.state.doc.sliceString(6, 11)).toBe("world");

        const backupDoc = "Completely different text";
        restoreBackup(view, backupDoc);

        const annotations = view.state.field(annotationField);
        expect(annotations[annotation.id]).toBeDefined();

        const restoredAnn = annotations[annotation.id];
        expect(restoredAnn.selection.main.from).toBe(0);
        expect(restoredAnn.selection.main.to).toBe(0);
    });

    it("handles multiple annotations with overlapping anchor text", () => {
        const originalDoc = "The word appears here and the word appears there too";
        const view = createView(originalDoc);

        const ann1 = createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(4, 8),
            "comment",
        );
        view.dispatch({ effects: [addAnnotation.of(ann1)] });

        const ann2 = createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(33, 37),
            "comment",
        );
        view.dispatch({ effects: [addAnnotation.of(ann2)] });

        const backupDoc = "Here is the word and nothing else";
        restoreBackup(view, backupDoc);

        const annotations = view.state.field(annotationField);
        expect(Object.keys(annotations).length).toBe(2);

        for (const ann of Object.values(annotations)) {
            const from = ann.selection.main.from;
            const to = ann.selection.main.to;
            expect(from).toBeGreaterThanOrEqual(0);
            expect(to).toBeLessThanOrEqual(view.state.doc.length);
        }
    });

    it("preserves annotation type after restore", () => {
        fc.assert(
            fc.property(
                fc.constantFrom("comment" as const, "suggestion" as const, "revision" as const),
                (annotationType) => {
                    const originalDoc = "Test document with some text";
                    const view = createView(originalDoc);

                    const annotation = createNewAnnotation(
                        view.state.field(annotationField),
                        EditorSelection.single(5, 13),
                        annotationType,
                    );

                    if (annotationType === "revision") {
                        (annotation as any).versions = [{ doc: "document" }];
                        (annotation as any).activeVersionIndex = 0;
                    }

                    view.dispatch({ effects: [addAnnotation.of(annotation)] });

                    const backupDoc = "Another document here";
                    restoreBackup(view, backupDoc);

                    const annotations = view.state.field(annotationField);
                    expect(annotations[annotation.id]).toBeDefined();
                    expect(isAnnotationOfType(annotations[annotation.id], annotationType)).toBe(true);
                },
            ),
            { numRuns: 10 },
        );
    });
});

// ── Revision annotation restore ──────────────────────────────────────────────

describe("Revision annotation restore", () => {
    it("re-anchors revision using active version text", () => {
        const originalDoc = "The universe is vast and mysterious";
        const view = createView(originalDoc);

        const revision: GenericAnnotation = {
            id: 0,
            _type: "revision",
            selection: EditorSelection.single(4, 12),
            thread: [],
            activeVersionIndex: 0,
            versions: [{ doc: "universe" }],
        } as any;

        view.dispatch({ effects: [addAnnotation.of(revision)] });

        const backupDoc = "Exploring the universe today";
        restoreBackup(view, backupDoc);

        const annotations = view.state.field(annotationField);
        expect(annotations[0]).toBeDefined();

        if (isAnnotationOfType(annotations[0], "revision")) {
            const from = annotations[0].selection.main.from;
            const to = annotations[0].selection.main.to;
            expect(view.state.doc.sliceString(from, to)).toBe("universe");
        }
    });

    it("preserves revision versions after restore", () => {
        const originalDoc = "Hello world";
        const view = createView(originalDoc);

        const revision: GenericAnnotation = {
            id: 0,
            _type: "revision",
            selection: EditorSelection.single(6, 11),
            thread: [],
            activeVersionIndex: 1,
            versions: [
                { doc: "world", label: "Original" },
                { doc: "universe", label: "Alternative" },
                { doc: "cosmos", label: "Third option" },
            ],
        } as any;

        view.dispatch({ effects: [addAnnotation.of(revision)] });

        const backupDoc = "Goodbye universe and everything";
        restoreBackup(view, backupDoc);

        const annotations = view.state.field(annotationField);
        if (isAnnotationOfType(annotations[0], "revision")) {
            expect(annotations[0].versions.length).toBe(3);
            expect(annotations[0].versions[0].doc).toBe("world");
            expect(annotations[0].versions[1].doc).toBe("universe");
            expect(annotations[0].versions[2].doc).toBe("cosmos");
            expect(annotations[0].activeVersionIndex).toBe(1);
        }
    });
});

// ── Thread preservation ──────────────────────────────────────────────────────

describe("Thread preservation", () => {
    it("preserves comment thread after restore", () => {
        const originalDoc = "Important text here";
        const view = createView(originalDoc);

        const comment: GenericAnnotation = {
            id: 0,
            _type: "comment",
            selection: EditorSelection.single(0, 9),
            thread: [
                { message: "First comment", author: "Alice", time: 1000 },
                { message: "Second comment", author: "Bob", time: 2000 },
                { message: "Third comment", author: "Charlie", time: 3000 },
            ],
        };

        view.dispatch({ effects: [addAnnotation.of(comment)] });

        const backupDoc = "This Important text is different";
        restoreBackup(view, backupDoc);

        const annotations = view.state.field(annotationField);
        expect(annotations[0]).toBeDefined();
        expect(annotations[0].thread.length).toBe(3);
        expect(annotations[0].thread[0].message).toBe("First comment");
        expect(annotations[0].thread[1].author).toBe("Bob");
        expect(annotations[0].thread[2].time).toBe(3000);
    });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe("Restore edge cases", () => {
    it("handles restore with no annotations", () => {
        const view = createView("Original text");

        restoreBackup(view, "New text");

        expect(view.state.doc.toString()).toBe("New text");
        expect(Object.keys(view.state.field(annotationField)).length).toBe(0);
    });

    it("handles annotations at document boundaries", () => {
        const originalDoc = "Start middle end";
        const view = createView(originalDoc);

        const startAnn = createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(0, 5),
            "comment",
        );
        view.dispatch({ effects: [addAnnotation.of(startAnn)] });

        const endAnn = createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(13, 16),
            "comment",
        );
        view.dispatch({ effects: [addAnnotation.of(endAnn)] });

        const backupDoc = "Start of something new at the end";
        restoreBackup(view, backupDoc);

        const annotations = view.state.field(annotationField);
        expect(Object.keys(annotations).length).toBe(2);

        for (const ann of Object.values(annotations)) {
            expect(ann.selection.main.from).toBeGreaterThanOrEqual(0);
            expect(ann.selection.main.to).toBeLessThanOrEqual(view.state.doc.length);
        }
    });

    it("handles point selections (collapsed ranges)", () => {
        const originalDoc = "Test document";
        const view = createView(originalDoc);

        const annotation: GenericAnnotation = {
            id: 0,
            _type: "comment",
            selection: EditorSelection.single(5, 5),
            thread: [],
        };

        view.dispatch({ effects: [addAnnotation.of(annotation)] });

        const backupDoc = "Different text entirely";
        restoreBackup(view, backupDoc);

        const annotations = view.state.field(annotationField);
        expect(annotations[0]).toBeDefined();
        expect(annotations[0].selection.main.from).toBe(0);
        expect(annotations[0].selection.main.to).toBe(0);
    });

    it("handles unicode anchor text", () => {
        const originalDoc = "Hello 世界 and more";
        const view = createView(originalDoc);

        const annotation = createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(6, 8),
            "comment",
        );
        view.dispatch({ effects: [addAnnotation.of(annotation)] });

        expect(view.state.doc.sliceString(6, 8)).toBe("世界");

        const backupDoc = "In the 世界 there are many things";
        restoreBackup(view, backupDoc);

        const annotations = view.state.field(annotationField);
        const restoredAnn = annotations[annotation.id];
        const from = restoredAnn.selection.main.from;
        const to = restoredAnn.selection.main.to;
        expect(view.state.doc.sliceString(from, to)).toBe("世界");
    });

    it("handles very long anchor text", () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 50, maxLength: 200 }).map((s) => s.replace(/\r/g, "")),
                (longText) => {
                    const originalDoc = `Prefix ${longText} suffix`;
                    const view = createView(originalDoc);

                    const from = 7;
                    const to = 7 + longText.length;
                    const annotation = createNewAnnotation(
                        view.state.field(annotationField),
                        EditorSelection.single(from, to),
                        "comment",
                    );
                    view.dispatch({ effects: [addAnnotation.of(annotation)] });

                    const backupDoc = `Different ${longText} ending`;
                    restoreBackup(view, backupDoc);

                    const annotations = view.state.field(annotationField);
                    const restoredAnn = annotations[annotation.id];
                    const restoredFrom = restoredAnn.selection.main.from;
                    const restoredTo = restoredAnn.selection.main.to;

                    expect(view.state.doc.sliceString(restoredFrom, restoredTo)).toBe(longText);
                },
            ),
            { numRuns: 20 },
        );
    });
});

// ── Stress tests ─────────────────────────────────────────────────────────────

describe("Restore stress tests", () => {
    it("handles many annotations", () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 5, max: 20 }),
                (numAnnotations) => {
                    const words = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];
                    const originalDoc = words.join(" ");
                    const view = createView(originalDoc);

                    const addedIds: number[] = [];
                    let pos = 0;
                    for (let i = 0; i < Math.min(numAnnotations, words.length); i++) {
                        const word = words[i];
                        const annotation = createNewAnnotation(
                            view.state.field(annotationField),
                            EditorSelection.single(pos, pos + word.length),
                            "comment",
                        );
                        view.dispatch({ effects: [addAnnotation.of(annotation)] });
                        addedIds.push(annotation.id);
                        pos += word.length + 1;
                    }

                    const shuffledWords = [...words].sort(() => Math.random() - 0.5);
                    const backupDoc = shuffledWords.join(" ");
                    restoreBackup(view, backupDoc);

                    const annotations = view.state.field(annotationField);
                    expect(Object.keys(annotations).length).toBe(addedIds.length);

                    for (const ann of Object.values(annotations)) {
                        expect(ann.selection.main.from).toBeGreaterThanOrEqual(0);
                        expect(ann.selection.main.to).toBeLessThanOrEqual(view.state.doc.length);
                    }
                },
            ),
            { numRuns: 10 },
        );
    });

    it("restore is idempotent for same backup text", () => {
        const originalDoc = "The quick brown fox";
        const backupDoc = "A brown fox appeared";

        const view = createView(originalDoc);

        const annotation = createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(10, 15),
            "comment",
        );
        view.dispatch({ effects: [addAnnotation.of(annotation)] });

        restoreBackup(view, backupDoc);

        const firstRestore = {
            doc: view.state.doc.toString(),
            annFrom: view.state.field(annotationField)[annotation.id].selection.main.from,
            annTo: view.state.field(annotationField)[annotation.id].selection.main.to,
        };

        restoreBackup(view, backupDoc);

        const secondRestore = {
            doc: view.state.doc.toString(),
            annFrom: view.state.field(annotationField)[annotation.id].selection.main.from,
            annTo: view.state.field(annotationField)[annotation.id].selection.main.to,
        };

        expect(firstRestore).toEqual(secondRestore);
    });
});
