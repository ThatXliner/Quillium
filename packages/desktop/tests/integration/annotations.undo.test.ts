/**
 * Integration tests for annotation undo behaviour (issue #78).
 *
 * These tests exercise the scenario where text is deleted and the annotation
 * anchored to that text is implicitly dropped (for comments/suggestions) or
 * collapses (for revisions). Pressing Cmd+Z must restore both the text and
 * the annotation in the correct position.
 */

import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import {
    _nestedEditRevision,
    addAnnotation,
    annotationField,
    deleteRevisionVersion,
    nestedEditorEdit,
    updateRevisionVersionState,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    createNewAnnotation,
    isAnnotationOfType,
    makeVersion,
} from "$lib/editor/plugins/annotations/models";
import { history, redo, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createView(doc: string, newGroupDelay = 0) {
    const state = EditorState.create({
        doc,
        // Most tests use delay 0 so adjacent transactions stay separate. A
        // regression can opt into the app's 250ms grouping window explicitly.
        extensions: [history({ newGroupDelay }), annotationExtensions()],
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
    activeVersionIndex = 0,
) {
    const builtVersions = versions.map((v) => makeVersion(v));
    const annotation = {
        ...createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(from, to),
            "revision",
        ),
        activeVersionId: (builtVersions[activeVersionIndex] ?? builtVersions[0]).id,
        versions: builtVersions,
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

describe("joined nested and parent edits", () => {
    it("restores the exact revision range when a parent-boundary delete joins a nested insert", () => {
        view = createView("aa", 250);
        const revisionId = addRevision(view, 1, 2, [{ doc: "a" }]);

        view.dispatch({
            changes: { from: 1, insert: "a" },
            effects: [_nestedEditRevision.of(revisionId)],
            annotations: [nestedEditorEdit.of(revisionId), Transaction.addToHistory.of(true)],
        });
        view.dispatch({ changes: { from: 0, to: 1 } });
        expect(view.state.doc.toString()).toBe("aa");

        expect(undo(view)).toBe(true);
        expect(view.state.doc.toString()).toBe("aa");
        const revision = view.state.field(annotationField)[revisionId];
        expect(revision && isAnnotationOfType(revision, "revision")).toBe(true);
        if (!revision || !isAnnotationOfType(revision, "revision")) return;
        expect(revision.selection.main.from).toBe(1);
        expect(revision.selection.main.to).toBe(2);
        expect(revision.versions[0].doc).toBe("a");
    });
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

describe("undo restores annotation boundaries consumed by text edits", () => {
    it("restores a partially consumed comment at its original range", () => {
        view = createView("abcdef");
        const commentId = addComment(view, 1, 5);

        view.dispatch({ changes: { from: 0, to: 3 } });
        expect(view.state.field(annotationField)[commentId]?.selection.main.from).toBe(0);
        expect(view.state.field(annotationField)[commentId]?.selection.main.to).toBe(2);

        undo(view);
        const restored = view.state.field(annotationField)[commentId];
        expect(view.state.doc.toString()).toBe("abcdef");
        expect(restored?.selection.main.from).toBe(1);
        expect(restored?.selection.main.to).toBe(5);
    });

    it("restores a partially consumed revision and its active text", () => {
        view = createView("abcdef");
        const revisionId = addRevision(view, 1, 5, [{ doc: "bcde" }]);

        view.dispatch({ changes: { from: 0, to: 3 } });
        undo(view);

        const restored = view.state.field(annotationField)[revisionId];
        expect(restored?.selection.main.from).toBe(1);
        expect(restored?.selection.main.to).toBe(5);
        expect(view.state.sliceDoc(1, 5)).toBe("bcde");
        if (restored && isAnnotationOfType(restored, "revision")) {
            expect(restored.versions[0].doc).toBe("bcde");
        }
    });

    it("restores a revision fully consumed by a non-empty replacement", () => {
        view = createView("abcdef");
        const revisionId = addRevision(view, 1, 5, [{ doc: "bcde" }]);

        view.dispatch({ changes: { from: 0, to: 6, insert: "X" } });
        expect(view.state.field(annotationField)[revisionId]).toBeUndefined();

        for (let cycle = 0; cycle < 3; cycle++) {
            undo(view);
            const restored = view.state.field(annotationField)[revisionId];
            expect(view.state.doc.toString()).toBe("abcdef");
            expect(restored?.selection.main.from).toBe(1);
            expect(restored?.selection.main.to).toBe(5);

            redo(view);
            expect(view.state.doc.toString()).toBe("X");
            expect(view.state.field(annotationField)[revisionId]).toBeUndefined();
        }
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

// ── Revision version delete/undo active-pointer tests (issue #270) ────────────

describe("undo of a revision version delete preserves the active pointer", () => {
    // Resolve a positional version index to its stable id off the live state.
    function versionIdAt(v: EditorView, revId: number, index: number): string {
        const ann = v.state.field(annotationField)[revId];
        if (!isAnnotationOfType(ann, "revision")) {
            throw new Error(`Annotation ${revId} is not a revision`);
        }
        return ann.versions[index].id;
    }

    function revision(v: EditorView, revId: number) {
        const ann = v.state.field(annotationField)[revId];
        if (!isAnnotationOfType(ann, "revision")) {
            throw new Error(`Annotation ${revId} is not a revision`);
        }
        return ann;
    }

    it("deleting a NON-active version then undoing keeps the original active version", () => {
        // Three versions; make version 0 active, then delete version 2 (non-active).
        view = createView("Hello, world!");
        const revId = addRevision(view, 0, 5, [{ doc: "A" }, { doc: "B" }, { doc: "C" }], 0);
        const v0 = versionIdAt(view, revId, 0);
        const v2 = versionIdAt(view, revId, 2);
        expect(revision(view, revId).activeVersionId).toBe(v0);

        // Delete the non-active version 2.
        view.dispatch(deleteRevisionVersion(view.state, revId, v2));
        expect(revision(view, revId).versions).toHaveLength(2);
        // Active is unchanged by deleting a non-active version.
        expect(revision(view, revId).activeVersionId).toBe(v0);

        // Undo — version 2 should be restored AND version 0 must remain active.
        undo(view);
        const restored = revision(view, revId);
        expect(restored.versions).toHaveLength(3);
        // The restored version must NOT have stolen the active pointer.
        expect(restored.activeVersionId).toBe(v0);
        // And it really is back in its old slot (index 2).
        expect(restored.versions[2].id).toBe(v2);
    });

    it("deleting the ACTIVE version then undoing restores it as active", () => {
        // Regression guard for the case that already worked: the active-delete
        // inverse re-activates the restored version via the paired
        // _updateActiveRevisionVersion inverse.
        view = createView("Hello, world!");
        const revId = addRevision(view, 0, 5, [{ doc: "A" }, { doc: "B" }, { doc: "C" }], 1);
        const v1 = versionIdAt(view, revId, 1);
        expect(revision(view, revId).activeVersionId).toBe(v1);

        // Delete the active version 1 — active falls to a neighbour.
        view.dispatch(deleteRevisionVersion(view.state, revId, v1));
        expect(revision(view, revId).versions).toHaveLength(2);
        expect(revision(view, revId).activeVersionId).not.toBe(v1);

        // Undo — version 1 is restored and becomes active again.
        undo(view);
        const restored = revision(view, revId);
        expect(restored.versions).toHaveLength(3);
        expect(restored.activeVersionId).toBe(v1);
    });

    it("deleting a non-active version with a non-default active still undoes cleanly", () => {
        // Active = version 1; delete version 0 (before the active one). The
        // active pointer must survive the index shift on both delete and undo.
        view = createView("Hello, world!");
        const revId = addRevision(view, 0, 5, [{ doc: "A" }, { doc: "B" }, { doc: "C" }], 1);
        const v0 = versionIdAt(view, revId, 0);
        const v1 = versionIdAt(view, revId, 1);
        expect(revision(view, revId).activeVersionId).toBe(v1);

        view.dispatch(deleteRevisionVersion(view.state, revId, v0));
        expect(revision(view, revId).activeVersionId).toBe(v1);

        undo(view);
        const restored = revision(view, revId);
        expect(restored.versions).toHaveLength(3);
        expect(restored.activeVersionId).toBe(v1);
        expect(restored.versions[0].id).toBe(v0);
    });
});

describe("undo of an active version update keeps intentionally empty revisions", () => {
    it("does not let collapsed cleanup remove the revision on redo", async () => {
        view = createView("a");
        const revId = addRevision(view, 0, 1, [{ doc: "a" }]);
        const before = view.state.field(annotationField)[revId];
        if (!before || !isAnnotationOfType(before, "revision")) throw new Error();

        view.dispatch(
            updateRevisionVersionState(
                view.state,
                revId,
                before.activeVersionId,
                makeVersion({ doc: "" }),
            ),
        );
        view.dispatch({
            changes: { from: 0, insert: "a" },
            annotations: Transaction.addToHistory.of(false),
        });
        expect(view.state.field(annotationField)[revId]).toBeDefined();

        undo(view);
        await Promise.resolve();
        await Promise.resolve();
        expect(view.state.field(annotationField)[revId]).toBeDefined();

        redo(view);
        await Promise.resolve();
        await Promise.resolve();
        const redone = view.state.field(annotationField)[revId];
        expect(redone).toBeDefined();
        expect(isAnnotationOfType(redone, "revision")).toBe(true);
        if (!redone || !isAnnotationOfType(redone, "revision")) return;
        expect(redone.selection.main.empty).toBe(true);
        expect(redone.versions[0].doc).toBe("");
    });
});
