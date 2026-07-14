/**
 * revisionEmptyMarker.test.ts — Rendering and interaction coverage for collapsed revisions.
 */

import {
    _getAnnotationDecorations,
    _getEmptyRevisionMarkers,
    _handleEmptyRevisionMarkerMouseDown,
    annotations as annotationExtensions,
} from "$lib/editor/plugins/annotations";
import {
    addAnnotation,
    annotationField,
    setActiveRevisionVersion,
} from "$lib/editor/plugins/annotations/annotationField";
import { createNewAnnotation, makeVersion } from "$lib/editor/plugins/annotations/models";
import { annotationEventBus } from "$lib/events/annotationEventBus";
import { EditorSelection, EditorState } from "@codemirror/state";
import { type DecorationSet, EditorView, type WidgetType } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

function createView(doc = "Alpha Beta Gamma"): EditorView {
    const state = EditorState.create({
        doc,
        extensions: [annotationExtensions()],
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return new EditorView({ state, parent });
}

function addRevision(
    view: EditorView,
    from: number,
    to: number,
    versionDocs: string[],
    activeVersionIndex = 0,
): { id: number; versionIds: string[] } {
    const versions = versionDocs.map((doc) => makeVersion({ doc }));
    const annotation = {
        ...createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(from, to),
            "revision",
        ),
        activeVersionId: versions[activeVersionIndex].id,
        versions,
    };
    view.dispatch({ effects: addAnnotation.of(annotation) });
    return { id: annotation.id, versionIds: versions.map((version) => version.id) };
}

function decorationRanges(set: DecorationSet): Array<{ from: number; to: number }> {
    const ranges: Array<{ from: number; to: number }> = [];
    const cursor = set.iter();
    while (cursor.value) {
        ranges.push({ from: cursor.from, to: cursor.to });
        cursor.next();
    }
    return ranges;
}

function markerElements(view: EditorView): HTMLElement[] {
    const elements: HTMLElement[] = [];
    const cursor = _getEmptyRevisionMarkers(view.state).iter();
    while (cursor.value) {
        const widget = cursor.value.spec.widget as WidgetType | undefined;
        if (widget) elements.push(widget.toDOM(view));
        cursor.next();
    }
    return elements;
}

let view: EditorView | undefined;

afterEach(() => {
    view?.destroy();
    view = undefined;
    document.body.replaceChildren();
});

describe("empty revision marker", () => {
    it("builds exactly one marker for a collapsed revision without changing document text", () => {
        view = createView();
        const before = view.state.doc.toString();
        const { id } = addRevision(view, 6, 6, [""]);

        const markers = markerElements(view);
        expect(markers).toHaveLength(1);
        expect(markers[0].classList.contains("cm-revision-empty-marker")).toBe(true);
        expect(markers[0].dataset.revisionId).toBe(String(id));
        expect(view.state.doc.toString()).toBe(before);
    });

    it("keeps non-empty revisions as marks without an empty marker", () => {
        view = createView();
        addRevision(view, 6, 10, ["Beta"]);

        expect(
            decorationRanges(_getAnnotationDecorations(view.state, "revision", "cm-revision")),
        ).toEqual([{ from: 6, to: 10 }]);
        expect(markerElements(view)).toHaveLength(0);
    });

    it("applies active styling when the cursor moves to the marker position", () => {
        view = createView();
        addRevision(view, 6, 6, [""]);
        view.dispatch({ selection: EditorSelection.cursor(0) });
        expect(markerElements(view)[0].classList.contains("cm-revision-empty-marker-active")).toBe(
            false,
        );

        view.dispatch({ selection: EditorSelection.cursor(6) });

        expect(markerElements(view)[0].classList.contains("cm-revision-empty-marker-active")).toBe(
            true,
        );
    });

    it("focuses the collapsed revision and emits a zero-relative focus request", () => {
        view = createView();
        const { id } = addRevision(view, 6, 6, [""]);
        view.dispatch({ selection: EditorSelection.cursor(0) });
        const listener = vi.fn();
        const unsubscribe = annotationEventBus.on("revision-focus-request", listener);

        const handled = _handleEmptyRevisionMarkerMouseDown(markerElements(view)[0], view);
        unsubscribe();

        expect(handled).toBe(true);
        expect(view.state.selection.main.head).toBe(6);
        expect(listener).toHaveBeenCalledOnce();
        expect(listener).toHaveBeenCalledWith({
            type: "revision-focus-request",
            revisionId: id,
            relativePos: 0,
            sourceView: view,
        });
    });

    it("replaces the marker with the existing revision mark after a version switch", () => {
        view = createView();
        const { id, versionIds } = addRevision(view, 6, 6, ["", "Beta"]);
        expect(markerElements(view)).toHaveLength(1);

        view.dispatch(setActiveRevisionVersion(view.state, id, versionIds[1]));

        expect(markerElements(view)).toHaveLength(0);
        expect(
            decorationRanges(_getAnnotationDecorations(view.state, "revision", "cm-revision")),
        ).toEqual([{ from: 6, to: 10 }]);
        expect(view.state.sliceDoc(6, 10)).toBe("Beta");
    });
});
