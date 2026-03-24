/**
 * Tests for the ⌘E "enter revision editor" shortcut and the removal
 * of the old ⌘⇧V / Mod-Enter "add version from main editor" bindings.
 *
 * The ⌘E shortcut is handled via window keydown in Annotations.svelte,
 * so we test the event bus contract: emitting "annotation-enter-editor"
 * should be picked up by the Revision card (Svelte component, not
 * testable here) to open the inline/modal editor.
 *
 * We also verify that Mod-Enter is no longer in the main annotationKeymap
 * (regression for the bug where creating a version from outside the
 * nested editor would leave the cursor in the wrong place and cause
 * the revision to irreversibly disappear on the next keystroke).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
    annotationKeymap,
    annotations as annotationExtensions,
} from "$lib/editor/plugins/annotations";
import { addAnnotation, annotationField } from "$lib/editor/plugins/annotations/annotationField";
import { createNewAnnotation, type VersionState } from "$lib/editor/plugins/annotations/models";
import { annotationEventBus } from "$lib/editor/plugins/annotations/eventBus";
import { makeParentUndoKeymap } from "$lib/editor/plugins/annotations/nestedEditor";

// ── Helpers ──────────────────────────────────────────────────

function createView(doc: string) {
    const state = EditorState.create({
        doc,
        extensions: [annotationExtensions()],
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return new EditorView({ state, parent });
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

function runKey(view: EditorView, key: string) {
    const handlers = annotationKeymap.filter((binding) => binding.key === key);
    for (const handler of handlers) {
        const consumed = handler.run?.(view);
        if (consumed) return true;
    }
    return false;
}

/**
 * Extract KeyBinding objects from a Prec-wrapped keymap extension.
 */
function extractBindings(
    ext: unknown,
): Array<{ key?: string; run?: (view: EditorView) => boolean }> {
    if (!ext || typeof ext !== "object") return [];
    if ("inner" in (ext as Record<string, unknown>)) {
        return extractBindings((ext as Record<string, unknown>).inner);
    }
    if (Array.isArray(ext)) {
        return ext.flatMap(extractBindings);
    }
    if ("key" in (ext as Record<string, unknown>) && "run" in (ext as Record<string, unknown>)) {
        return [ext as { key?: string; run?: (view: EditorView) => boolean }];
    }
    if ("value" in (ext as Record<string, unknown>)) {
        return extractBindings((ext as Record<string, unknown>).value);
    }
    return [];
}

let view: EditorView | undefined;
let nestedView: EditorView | undefined;
let unsubs: (() => void)[] = [];

afterEach(() => {
    for (const unsub of unsubs) unsub();
    unsubs = [];
    nestedView?.destroy();
    nestedView = undefined;
    view?.destroy();
    view = undefined;
});

// ── Mod-Enter removed from main keymap ──────────────────────

describe("Mod-Enter removed from main annotationKeymap", () => {
    it("does not have a Mod-Enter binding", () => {
        const modEnterBindings = annotationKeymap.filter((b) => b.key === "Mod-Enter");
        expect(modEnterBindings).toHaveLength(0);
    });

    it("Mod-Enter in main editor does not fire annotation-add-version", () => {
        const spy = vi.fn();
        unsubs.push(annotationEventBus.on("annotation-add-version", spy));
        view = createView("Alpha Beta Gamma");
        addRevision(view, 6, 10);

        // Place cursor inside the revision
        view.dispatch({ selection: { anchor: 8 } });
        const consumed = runKey(view, "Mod-Enter");

        expect(consumed).toBe(false);
        expect(spy).not.toHaveBeenCalled();
    });
});

// ── Mod-Enter still works in nested editor ──────────────────

describe("Mod-Enter in nested editor still creates version", () => {
    it("fires annotation-add-version from nested editor", () => {
        const spy = vi.fn();
        unsubs.push(annotationEventBus.on("annotation-add-version", spy));
        view = createView("Alpha Beta Gamma");
        const revisionId = addRevision(view, 6, 10);

        // Create a nested editor with the parent undo keymap
        const nestedState = EditorState.create({
            doc: "Beta",
            extensions: [annotationExtensions(), makeParentUndoKeymap(view, revisionId)],
        });
        const el = document.createElement("div");
        document.body.appendChild(el);
        nestedView = new EditorView({ state: nestedState, parent: el });

        // Extract and run Mod-Enter from the nested keymap
        const keymapExt = makeParentUndoKeymap(view, revisionId);
        const bindings = extractBindings(keymapExt);
        const modEnter = bindings.find((b) => b.key === "Mod-Enter");

        expect(modEnter).toBeDefined();
        const consumed = modEnter!.run!(nestedView);

        expect(consumed).toBe(true);
        expect(spy).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "annotation-add-version",
                annotationId: revisionId,
            }),
        );
    });
});

// ── annotation-enter-editor event bus contract ──────────────

describe("annotation-enter-editor event", () => {
    it("event bus delivers annotation-enter-editor to subscribers", () => {
        const spy = vi.fn();
        unsubs.push(annotationEventBus.on("annotation-enter-editor", spy));

        annotationEventBus.emit({
            type: "annotation-enter-editor",
            annotationId: 42,
        });

        expect(spy).toHaveBeenCalledOnce();
        expect(spy).toHaveBeenCalledWith({
            type: "annotation-enter-editor",
            annotationId: 42,
        });
    });

    it("unsubscribe prevents further delivery", () => {
        const spy = vi.fn();
        const unsub = annotationEventBus.on("annotation-enter-editor", spy);

        unsub();
        annotationEventBus.emit({
            type: "annotation-enter-editor",
            annotationId: 1,
        });

        expect(spy).not.toHaveBeenCalled();
    });
});
