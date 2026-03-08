/**
 * Integration tests for annotation undo behaviour (issue #78).
 *
 * These tests exercise the scenario where text is deleted and the annotation
 * anchored to that text is implicitly dropped (for comments/suggestions) or
 * collapses (for revisions). Pressing Cmd+Z must restore both the text and
 * the annotation in the correct position.
 */

import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import {
    addAnnotation,
    annotationField,
} from "$lib/editor/plugins/annotations/annotationField";
import { createNewAnnotation, isAnnotationOfType } from "$lib/editor/plugins/annotations/models";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createView(doc: string) {
    const state = EditorState.create({
        doc,
        // newGroupDelay:0 so adjacent transactions are never merged into one
        // undo group — matches real-app conditions where the user and the
        // collapsedRevisionResolver microtask produce separate history entries.
        extensions: [history({ newGroupDelay: 0 }), annotationExtensions()],
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return new EditorView({ state, parent });
}

function addComment(view: EditorView, from: number, to: number, message = "note") {
    const annotation = {
        ...createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(from, to),
            "comment",
        ),
        thread: [{ message, author: "User", time: 1 }],
    };
    view.dispatch(view.state.update({ effects: [addAnnotation.of(annotation)] }));
    return annotation.id;
}

function addRevision(
    view: EditorView,
    from: number,
    to: number,
    versions: { doc: string }[],
    currentlySelected = 0,
) {
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

function getAnnotations(view: EditorView) {
    return Object.values(view.state.field(annotationField));
}

let view: EditorView | undefined;

afterEach(() => {
    view?.destroy();
    view = undefined;
});

// ── Comment undo tests ───────────────────────────────────────────────────────

describe("undo restores comment dropped by text deletion", () => {
    it("restores comment when only the annotated text is deleted", () => {
        // "Hello, world!" — comment on "Hello" [0,5]
        view = createView("Hello, world!");
        addComment(view, 0, 5);

        // Delete "Hello"
        view.dispatch({ changes: { from: 0, to: 5 } });
        expect(view.state.doc.toString()).toBe(", world!");
        expect(getAnnotations(view)).toHaveLength(0);

        // Undo — text and annotation should both return
        undo(view);
        expect(view.state.doc.toString()).toBe("Hello, world!");
        const anns = getAnnotations(view);
        expect(anns).toHaveLength(1);
        expect(isAnnotationOfType(anns[0], "comment")).toBe(true);
        expect(anns[0].selection.main.from).toBe(0);
        expect(anns[0].selection.main.to).toBe(5);
    });

    it("restores comment when annotated text plus surrounding text is deleted", () => {
        // "foo hello bar" — comment on "hello" [4,9]
        view = createView("foo hello bar");
        addComment(view, 4, 9);

        // Delete "foo hello" (0–9) — more than just the annotation
        view.dispatch({ changes: { from: 0, to: 9 } });
        expect(view.state.doc.toString()).toBe(" bar");
        expect(getAnnotations(view)).toHaveLength(0);

        // Undo
        undo(view);
        expect(view.state.doc.toString()).toBe("foo hello bar");
        const anns = getAnnotations(view);
        expect(anns).toHaveLength(1);
        expect(isAnnotationOfType(anns[0], "comment")).toBe(true);
        expect(anns[0].selection.main.from).toBe(4);
        expect(anns[0].selection.main.to).toBe(9);
    });

    it("restores only the affected comment when a second annotation is unaffected", () => {
        // "foo hello bar" — two comments: "foo" [0,3] and "hello" [4,9]
        view = createView("foo hello bar");
        addComment(view, 0, 3, "first");
        addComment(view, 4, 9, "second");

        // Delete only "hello" [4,9] — drops second comment, keeps first
        view.dispatch({ changes: { from: 4, to: 9 } });
        expect(view.state.doc.toString()).toBe("foo  bar");
        expect(getAnnotations(view)).toHaveLength(1);

        // Undo — both comments should be present
        undo(view);
        expect(view.state.doc.toString()).toBe("foo hello bar");
        const anns = getAnnotations(view);
        expect(anns).toHaveLength(2);
        const positions = anns.map((a) => ({
            from: a.selection.main.from,
            to: a.selection.main.to,
        }));
        expect(positions).toContainEqual({ from: 0, to: 3 });
        expect(positions).toContainEqual({ from: 4, to: 9 });
    });
});

// ── Revision undo tests ──────────────────────────────────────────────────────

describe("undo restores revision whose selection collapsed after text deletion", () => {
    it("revision selection re-expands correctly after undo", () => {
        // "Hello, world!" — revision on "Hello" [0,5]
        view = createView("Hello, world!");
        addRevision(view, 0, 5, [{ doc: "Hello" }]);

        // Delete "Hello"
        view.dispatch({ changes: { from: 0, to: 5 } });
        expect(view.state.doc.toString()).toBe(", world!");

        // The revision survives with a collapsed selection
        const collapsed = getAnnotations(view);
        expect(collapsed).toHaveLength(1);
        expect(collapsed[0].selection.main.empty).toBe(true);

        // Undo before flushing microtasks — the collapsedRevisionResolver
        // queues a microtask but we undo before it fires so the undo stack
        // still has the deletion as the top entry.
        undo(view);
        expect(view.state.doc.toString()).toBe("Hello, world!");
        const anns = getAnnotations(view);
        expect(anns).toHaveLength(1);
        expect(isAnnotationOfType(anns[0], "revision")).toBe(true);
        // Selection should span the restored text again
        expect(anns[0].selection.main.from).toBe(0);
        expect(anns[0].selection.main.to).toBe(5);
        expect(view.state.sliceDoc(anns[0].selection.main.from, anns[0].selection.main.to)).toBe(
            "Hello",
        );
    });

    it("revision version doc is not corrupted to empty string after deletion+undo", () => {
        view = createView("Hello, world!");
        addRevision(view, 0, 5, [{ doc: "Hello" }, { doc: "Howdy" }], 0);

        // Delete "Hello"
        view.dispatch({ changes: { from: 0, to: 5 } });

        // Undo before flushing microtasks (same reason as other revision tests)
        undo(view);
        const anns = getAnnotations(view);
        expect(anns).toHaveLength(1);
        if (!isAnnotationOfType(anns[0], "revision")) return;

        // The active version doc must still be "Hello", not ""
        expect(anns[0].versions[0]?.doc).toBe("Hello");
        expect(anns[0].versions[1]?.doc).toBe("Howdy");
    });

    it("revision selection re-expands correctly when surrounding text is also deleted", () => {
        // "foo hello bar" — revision on "hello" [4,9]
        view = createView("foo hello bar");
        addRevision(view, 4, 9, [{ doc: "hello" }]);

        // Delete "foo hello" (0–9)
        view.dispatch({ changes: { from: 0, to: 9 } });
        expect(view.state.doc.toString()).toBe(" bar");

        // Undo before flushing microtasks (same reason as other revision tests)
        undo(view);
        expect(view.state.doc.toString()).toBe("foo hello bar");
        const anns = getAnnotations(view);
        expect(anns).toHaveLength(1);
        expect(anns[0].selection.main.from).toBe(4);
        expect(anns[0].selection.main.to).toBe(9);
    });

    it("deleting normal-text + revision + normal-text restores all on undo", () => {
        // "aaa[HELLO]bbb" where [HELLO] is a revision — delete the whole thing
        view = createView("aaaHELLObbb");
        // revision covers "HELLO" at [3, 8]
        addRevision(view, 3, 8, [{ doc: "HELLO" }]);

        // Delete the entire document "aaaHELLObbb" [0, 11]
        view.dispatch({ changes: { from: 0, to: 11 } });
        expect(view.state.doc.toString()).toBe("");

        undo(view);
        expect(view.state.doc.toString()).toBe("aaaHELLObbb");
        const anns = getAnnotations(view);
        expect(anns).toHaveLength(1);
        expect(anns[0].selection.main.from).toBe(3);
        expect(anns[0].selection.main.to).toBe(8);
    });

    it("deleting text before revision + revision restores all on undo", () => {
        // "prefix[HELLO]suffix" — delete "prefix" + "HELLO", keep "suffix"
        view = createView("prefixHELLOsuffix");
        // revision covers "HELLO" at [6, 11]
        addRevision(view, 6, 11, [{ doc: "HELLO" }]);

        // Delete "prefixHELLO" [0, 11]
        view.dispatch({ changes: { from: 0, to: 11 } });
        expect(view.state.doc.toString()).toBe("suffix");

        undo(view);
        expect(view.state.doc.toString()).toBe("prefixHELLOsuffix");
        const anns = getAnnotations(view);
        expect(anns).toHaveLength(1);
        expect(anns[0].selection.main.from).toBe(6);
        expect(anns[0].selection.main.to).toBe(11);
    });

    it("deleting only the normal text before a revision restores it on undo", () => {
        // "prefix[HELLO]suffix" — delete only "prefix", revision stays
        view = createView("prefixHELLOsuffix");
        addRevision(view, 6, 11, [{ doc: "HELLO" }]);

        // Delete only "prefix" [0, 6] — revision shifts to [0, 5]
        view.dispatch({ changes: { from: 0, to: 6 } });
        expect(view.state.doc.toString()).toBe("HELLOsuffix");

        undo(view);
        expect(view.state.doc.toString()).toBe("prefixHELLOsuffix");
        const anns = getAnnotations(view);
        expect(anns).toHaveLength(1);
        expect(anns[0].selection.main.from).toBe(6);
        expect(anns[0].selection.main.to).toBe(11);
    });

    it("deleting normal text before and after revision (not the revision itself) restores on undo", () => {
        // "aaa[HELLO]bbb" — delete "aaa" and "bbb" in two separate ops,
        // leaving the revision intact but shifted. Both undos must restore.
        view = createView("aaaHELLObbb");
        addRevision(view, 3, 8, [{ doc: "HELLO" }]);

        // Delete "bbb" [8, 11] — revision stays at [3,8]
        view.dispatch({ changes: { from: 8, to: 11 } });
        expect(view.state.doc.toString()).toBe("aaaHELLO");

        // Delete "aaa" [0, 3] — revision shifts to [0,5]
        view.dispatch({ changes: { from: 0, to: 3 } });
        expect(view.state.doc.toString()).toBe("HELLO");

        // Undo second deletion
        undo(view);
        expect(view.state.doc.toString()).toBe("aaaHELLO");
        expect(getAnnotations(view)[0]?.selection.main.from).toBe(3);

        // Undo first deletion
        undo(view);
        expect(view.state.doc.toString()).toBe("aaaHELLObbb");
        const anns = getAnnotations(view);
        expect(anns).toHaveLength(1);
        expect(anns[0].selection.main.from).toBe(3);
        expect(anns[0].selection.main.to).toBe(8);
    });

    it("deleting only the normal text after a revision restores it on undo", () => {
        // "prefix[HELLO]suffix" — delete only "suffix", revision stays
        view = createView("prefixHELLOsuffix");
        addRevision(view, 6, 11, [{ doc: "HELLO" }]);

        // Delete only "suffix" [11, 17]
        view.dispatch({ changes: { from: 11, to: 17 } });
        expect(view.state.doc.toString()).toBe("prefixHELLO");

        undo(view);
        expect(view.state.doc.toString()).toBe("prefixHELLOsuffix");
        const anns = getAnnotations(view);
        expect(anns).toHaveLength(1);
        expect(anns[0].selection.main.from).toBe(6);
        expect(anns[0].selection.main.to).toBe(11);
    });
});

// ── Post-microtask undo tests (issue: collapsedRevisionResolver race) ─────────
//
// These tests flush microtasks (via `await Promise.resolve()`) after the
// deletion so that collapsedRevisionResolver's deferred dispatch runs before
// the undo. This mirrors real-world usage where the user pauses before pressing
// Cmd+Z. With the fix, the resolver dispatches removeAnnotation tagged
// addToHistory.of(false), so no extra undo history entry is created and a
// single Cmd+Z fully restores the document and annotation.

describe("single undo restores revision after collapsedRevisionResolver fires", () => {
    it("restores single-version revision after resolver fires", async () => {
        // "aaaHELLObbb" — revision on "HELLO" [3,8], one version
        view = createView("aaaHELLObbb");
        addRevision(view, 3, 8, [{ doc: "HELLO" }]);

        // Delete entire document
        view.dispatch({ changes: { from: 0, to: 11 } });
        expect(view.state.doc.toString()).toBe("");

        // Flush microtasks so the resolver fires before undo
        await Promise.resolve();

        // Annotation should now be gone (removed by the resolver)
        expect(getAnnotations(view)).toHaveLength(0);

        // A single undo must fully restore text and annotation
        undo(view);
        expect(view.state.doc.toString()).toBe("aaaHELLObbb");
        const anns = getAnnotations(view);
        expect(anns).toHaveLength(1);
        expect(isAnnotationOfType(anns[0], "revision")).toBe(true);
        expect(anns[0].selection.main.from).toBe(3);
        expect(anns[0].selection.main.to).toBe(8);
    });

    it("restores multi-version revision after resolver fires", async () => {
        // "aaaHELLObbb" — revision on "HELLO" [3,8], two versions
        view = createView("aaaHELLObbb");
        addRevision(view, 3, 8, [{ doc: "HELLO" }, { doc: "Howdy" }], 0);

        // Delete entire document
        view.dispatch({ changes: { from: 0, to: 11 } });
        expect(view.state.doc.toString()).toBe("");

        // Flush microtasks so the resolver fires before undo
        await Promise.resolve();

        // Annotation should now be gone (removed by the resolver)
        expect(getAnnotations(view)).toHaveLength(0);

        // A single undo must fully restore text and annotation (all versions)
        undo(view);
        expect(view.state.doc.toString()).toBe("aaaHELLObbb");
        const anns = getAnnotations(view);
        expect(anns).toHaveLength(1);
        expect(isAnnotationOfType(anns[0], "revision")).toBe(true);
        expect(anns[0].selection.main.from).toBe(3);
        expect(anns[0].selection.main.to).toBe(8);
        if (isAnnotationOfType(anns[0], "revision")) {
            expect(anns[0].versions).toHaveLength(2);
            expect(anns[0].versions[0]?.doc).toBe("HELLO");
            expect(anns[0].versions[1]?.doc).toBe("Howdy");
        }
    });

    it("no extra undo steps needed after resolver fires", async () => {
        // Regression: before the fix, up to 3 Cmd+Z presses were needed because
        // collapsedRevisionResolver created a spurious history entry (H2) between
        // the deletion (H1) and the addAnnotation (H0). After the fix the resolver
        // uses addToHistory:false, so H2 never appears. The expected history is:
        //   H0: addAnnotation  →  undo removes annotation, text stays
        //   H1: deletion       →  undo restores text + annotation
        // There is no intermediate broken state from H2.
        view = createView("Hello, world!");
        addRevision(view, 0, 5, [{ doc: "Hello" }]);

        view.dispatch({ changes: { from: 0, to: 5 } });
        expect(view.state.doc.toString()).toBe(", world!");

        // Let the resolver clean up the collapsed annotation
        await Promise.resolve();
        expect(getAnnotations(view)).toHaveLength(0);

        // First undo (H1) must fully restore text and annotation in one step
        undo(view);
        expect(view.state.doc.toString()).toBe("Hello, world!");
        expect(getAnnotations(view)).toHaveLength(1);
        expect(getAnnotations(view)[0].selection.main.from).toBe(0);
        expect(getAnnotations(view)[0].selection.main.to).toBe(5);

        // Second undo (H0) removes the annotation — this is the addAnnotation
        // that was dispatched when the revision was created, NOT a spurious
        // resolver entry. Text stays, annotation is removed cleanly.
        undo(view);
        expect(view.state.doc.toString()).toBe("Hello, world!");
        expect(getAnnotations(view)).toHaveLength(0);
    });
});

// ── Multiple revision deletion ────────────────────────────────────────────────
//
// When a single deletion collapses multiple revision annotations, the
// collapsedRevisionResolver must clean up ALL of them (not just the first),
// and a single Cmd+Z must restore all of them.

describe("deleting multiple revisions in one selection", () => {
    it("cleans up both collapsed revisions after resolver fires", async () => {
        // "aaa[REV1]bbb[REV2]ccc" — delete everything, both revisions collapse
        view = createView("aaaREV1bbbREV2ccc");
        addRevision(view, 3, 7, [{ doc: "REV1" }]);
        addRevision(view, 10, 14, [{ doc: "REV2" }]);

        view.dispatch({ changes: { from: 0, to: 17 } });
        expect(view.state.doc.toString()).toBe("");

        // Both revisions survive as collapsed annotations before the resolver fires
        expect(getAnnotations(view)).toHaveLength(2);
        expect(getAnnotations(view).every((a) => a.selection.main.empty)).toBe(true);

        // Flush microtasks — resolver should remove both in one dispatch
        await Promise.resolve();
        expect(getAnnotations(view)).toHaveLength(0);
    });

    it("restores both revisions with a single undo after resolver fires", async () => {
        // "aaa[REV1]bbb[REV2]ccc" — delete everything, undo after resolver runs
        view = createView("aaaREV1bbbREV2ccc");
        addRevision(view, 3, 7, [{ doc: "REV1" }]);
        addRevision(view, 10, 14, [{ doc: "REV2" }]);

        view.dispatch({ changes: { from: 0, to: 17 } });
        await Promise.resolve(); // let the resolver fire
        expect(getAnnotations(view)).toHaveLength(0);

        // Single undo must restore text and both annotations
        undo(view);
        expect(view.state.doc.toString()).toBe("aaaREV1bbbREV2ccc");
        const anns = getAnnotations(view);
        expect(anns).toHaveLength(2);
        const positions = anns.map((a) => ({
            from: a.selection.main.from,
            to: a.selection.main.to,
        }));
        expect(positions).toContainEqual({ from: 3, to: 7 });
        expect(positions).toContainEqual({ from: 10, to: 14 });
    });

    it("no orphaned collapsed annotations after undo when resolver fired", async () => {
        // Regression: spurious addAnnotation(collapsed) effects from invertedEffects
        // used to re-insert collapsed annotations after undo.
        view = createView("aaaREV1bbbREV2ccc");
        addRevision(view, 3, 7, [{ doc: "REV1" }]);
        addRevision(view, 10, 14, [{ doc: "REV2" }]);

        view.dispatch({ changes: { from: 0, to: 17 } });
        await Promise.resolve(); // resolver fires, removes both

        undo(view);
        const anns = getAnnotations(view);
        // All restored annotations must have non-empty selections
        expect(anns.every((a) => !a.selection.main.empty)).toBe(true);
        expect(anns).toHaveLength(2);
    });
});
