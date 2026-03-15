/**
 * Tests for revision version text sync via updateRevisionVersionState.
 *
 * The inline revision card uses a <textarea>. On every input event it calls
 * updateRevisionVersionState on the parent EditorView. These tests verify:
 *
 *   1. updateRevisionVersionState writes doc text into the annotation field.
 *   2. Phase 3 (syncRevisionDocsWithDocument) keeps the active version text
 *      in sync when the user types inside the revision range in the main doc.
 *   3. Undo of updateRevisionVersionState restores the previous version text.
 *   4. Undo of a main-doc edit inside a revision range restores the version text.
 *   5. Version switching works and is undoable.
 *   6. syncRevisionDocsWithDocument returns a new annotation object (not a
 *      mutation) so Svelte reactivity fires correctly.
 */

import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo, redo } from "@codemirror/commands";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import {
    addAnnotation,
    annotationField,
    updateRevisionVersionState,
    setActiveRevisionVersion,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    createNewAnnotation,
    isAnnotationOfType,
    versionText,
} from "$lib/editor/plugins/annotations/models";

// ── Helpers ───────────────────────────────────────────────────────────────────

function createView(doc: string) {
    const state = EditorState.create({
        doc,
        extensions: [history({ newGroupDelay: 0 }), annotationExtensions()],
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return new EditorView({ state, parent });
}

function addRevision(
    view: EditorView,
    from: number,
    to: number,
    versions: { doc: string }[],
    currentlySelected = 0,
): number {
    const annotation = {
        ...createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(from, to),
            "revision",
        ),
        currentlySelected,
        versions,
    };
    view.dispatch(view.state.update({ effects: [addAnnotation.of(annotation)] }));
    return annotation.id;
}

function getRevision(view: EditorView, id: number) {
    const ann = view.state.field(annotationField)[id];
    if (!ann || !isAnnotationOfType(ann, "revision")) return undefined;
    return ann;
}

function activeVersionText(view: EditorView, id: number): string {
    const rev = getRevision(view, id);
    if (!rev) return "";
    return versionText(rev.versions[rev.currentlySelected] ?? { doc: "" });
}

let view: EditorView | undefined;

afterEach(() => {
    view?.destroy();
    view = undefined;
});

// ── 1. updateRevisionVersionState writes text ─────────────────────────────────

describe("updateRevisionVersionState writes version text", () => {
    it("updates active version doc when the version is currently selected", () => {
        view = createView("Hello world");
        const id = addRevision(view, 0, 5, [{ doc: "Hello" }]);

        view.dispatch(
            updateRevisionVersionState(view.state, id, 0, { doc: "Hi" }),
        );

        expect(activeVersionText(view, id)).toBe("Hi");
    });

    it("updates a non-active version doc without touching the main doc", () => {
        view = createView("Hello world");
        const id = addRevision(view, 0, 5, [{ doc: "Hello" }, { doc: "Hi" }], 0);

        view.dispatch(
            updateRevisionVersionState(view.state, id, 1, { doc: "Hey" }),
        );

        // Main doc and active version unchanged
        expect(view.state.doc.toString()).toBe("Hello world");
        expect(activeVersionText(view, id)).toBe("Hello");

        // Inactive version updated
        const rev = getRevision(view, id)!;
        expect(versionText(rev.versions[1]!)).toBe("Hey");
    });

    it("preserves existing label when updating version", () => {
        view = createView("Hello world");
        const id = addRevision(view, 0, 5, [{ doc: "Hello", label: "Draft" }]);

        view.dispatch(
            updateRevisionVersionState(view.state, id, 0, { doc: "Hi", label: "Draft" }),
        );

        const rev = getRevision(view, id)!;
        expect(rev.versions[0]?.label).toBe("Draft");
    });
});

// ── 2. Phase 3 syncs version text with main doc ───────────────────────────────

describe("Phase 3: syncRevisionDocsWithDocument keeps version text current", () => {
    it("version text updates when user types inside revision range in main doc", () => {
        view = createView("Hello world");
        const id = addRevision(view, 0, 5, [{ doc: "Hello" }]);

        // Insert "XY" at position 3 — strictly inside the revision range [0,5].
        // CodeMirror's SelectionRange.map always uses assoc=-1 for non-empty
        // range `to`, so inserting AT the boundary (pos 5) does NOT expand the
        // range. Inserting inside (pos 3) keeps [0,7] and triggers Phase 3.
        view.dispatch({ changes: { from: 3, to: 3, insert: "XY" } });

        expect(activeVersionText(view, id)).toBe("HelXYlo");
    });

    it("version text reverts when undo is applied to main-doc edit", () => {
        view = createView("Hello world");
        const id = addRevision(view, 0, 5, [{ doc: "Hello" }]);

        view.dispatch({ changes: { from: 3, to: 3, insert: "XY" } });
        expect(activeVersionText(view, id)).toBe("HelXYlo");

        undo(view);
        expect(activeVersionText(view, id)).toBe("Hello");
    });

    it("inactive version text is not affected by main-doc edit in active range", () => {
        view = createView("Hello world");
        const id = addRevision(view, 0, 5, [{ doc: "Hello" }, { doc: "Hi" }], 0);

        view.dispatch({ changes: { from: 3, to: 3, insert: "XY" } });

        // Active version updated
        expect(activeVersionText(view, id)).toBe("HelXYlo");

        // Inactive version unchanged
        const rev = getRevision(view, id)!;
        expect(versionText(rev.versions[1]!)).toBe("Hi");
    });

    it("phase 3 creates a new versions array reference for Svelte reactivity", () => {
        view = createView("Hello world");
        const id = addRevision(view, 0, 5, [{ doc: "Hello" }]);
        const beforeVersions = view.state.field(annotationField)[id]!.versions;

        // Insert inside the range so Phase 3 actually updates the text.
        view.dispatch({ changes: { from: 3, to: 3, insert: "XY" } });

        const afterVersions = view.state.field(annotationField)[id]!.versions;
        // Phase 3 must produce a new array so Svelte $derived chains re-run.
        expect(afterVersions).not.toBe(beforeVersions);
        expect(afterVersions[0]!.doc).toBe("HelXYlo");
    });

    it("phase 3 skips sync when doc change is outside the revision range", () => {
        view = createView("Hello world");
        const id = addRevision(view, 0, 5, [{ doc: "Hello" }]);

        // Insert after the revision range — Phase 3 reads same text, early-returns.
        view.dispatch({ changes: { from: 7, to: 7, insert: "X" } });

        // Version text must be unchanged.
        expect(activeVersionText(view, id)).toBe("Hello");
    });
});

// ── 3. Undo of updateRevisionVersionState ─────────────────────────────────────

describe("undo of updateRevisionVersionState restores previous version text", () => {
    it("single undo restores previous version doc", () => {
        view = createView("Hello world");
        const id = addRevision(view, 0, 5, [{ doc: "Hello" }]);

        view.dispatch(updateRevisionVersionState(view.state, id, 0, { doc: "Hi there" }));
        expect(activeVersionText(view, id)).toBe("Hi there");

        undo(view);
        expect(activeVersionText(view, id)).toBe("Hello");
    });

    it("redo re-applies the version text update", () => {
        view = createView("Hello world");
        const id = addRevision(view, 0, 5, [{ doc: "Hello" }]);

        view.dispatch(updateRevisionVersionState(view.state, id, 0, { doc: "Hi there" }));
        undo(view);
        expect(activeVersionText(view, id)).toBe("Hello");

        redo(view);
        expect(activeVersionText(view, id)).toBe("Hi there");
    });

    it("multiple sequential updates undo in order", () => {
        view = createView("Hello world");
        const id = addRevision(view, 0, 5, [{ doc: "Hello" }]);

        view.dispatch(updateRevisionVersionState(view.state, id, 0, { doc: "Hi" }));
        view.dispatch(updateRevisionVersionState(view.state, id, 0, { doc: "Hey" }));
        view.dispatch(updateRevisionVersionState(view.state, id, 0, { doc: "Howdy" }));

        undo(view);
        expect(activeVersionText(view, id)).toBe("Hey");

        undo(view);
        expect(activeVersionText(view, id)).toBe("Hi");

        undo(view);
        expect(activeVersionText(view, id)).toBe("Hello");
    });

    it("addToHistory:false does not create an undo entry", () => {
        view = createView("Hello world");
        const id = addRevision(view, 0, 5, [{ doc: "Hello" }]);

        // Simulate drift-correction dispatch (addToHistory: false)
        view.dispatch(
            updateRevisionVersionState(view.state, id, 0, { doc: "Corrected" }, { addToHistory: false }),
        );
        expect(activeVersionText(view, id)).toBe("Corrected");

        // Undo should skip this entry — nothing to undo
        const didUndo = undo(view);
        // Either undo returns false (nothing in stack) or it goes back to
        // the addAnnotation entry, not to "Hello".
        // The version text should NOT be "Corrected" if undo skipped it cleanly.
        // If there's nothing to undo, text stays as "Corrected".
        if (didUndo) {
            // Went back to addAnnotation — annotation is gone or text is original
            expect(activeVersionText(view, id)).not.toBe("Hello");
        }
        // The key invariant: "Corrected" is not treated as a history milestone
        // that can be undone back to "Hello" on its own.
    });
});

// ── 4. Version switching ──────────────────────────────────────────────────────

describe("setActiveRevisionVersion switches active version", () => {
    it("switching version changes the main doc text and active version index", () => {
        view = createView("Hello world");
        const id = addRevision(view, 0, 5, [{ doc: "Hello" }, { doc: "Hi" }], 0);

        view.dispatch(setActiveRevisionVersion(view.state, id, 1));

        const rev = getRevision(view, id)!;
        expect(rev.currentlySelected).toBe(1);
        expect(view.state.sliceDoc(rev.selection.main.from, rev.selection.main.to)).toBe("Hi");
    });

    it("undo of version switch restores previous version and main doc text", () => {
        view = createView("Hello world");
        const id = addRevision(view, 0, 5, [{ doc: "Hello" }, { doc: "Hi" }], 0);

        view.dispatch(setActiveRevisionVersion(view.state, id, 1));
        expect(activeVersionText(view, id)).toBe("Hi");

        undo(view);
        expect(activeVersionText(view, id)).toBe("Hello");
        const rev = getRevision(view, id)!;
        expect(rev.currentlySelected).toBe(0);
        expect(view.state.sliceDoc(rev.selection.main.from, rev.selection.main.to)).toBe("Hello");
    });

    it("redo of version switch re-selects the switched version", () => {
        view = createView("Hello world");
        const id = addRevision(view, 0, 5, [{ doc: "Hello" }, { doc: "Hi" }], 0);

        view.dispatch(setActiveRevisionVersion(view.state, id, 1));
        undo(view);
        redo(view);

        const rev = getRevision(view, id)!;
        expect(rev.currentlySelected).toBe(1);
        expect(activeVersionText(view, id)).toBe("Hi");
    });
});

// ── 5. Undo interaction with main-doc edits ───────────────────────────────────

describe("undo of version state update interleaved with main-doc edits", () => {
    it("undo after textarea edit + main-doc edit restores both correctly", () => {
        // Simulates: textarea oninput → updateRevisionVersionState → user edits
        // elsewhere in the main doc → undo undo should unwind in order.
        view = createView("Hello world");
        const id = addRevision(view, 0, 5, [{ doc: "Hello" }]);

        // Simulate textarea typing
        view.dispatch(updateRevisionVersionState(view.state, id, 0, { doc: "Hi" }));
        // User also types " there" after the revision range
        view.dispatch({ changes: { from: view.state.field(annotationField)[id]!.selection.main.to, insert: " there" } });

        // Undo the main-doc edit
        undo(view);
        expect(activeVersionText(view, id)).toBe("Hi");

        // Undo the textarea edit
        undo(view);
        expect(activeVersionText(view, id)).toBe("Hello");
    });
});
