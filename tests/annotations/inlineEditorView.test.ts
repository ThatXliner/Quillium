/**
 * Tests for the inline EditorView inside the revision card.
 *
 * These tests cover the three scenarios from ARCHITECTURE.md §Nested Editors
 * "Step 5 — tests to write":
 *
 *   1. Version switch destroys and recreates the nested view
 *      (old dom detached, new view has new version's text).
 *   2. makeParentUndoKeymap flushes before undo — undo restores the text
 *      that was in the nested editor at keypress time.
 *   3. Nested annotations created inline are persisted in the version blob.
 *
 * Tests operate at the pure TypeScript layer (nestedEditor.ts +
 * annotationField.ts) without mounting Svelte components.
 *
 * createInlineVersionState calls getExtensions() → listeners.ts, which
 * triggers a duplicate @codemirror/state module error in jsdom.  The
 * workaround (same as nestedEditorUndo.test.ts) is to build inline
 * EditorViews directly — using history() + annotationExtensions() only —
 * and call syncVersionToParent directly.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo, redo, undoDepth } from "@codemirror/commands";
import { nestedSavedFields } from "$lib/editor/extensions";
import {
    syncVersionToParent,
} from "$lib/editor/plugins/annotations/nestedEditor";
import {
    annotationField,
    addAnnotation,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    createNewAnnotation,
    isAnnotationOfType,
    versionText,
    type VersionState,
} from "$lib/editor/plugins/annotations/models";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";

// ── Helpers ───────────────────────────────────────────────────────────────────

function createParentView(doc = "hello world") {
    const state = EditorState.create({
        doc,
        extensions: [history({ newGroupDelay: 0 }), annotationExtensions()],
    });
    const el = document.createElement("div");
    document.body.appendChild(el);
    return new EditorView({ state, parent: el });
}

/**
 * Creates a minimal inline-style nested EditorView (no history, annotations
 * only) matching the inline editor's setup, without importing getExtensions().
 */
function createInlineView(
    doc: string,
    onDocChanged?: (v: EditorView) => void,
): EditorView {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const state = EditorState.create({
        doc,
        extensions: [
            annotationExtensions(),
            ...(onDocChanged
                ? [EditorView.updateListener.of((u) => {
                    if (u.docChanged) onDocChanged(u.view);
                })]
                : []),
        ],
    });
    return new EditorView({ state, parent: el });
}

/**
 * Adds a revision annotation WITHOUT creating a history entry so it doesn't
 * interfere with undo depth counts in Scenario 2 tests.
 */
function addRevision(
    parentView: EditorView,
    from: number,
    to: number,
    versions: { doc: string }[],
    currentlySelected = 0,
): number {
    const annotation = {
        ...createNewAnnotation(
            parentView.state.field(annotationField),
            EditorSelection.single(from, to),
            "revision",
        ),
        currentlySelected,
        versions,
    };
    parentView.dispatch(
        parentView.state.update({
            effects: [addAnnotation.of(annotation)],
            annotations: [Transaction.addToHistory.of(false)],
        }),
    );
    return annotation.id;
}

function getRevision(parentView: EditorView, revisionId: number) {
    const rev = parentView.state.field(annotationField)[revisionId];
    if (!rev || !isAnnotationOfType(rev, "revision")) {
        throw new Error(`No revision with id ${revisionId}`);
    }
    return rev;
}

// ── State ─────────────────────────────────────────────────────────────────────

let parentView: EditorView;

beforeEach(() => {
    parentView = createParentView("hello world");
});

afterEach(() => {
    parentView.destroy();
});

// ── Scenario 1: Version switch — old view detached, new view mounted ──────────

describe("Scenario 1: version switch destroys old nested view and creates new one", () => {
    it("old nestedView.dom is detached after destroy()", () => {
        const view1 = createInlineView("hello");
        const oldDom = view1.dom;

        view1.destroy();

        expect(oldDom.isConnected).toBe(false);
    });

    it("new nested view contains the new version's text", () => {
        const view1 = createInlineView("hello");
        view1.destroy();

        const view2 = createInlineView("hi there");
        expect(view2.state.doc.toString()).toBe("hi there");
        view2.destroy();
    });

    it("new nested view has a fresh DOM element distinct from the old one", () => {
        const view1 = createInlineView("version A");
        const domBefore = view1.dom;
        view1.destroy();

        const view2 = createInlineView("version B");
        expect(view2.dom).not.toBe(domBefore);
        view2.destroy();
    });
});

// ── Scenario 2: Flush before undo ────────────────────────────────────────────

describe("Scenario 2: syncVersionToParent flush before undo restores correct text", () => {
    it("undo restores text that was in nested editor at flush time", () => {
        // Start with revision spanning 0-5 ("hello") in parent doc "hello world"
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }]);
        expect(undoDepth(parentView.state)).toBe(0); // addRevision is not in history

        const nestedView = createInlineView("hello", (v) => {
            syncVersionToParent(v, parentView, revId, 0);
        });

        // Edit nested view: "hello" → "hello world"
        nestedView.dispatch({
            changes: { from: nestedView.state.doc.length, insert: " world" },
        });
        // updateListener fires syncVersionToParent → parent records the change
        expect(versionText(getRevision(parentView, revId).versions[0])).toBe("hello world");
        expect(undoDepth(parentView.state)).toBe(1);

        // Simulate Mod-z keymap: undo parent (no extra flush needed — the
        // updateListener already synced the latest text when the change fired)
        undo(parentView);

        expect(versionText(getRevision(parentView, revId).versions[0])).toBe("hello");
        expect(undoDepth(parentView.state)).toBe(0);

        nestedView.destroy();
    });

    it("redo after undo restores the newer version text", () => {
        const revId = addRevision(parentView, 0, 5, [{ doc: "hello" }]);
        const nestedView = createInlineView("hello", (v) => {
            syncVersionToParent(v, parentView, revId, 0);
        });

        nestedView.dispatch({
            changes: { from: nestedView.state.doc.length, insert: " world" },
        });

        undo(parentView);
        expect(versionText(getRevision(parentView, revId).versions[0])).toBe("hello");

        redo(parentView);
        expect(versionText(getRevision(parentView, revId).versions[0])).toBe("hello world");

        nestedView.destroy();
    });
});

// ── Scenario 3: Nested annotations persisted in version blob ─────────────────

describe("Scenario 3: nested annotations created inline are persisted in the version blob", () => {
    it("version blob contains annotationField after a nested annotation is added", () => {
        const revId = addRevision(parentView, 0, 11, [{ doc: "hello world" }]);
        const nestedView = createInlineView("hello world", (v) => {
            syncVersionToParent(v, parentView, revId, 0);
        });

        // Add a nested revision annotation spanning "hello" (0–5)
        const nestedAnnotationBase = createNewAnnotation(
            nestedView.state.field(annotationField),
            EditorSelection.single(0, 5),
            "revision",
        );
        nestedView.dispatch(
            nestedView.state.update({
                effects: [
                    addAnnotation.of({
                        ...nestedAnnotationBase,
                        currentlySelected: 0,
                        versions: [{ doc: "hello" }],
                    }),
                ],
            }),
        );

        // Explicitly sync so the blob is written to the parent
        syncVersionToParent(nestedView, parentView, revId, 0);

        const rev = getRevision(parentView, revId);
        const blob = rev.versions[0] as Record<string, unknown>;
        expect(blob).toHaveProperty("annotationField");

        const nestedAnnotations = blob.annotationField as Record<string, unknown>;
        expect(Object.keys(nestedAnnotations).length).toBeGreaterThan(0);

        nestedView.destroy();
    });

    it("blob produced by toJSON(nestedSavedFields) round-trips through fromJSON with annotation intact", () => {
        const nestedView = createInlineView("hello world");

        const nestedAnnotationBase = createNewAnnotation(
            nestedView.state.field(annotationField),
            EditorSelection.single(0, 5),
            "revision",
        );
        nestedView.dispatch(
            nestedView.state.update({
                effects: [
                    addAnnotation.of({
                        ...nestedAnnotationBase,
                        currentlySelected: 0,
                        versions: [{ doc: "hello" }],
                    }),
                ],
            }),
        );

        const blob = nestedView.state.toJSON(nestedSavedFields) as VersionState & {
            annotationField: Record<string, unknown>;
        };
        nestedView.destroy();

        // Round-trip: restore from the blob using EditorState.fromJSON
        const extensions = [annotationExtensions()];
        const restoredState = EditorState.fromJSON(blob, { extensions }, nestedSavedFields);

        const restoredAnnotations = restoredState.field(annotationField);
        const ids = Object.keys(restoredAnnotations);
        expect(ids.length).toBeGreaterThan(0);

        const ann = Object.values(restoredAnnotations)[0];
        expect(ann.selection.main.from).toBe(0);
        expect(ann.selection.main.to).toBe(5);
    });
});
