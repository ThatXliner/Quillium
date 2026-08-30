import {
    _shouldHandleRevisionFocusMouseEvent,
    annotations as annotationExtensions,
    annotationKeymap,
} from "$lib/editor/plugins/annotations";
import { addAnnotation, annotationField } from "$lib/editor/plugins/annotations/annotationField";
import {
    activeVersionIndex,
    createNewAnnotation,
    isAnnotationOfType,
    makeVersion,
} from "$lib/editor/plugins/annotations/models";
import { annotationEventBus } from "$lib/events/annotationEventBus";
import { appSettings } from "$lib/settings.svelte";
import { history } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createView(doc: string) {
    const state = EditorState.create({
        doc,
        extensions: [annotationExtensions()],
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return new EditorView({ state, parent });
}

function runKey(view: EditorView, key: string) {
    const handlers = annotationKeymap.filter((binding) => binding.key === key);
    for (const handler of handlers) {
        const consumed = handler.run?.(view);
        if (consumed) return true;
    }
    return false;
}

function addRevision(
    view: EditorView,
    from: number,
    to: number,
    versions?: { doc: string; label?: string }[],
) {
    const builtVersions = (
        versions ?? [{ doc: view.state.sliceDoc(from, to), label: "Original" }]
    ).map((v) => makeVersion(v));
    const revision = {
        ...createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(from, to),
            "revision",
        ),
        activeVersionId: builtVersions[0].id,
        versions: builtVersions,
    };

    view.dispatch(view.state.update({ effects: [addAnnotation.of(revision)] }));
    return revision.id;
}

function getRevision(view: EditorView, id: number) {
    const annotation = view.state.field(annotationField)[id];
    if (!annotation || !isAnnotationOfType(annotation, "revision")) {
        throw new Error(`Expected revision annotation ${id}`);
    }
    return annotation;
}

let view: EditorView | undefined;
let unsubs: (() => void)[] = [];

beforeEach(() => {
    appSettings.atomicRevisions = true;
    appSettings.showNestedEditor = false;
    appSettings.selectTextInNestedEditor = true;
    appSettings.autoVersionOnRevisionCreate = true;
});

afterEach(() => {
    for (const unsub of unsubs) unsub();
    unsubs = [];
    view?.destroy();
    view = undefined;
    annotationEventBus.clearPendingSelections();
});

describe("annotation keymap integration", () => {
    it("redirects Mod-Alt-k to nested editor when cursor is inside revision", () => {
        const spy = vi.fn();
        unsubs.push(annotationEventBus.on("revision-request-modal", spy));
        view = createView("Alpha Beta Gamma");
        const revisionId = addRevision(view, 6, 10);

        view.dispatch({ selection: { anchor: 8 } });
        const consumed = runKey(view, "Mod-Alt-k");

        expect(consumed).toBe(true);
        expect(spy).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "revision-request-modal",
                sourceView: view,
                command: {
                    revisionId,
                    type: "revision",
                    selectionFrom: 2,
                    selectionTo: 2,
                },
            }),
        );
    });

    it("redirects Mod-Alt-m to nested editor when cursor is inside revision", () => {
        const spy = vi.fn();
        unsubs.push(annotationEventBus.on("revision-request-modal", spy));
        view = createView("Alpha Beta Gamma");
        const revisionId = addRevision(view, 6, 10);

        view.dispatch({ selection: { anchor: 7 } });
        const consumed = runKey(view, "Mod-Alt-m");

        expect(consumed).toBe(true);
        expect(spy).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "revision-request-modal",
                sourceView: view,
                command: {
                    revisionId,
                    type: "comment",
                    selectionFrom: 1,
                    selectionTo: 1,
                },
            }),
        );
    });

    it("Backspace at revision start boundary fires nudge signal", () => {
        const spy = vi.fn();
        unsubs.push(annotationEventBus.on("revision-boundary-nudge", spy));
        view = createView("Alpha Beta Gamma");
        const revisionId = addRevision(view, 6, 10);

        view.dispatch({ selection: { anchor: 6 } });
        const consumed = runKey(view, "Backspace");

        expect(consumed).toBe(false);
        expect(spy).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "revision-boundary-nudge",
                revisionId,
            }),
        );
    });

    it("Delete at revision end boundary fires nudge signal", () => {
        const spy = vi.fn();
        unsubs.push(annotationEventBus.on("revision-boundary-nudge", spy));
        view = createView("Alpha Beta Gamma");
        const revisionId = addRevision(view, 6, 10);

        view.dispatch({ selection: { anchor: 10 } });
        const consumed = runKey(view, "Delete");

        expect(consumed).toBe(false);
        expect(spy).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "revision-boundary-nudge",
                revisionId,
            }),
        );
    });

    it("Backspace at revision end deletes adjacent revision range", () => {
        view = createView("Alpha Beta Gamma");
        addRevision(view, 6, 10);

        view.dispatch({ selection: { anchor: 10 } });
        const consumed = runKey(view, "Backspace");

        expect(consumed).toBe(true);
        expect(view.state.doc.toString()).toBe("Alpha  Gamma");
        expect(Object.values(view.state.field(annotationField))).toHaveLength(0);
    });

    it("insert at revision boundary triggers boundaryInsertNudge plugin", () => {
        const spy = vi.fn();
        unsubs.push(annotationEventBus.on("revision-boundary-nudge", spy));
        view = createView("Alpha Beta Gamma");
        const revisionId = addRevision(view, 6, 10);

        view.dispatch({ changes: { from: 6, insert: "X" } });

        expect(spy).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "revision-boundary-nudge",
                revisionId,
            }),
        );
    });

    it("Mod-Alt-k creates revision when not inside any revision", () => {
        view = createView("Alpha Beta Gamma");

        view.dispatch({ selection: { anchor: 0, head: 5 } });
        const consumed = runKey(view, "Mod-Alt-k");

        expect(consumed).toBe(true);
        const annotations = Object.values(view.state.field(annotationField));
        expect(annotations).toHaveLength(1);
        expect(isAnnotationOfType(annotations[0], "revision")).toBe(true);
    });

    it("Mod-Alt-k requests a caret even when automatic selection is disabled", () => {
        appSettings.selectTextInNestedEditor = false;
        view = createView("Alpha Beta Gamma");

        view.dispatch({ selection: { anchor: 0, head: 5 } });
        const consumed = runKey(view, "Mod-Alt-k");
        const revision = Object.values(view.state.field(annotationField)).find((annotation) =>
            isAnnotationOfType(annotation, "revision"),
        );

        expect(consumed).toBe(true);
        expect(revision).toBeDefined();
        expect(annotationEventBus.consumePendingSelection(revision!.id)).toEqual({
            type: "pending-nested-editor-selection",
            annotationId: revision!.id,
            from: 0,
            to: 0,
            focus: true,
        });
    });

    it("Mod-Alt-m creates comment when not inside any revision", () => {
        view = createView("Alpha Beta Gamma");

        view.dispatch({ selection: { anchor: 0, head: 5 } });
        const consumed = runKey(view, "Mod-Alt-m");

        expect(consumed).toBe(true);
        const annotations = Object.values(view.state.field(annotationField));
        expect(annotations).toHaveLength(1);
        expect(isAnnotationOfType(annotations[0], "comment")).toBe(true);
    });

    it("keeps Mod-Shift-m as an alternate comment shortcut", () => {
        view = createView("Alpha Beta Gamma");

        view.dispatch({ selection: { anchor: 0, head: 5 } });
        const consumed = runKey(view, "Mod-Shift-m");

        expect(consumed).toBe(true);
        const annotations = Object.values(view.state.field(annotationField));
        expect(annotations).toHaveLength(1);
        expect(isAnnotationOfType(annotations[0], "comment")).toBe(true);
    });

    it("falls back to physical KeyM when macOS Option changes the event key", () => {
        view = createView("Alpha Beta Gamma");
        view.dispatch({ selection: { anchor: 0, head: 5 } });

        const event = new KeyboardEvent("keydown", {
            key: "µ",
            code: "KeyM",
            metaKey: true,
            altKey: true,
            bubbles: true,
            cancelable: true,
        });
        view.contentDOM.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        const annotations = Object.values(view.state.field(annotationField));
        expect(annotations).toHaveLength(1);
        expect(isAnnotationOfType(annotations[0], "comment")).toBe(true);
    });

    it("Delete at revision start deletes adjacent revision range", () => {
        view = createView("Alpha Beta Gamma");
        addRevision(view, 6, 10);

        view.dispatch({ selection: { anchor: 6 } });
        const consumed = runKey(view, "Delete");

        expect(consumed).toBe(true);
        expect(view.state.doc.toString()).toBe("Alpha  Gamma");
        expect(Object.values(view.state.field(annotationField))).toHaveLength(0);
    });
});

describe("revision mouse focus guard", () => {
    it("only treats plain primary-button mouse events as focus requests", () => {
        expect(_shouldHandleRevisionFocusMouseEvent(new MouseEvent("mousedown"))).toBe(true);
        expect(
            _shouldHandleRevisionFocusMouseEvent(new MouseEvent("mousedown", { button: 2 })),
        ).toBe(false);
        expect(
            _shouldHandleRevisionFocusMouseEvent(new MouseEvent("mousedown", { altKey: true })),
        ).toBe(false);
        const prevented = new MouseEvent("mousedown", { cancelable: true });
        prevented.preventDefault();
        expect(_shouldHandleRevisionFocusMouseEvent(prevented)).toBe(false);
    });
});

describe("Ctrl-[ / Ctrl-] version navigation in main editor", () => {
    function createViewWithHistory(doc: string) {
        const state = EditorState.create({
            doc,
            extensions: [history({ newGroupDelay: 0 }), annotationExtensions()],
        });
        const parent = document.createElement("div");
        document.body.appendChild(parent);
        return new EditorView({ state, parent });
    }

    it("Ctrl-] advances to the next version", () => {
        view = createViewWithHistory("hello world");
        const revId = addRevision(view, 0, 5, [
            { doc: "hello", label: "v1" },
            { doc: "hi", label: "v2" },
        ]);

        // Place cursor inside the revision
        view.dispatch({ selection: { anchor: 2 } });
        const consumed = runKey(view, "Ctrl-]");

        expect(consumed).toBe(true);
        const rev = getRevision(view, revId);
        expect(activeVersionIndex(rev)).toBe(1);
    });

    it("Ctrl-[ goes back to the previous version", () => {
        view = createViewWithHistory("hello world");
        const revId = addRevision(view, 0, 5, [
            { doc: "hello", label: "v1" },
            { doc: "hi", label: "v2" },
        ]);

        view.dispatch({ selection: { anchor: 2 } });
        // Advance to v2 first
        runKey(view, "Ctrl-]");
        expect(activeVersionIndex(getRevision(view, revId))).toBe(1);

        // Then go back
        const consumed = runKey(view, "Ctrl-[");
        expect(consumed).toBe(true);
        expect(activeVersionIndex(getRevision(view, revId))).toBe(0);
    });

    it("Ctrl-] wraps around from last version to first", () => {
        view = createViewWithHistory("hello world");
        const revId = addRevision(view, 0, 5, [
            { doc: "hello", label: "v1" },
            { doc: "hi", label: "v2" },
        ]);

        view.dispatch({ selection: { anchor: 2 } });
        runKey(view, "Ctrl-]"); // → v2
        runKey(view, "Ctrl-]"); // → wraps back to v1

        expect(activeVersionIndex(getRevision(view, revId))).toBe(0);
    });

    it("Ctrl-] fires boundary nudge when cursor is outside any revision", () => {
        const spy = vi.fn();
        unsubs.push(annotationEventBus.on("revision-boundary-nudge", spy));
        view = createViewWithHistory("hello world");
        addRevision(view, 0, 5, [{ doc: "hello" }, { doc: "hi" }]);

        // Cursor outside the revision range
        view.dispatch({ selection: { anchor: 8 } });
        const consumed = runKey(view, "Ctrl-]");

        expect(consumed).toBe(true);
        expect(spy).toHaveBeenCalledWith(
            expect.objectContaining({ type: "revision-boundary-nudge" }),
        );
    });

    it("Ctrl-] returns false when there are no revisions", () => {
        view = createViewWithHistory("hello world");
        view.dispatch({ selection: { anchor: 3 } });
        const consumed = runKey(view, "Ctrl-]");
        expect(consumed).toBe(false);
    });
});
