/**
 * Tests that Mod-Alt-k and Mod-Alt-m in the nested editor intercept
 * annotation creation and publish a nested-annotation-create event
 * instead of creating a dead-end annotation in the nested editor's state.
 *
 * Bug: pressing Cmd+Alt+K in the inline nested editor would create an
 * annotation in the nested editor's own state (which has no annotations
 * panel and doesn't flush annotations on destroy), instead of opening
 * the modal with the pending nested command.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { annotationField, addAnnotation } from "$lib/editor/plugins/annotations/annotationField";
import { createNewAnnotation, type VersionState } from "$lib/editor/plugins/annotations/models";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import { makeParentUndoKeymap } from "$lib/editor/plugins/annotations/nestedEditor";
import { annotationEventBus } from "$lib/editor/plugins/annotations/eventBus";

// ── Helpers ──────────────────────────────────────────────────────

function createParentView(doc: string) {
    const state = EditorState.create({
        doc,
        extensions: [annotationExtensions()],
    });
    const el = document.createElement("div");
    document.body.appendChild(el);
    return new EditorView({ state, parent: el });
}

function addRevision(view: EditorView, from: number, to: number) {
    const revision = {
        ...createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(from, to),
            "revision",
        ),
        activeVersionIndex: 0,
        versions: [{ doc: view.state.sliceDoc(from, to) } as VersionState],
    };
    view.dispatch(view.state.update({ effects: [addAnnotation.of(revision)] }));
    return revision.id;
}

/**
 * Create a nested-style editor that has both the annotation extensions
 * (so annotationField exists) and makeParentUndoKeymap (which includes
 * the Mod-Alt-k/m interceptors).
 */
function createNestedView(parentView: EditorView, revisionId: number, doc: string) {
    const state = EditorState.create({
        doc,
        extensions: [annotationExtensions(), makeParentUndoKeymap(parentView, revisionId)],
    });
    const el = document.createElement("div");
    document.body.appendChild(el);
    return new EditorView({ state, parent: el });
}

/**
 * Extract key bindings from makeParentUndoKeymap and run the one
 * matching the given key against the nested view. This mirrors how
 * CodeMirror dispatches keymap handlers.
 *
 * jsdom doesn't fully support CodeMirror's key dispatch, so we call
 * the handler functions directly (same approach as the existing
 * annotations.keymap.test.ts).
 */
function runNestedKey(
    nestedView: EditorView,
    parentView: EditorView,
    revisionId: number,
    key: string,
): boolean {
    // Rebuild the keymap to extract bindings (Prec.highest wraps them)
    const keymapExt = makeParentUndoKeymap(parentView, revisionId);
    // Walk the extension to find KeyBinding objects
    const bindings = extractBindings(keymapExt);
    for (const binding of bindings) {
        if (binding.key === key && binding.run) {
            const consumed = binding.run(nestedView);
            if (consumed) return true;
        }
    }
    return false;
}

/**
 * Recursively extract KeyBinding objects from a Prec-wrapped keymap extension.
 */
function extractBindings(
    ext: unknown,
): Array<{ key?: string; run?: (view: EditorView) => boolean }> {
    if (!ext || typeof ext !== "object") return [];
    // Prec.highest returns { inner: Extension }
    if ("inner" in (ext as Record<string, unknown>)) {
        return extractBindings((ext as Record<string, unknown>).inner);
    }
    // keymap.of returns an array-like extension
    if (Array.isArray(ext)) {
        return ext.flatMap(extractBindings);
    }
    // A KeyBinding has key and run
    if ("key" in (ext as Record<string, unknown>) && "run" in (ext as Record<string, unknown>)) {
        return [ext as { key?: string; run?: (view: EditorView) => boolean }];
    }
    // Extension with value property (facet provider)
    if ("value" in (ext as Record<string, unknown>)) {
        return extractBindings((ext as Record<string, unknown>).value);
    }
    return [];
}

let parentView: EditorView | undefined;
let nestedView: EditorView | undefined;
let unsubs: (() => void)[] = [];

afterEach(() => {
    for (const unsub of unsubs) unsub();
    unsubs = [];
    nestedView?.destroy();
    nestedView = undefined;
    parentView?.destroy();
    parentView = undefined;
});

describe("nested editor keymap intercepts annotation creation", () => {
    it("Mod-Alt-k in nested editor fires nested-annotation-create instead of creating annotation", () => {
        const spy = vi.fn();
        unsubs.push(annotationEventBus.on("nested-annotation-create", spy));
        parentView = createParentView("Alpha Beta Gamma");
        const revisionId = addRevision(parentView, 6, 10);
        nestedView = createNestedView(parentView, revisionId, "Beta");

        // Select text in nested editor
        nestedView.dispatch({ selection: EditorSelection.range(0, 4) });

        const consumed = runNestedKey(nestedView, parentView, revisionId, "Mod-Alt-k");
        expect(consumed).toBe(true);

        // Should have published the nested editor event
        expect(spy).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "nested-annotation-create",
                command: {
                    revisionId,
                    type: "revision",
                    selectionFrom: 0,
                    selectionTo: 4,
                },
            }),
        );

        // Should NOT have created an annotation in the nested editor's state
        const nestedAnnotations = Object.values(nestedView.state.field(annotationField));
        expect(nestedAnnotations).toHaveLength(0);
    });

    it("Mod-Alt-m in nested editor fires nested-annotation-create for comment", () => {
        const spy = vi.fn();
        unsubs.push(annotationEventBus.on("nested-annotation-create", spy));
        parentView = createParentView("Alpha Beta Gamma");
        const revisionId = addRevision(parentView, 6, 10);
        nestedView = createNestedView(parentView, revisionId, "Beta");

        // Select text in nested editor
        nestedView.dispatch({ selection: EditorSelection.range(1, 3) });

        const consumed = runNestedKey(nestedView, parentView, revisionId, "Mod-Alt-m");
        expect(consumed).toBe(true);

        expect(spy).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "nested-annotation-create",
                command: {
                    revisionId,
                    type: "comment",
                    selectionFrom: 1,
                    selectionTo: 3,
                },
            }),
        );

        // Should NOT have created an annotation in the nested editor's state
        const nestedAnnotations = Object.values(nestedView.state.field(annotationField));
        expect(nestedAnnotations).toHaveLength(0);
    });

    it("Mod-Alt-k with empty selection in nested editor does not fire event", () => {
        const spy = vi.fn();
        unsubs.push(annotationEventBus.on("nested-annotation-create", spy));
        parentView = createParentView("Alpha Beta Gamma");
        const revisionId = addRevision(parentView, 6, 10);
        nestedView = createNestedView(parentView, revisionId, "Beta");

        // Cursor without selection
        nestedView.dispatch({ selection: { anchor: 2 } });

        const consumed = runNestedKey(nestedView, parentView, revisionId, "Mod-Alt-k");
        expect(consumed).toBe(false);

        // No event should fire (empty selection)
        expect(spy).not.toHaveBeenCalled();

        // No annotation should be created either
        const nestedAnnotations = Object.values(nestedView.state.field(annotationField));
        expect(nestedAnnotations).toHaveLength(0);
    });
});
