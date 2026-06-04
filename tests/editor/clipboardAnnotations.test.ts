/**
 * clipboardAnnotations.test.ts — Preserve comments across cut/copy → paste (#241)
 *
 * Covers the round trip: copy a region with comments → paste elsewhere
 * recreates them at the right offsets. jsdom provides neither ClipboardEvent
 * nor DataTransfer, so we drive the exported handler functions (handleCopy /
 * handleCut / handlePaste) with a minimal clipboard mock that mirrors the real
 * DataTransfer contract (getData returns "" for unset keys).
 */

import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import { addAnnotation, annotationField } from "$lib/editor/plugins/annotations/annotationField";
import {
    _clearClipboardSideTable,
    decodeHtml,
    encodeHtml,
    handleCopy,
    handleCut,
    handlePaste,
    serializeAnnotationsForCopy,
} from "$lib/editor/plugins/annotations/clipboardAnnotations";
import { createNewAnnotation, isAnnotationOfType } from "$lib/editor/plugins/annotations/models";
import { history } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ── Clipboard mock ───────────────────────────────────────────────────────────
// Mirrors the bits of DataTransfer the handlers use. getData returns "" for an
// unset type, matching the real API.
class MockDataTransfer {
    private store = new Map<string, string>();
    setData(type: string, value: string) {
        this.store.set(type, value);
    }
    getData(type: string): string {
        return this.store.get(type) ?? "";
    }
}

class MockClipboardEvent {
    clipboardData: MockDataTransfer;
    defaultPrevented = false;
    constructor(clipboardData = new MockDataTransfer()) {
        this.clipboardData = clipboardData;
    }
    preventDefault() {
        this.defaultPrevented = true;
    }
}

function makeEvent(data?: MockDataTransfer) {
    // Cast through unknown — the handlers only touch clipboardData/preventDefault.
    return new MockClipboardEvent(data) as unknown as ClipboardEvent & {
        defaultPrevented: boolean;
        clipboardData: MockDataTransfer;
    };
}

// ── Editor harness ───────────────────────────────────────────────────────────

let views: EditorView[] = [];

function createView(doc: string) {
    const state = EditorState.create({
        doc,
        extensions: [history({ newGroupDelay: 0 }), annotationExtensions()],
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({ state, parent });
    views.push(view);
    return view;
}

function getComments(view: EditorView) {
    return Object.values(view.state.field(annotationField)).filter((a) =>
        isAnnotationOfType(a, "comment"),
    );
}

/** Adds a comment over [from, to] with a one-message thread. */
function addComment(view: EditorView, from: number, to: number, message = "note") {
    view.dispatch(
        view.state.update({
            effects: addAnnotation.of({
                ...createNewAnnotation(
                    view.state.field(annotationField),
                    EditorSelection.single(from, to),
                    "comment",
                ),
                thread: [{ message, author: "Tester", time: 0 }],
            }),
        }),
    );
}

/** Selects [from, to], runs copy, returns the populated clipboard. */
function copyRange(view: EditorView, from: number, to: number) {
    view.dispatch({ selection: EditorSelection.range(from, to) });
    const event = makeEvent();
    handleCopy(event, view);
    return event.clipboardData;
}

/** Places the cursor at `at`, runs paste from `clip`. */
function pasteAt(view: EditorView, at: number, clip: MockDataTransfer) {
    view.dispatch({ selection: EditorSelection.cursor(at) });
    handlePaste(makeEvent(clip), view);
}

beforeEach(() => {
    _clearClipboardSideTable();
});

afterEach(() => {
    for (const v of views) v.destroy();
    views = [];
});

// ── Serialization unit tests ─────────────────────────────────────────────────

describe("serializeAnnotationsForCopy", () => {
    it("rebases fully-contained comments and strips ids", () => {
        const view = createView("Hello brave new world");
        addComment(view, 6, 11, "on brave"); // "brave"
        const out = serializeAnnotationsForCopy(view.state, 6, 21); // "brave new world"
        expect(out).toEqual([
            { _type: "comment", relAnchor: 0, relHead: 5, thread: [expect.any(Object)] },
        ]);
        // No id leaked into the serialized shape.
        expect(out[0]).not.toHaveProperty("id");
    });

    it("excludes comments only partially overlapping the copied range", () => {
        const view = createView("Hello brave new world");
        addComment(view, 0, 11, "spans the boundary"); // "Hello brave"
        // Copy "brave new world" — the comment starts before `from`, so excluded.
        const out = serializeAnnotationsForCopy(view.state, 6, 21);
        expect(out).toHaveLength(0);
    });

    it("ignores non-comment annotations", () => {
        const view = createView("Hello brave new world");
        view.dispatch(
            view.state.update({
                effects: addAnnotation.of({
                    ...createNewAnnotation(
                        view.state.field(annotationField),
                        EditorSelection.single(6, 11),
                        "suggestion",
                    ),
                    replacements: [{ text: "bold" }],
                }),
            }),
        );
        expect(serializeAnnotationsForCopy(view.state, 0, 21)).toHaveLength(0);
    });
});

describe("encodeHtml / decodeHtml", () => {
    it("round-trips annotation JSON through a data-quillium attribute", () => {
        const ann = [{ _type: "comment" as const, relAnchor: 0, relHead: 5, thread: [] }];
        const html = encodeHtml("brave", ann);
        expect(html).toContain("data-quillium=");
        expect(html).toContain("brave");
        expect(decodeHtml(html)).toEqual(ann);
    });

    it("survives non-ASCII text and thread content", () => {
        const ann = [
            {
                _type: "comment" as const,
                relAnchor: 0,
                relHead: 3,
                thread: [{ message: "café — naïve 日本語", author: "Über", time: 1 }],
            },
        ];
        const html = encodeHtml("ünï", ann);
        expect(decodeHtml(html)).toEqual(ann);
    });

    it("escapes HTML-special characters in the copied text", () => {
        const html = encodeHtml('<b>"x"</b> & y', []);
        expect(html).not.toContain("<b>");
        expect(html).toContain("&lt;b&gt;");
        expect(html).toContain("&amp;");
    });

    it("returns null for html without the data attribute or with junk", () => {
        expect(decodeHtml("<div>plain</div>")).toBeNull();
        expect(decodeHtml('<div data-quillium="not-base64!!!">x</div>')).toBeNull();
    });
});

// ── Round-trip integration tests ─────────────────────────────────────────────

describe("copy → paste round trip", () => {
    it("recreates a comment on pasted text at the correct offset (text/html path)", () => {
        const view = createView("Hello brave new world");
        addComment(view, 6, 11, "on brave"); // "brave"

        const clip = copyRange(view, 6, 21); // copy "brave new world"
        expect(clip.getData("text/html")).toContain("data-quillium=");

        // Paste at the end of the doc (append a space first for clarity).
        view.dispatch({
            changes: { from: view.state.doc.length, insert: " " },
        });
        const pasteAtPos = view.state.doc.length;
        pasteAt(view, pasteAtPos, clip);

        // Original + new comment now exist.
        const comments = getComments(view);
        expect(comments).toHaveLength(2);

        // The pasted text landed.
        expect(view.state.doc.toString()).toBe("Hello brave new world brave new world");
        // The new comment covers the pasted "brave".
        const pasted = comments.find((c) => c.selection.main.from === pasteAtPos);
        expect(pasted).toBeDefined();
        expect(view.state.sliceDoc(pasted!.selection.main.from, pasted!.selection.main.to)).toBe(
            "brave",
        );
        // Thread carried verbatim.
        expect(pasted!.thread[0]).toMatchObject({ message: "on brave", author: "Tester" });
    });

    it("assigns a fresh id distinct from the source comment", () => {
        const view = createView("brave new world");
        addComment(view, 0, 5, "src");
        const srcId = getComments(view)[0].id;

        const clip = copyRange(view, 0, 15);
        view.dispatch({ changes: { from: 15, insert: " " } });
        pasteAt(view, 16, clip);

        const ids = getComments(view).map((c) => c.id);
        expect(new Set(ids).size).toBe(2); // no collision
        expect(ids).toContain(srcId);
    });

    it("preserves multiple comments in one copied region with correct relative offsets", () => {
        const view = createView("alpha beta gamma delta");
        addComment(view, 0, 5, "A"); // alpha
        addComment(view, 11, 16, "G"); // gamma

        const clip = copyRange(view, 0, 22); // whole doc
        view.dispatch({ changes: { from: 22, insert: "\n" } });
        const base = view.state.doc.length;
        pasteAt(view, base, clip);

        const pasted = getComments(view).filter((c) => c.selection.main.from >= base);
        expect(pasted).toHaveLength(2);
        const texts = pasted
            .sort((a, b) => a.selection.main.from - b.selection.main.from)
            .map((c) => view.state.sliceDoc(c.selection.main.from, c.selection.main.to));
        expect(texts).toEqual(["alpha", "gamma"]);
    });

    it("restores comments when pasting into a different document", () => {
        const source = createView("Hello brave new world");
        addComment(source, 6, 11, "cross-doc");
        const clip = copyRange(source, 6, 21);

        const target = createView("Existing. ");
        const at = target.state.doc.length;
        pasteAt(target, at, clip);

        expect(target.state.doc.toString()).toBe("Existing. brave new world");
        const comments = getComments(target);
        expect(comments).toHaveLength(1);
        expect(
            target.state.sliceDoc(comments[0].selection.main.from, comments[0].selection.main.to),
        ).toBe("brave");
        expect(comments[0].thread[0].message).toBe("cross-doc");
    });
});

// ── Side-table fallback ──────────────────────────────────────────────────────

describe("side-table fallback (text/html stripped)", () => {
    it("restores comments via the side-table when text/html is missing", () => {
        const view = createView("Hello brave new world");
        addComment(view, 6, 11, "fallback");

        // Copy populates the side-table as a side effect.
        copyRange(view, 6, 21);

        // Simulate a plaintext-only paste source: only text/plain present.
        const stripped = new MockDataTransfer();
        stripped.setData("text/plain", "brave new world");

        view.dispatch({ changes: { from: view.state.doc.length, insert: " " } });
        const at = view.state.doc.length;
        pasteAt(view, at, stripped);

        const pasted = getComments(view).find((c) => c.selection.main.from === at);
        expect(pasted).toBeDefined();
        expect(view.state.sliceDoc(pasted!.selection.main.from, pasted!.selection.main.to)).toBe(
            "brave",
        );
    });

    it("falls back to a plain paste (no comments) when neither source has metadata", () => {
        const view = createView("doc ");
        const plain = new MockDataTransfer();
        plain.setData("text/plain", "pasted");
        // handlePaste returns false (defers to CM default) when no annotations.
        const event = makeEvent(plain);
        view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
        const handled = handlePaste(event, view);
        expect(handled).toBe(false);
        expect(event.defaultPrevented).toBe(false);
        expect(getComments(view)).toHaveLength(0);
    });
});

// ── Cut ──────────────────────────────────────────────────────────────────────

describe("cut → paste", () => {
    it("removes the source comment and text, then paste restores it", () => {
        const view = createView("Hello brave new world");
        addComment(view, 6, 11, "cut me"); // "brave"

        // Cut "brave new world".
        view.dispatch({ selection: EditorSelection.range(6, 21) });
        const event = makeEvent();
        handleCut(event, view);

        expect(event.defaultPrevented).toBe(true);
        // Source text and its comment are gone.
        expect(view.state.doc.toString()).toBe("Hello ");
        expect(getComments(view)).toHaveLength(0);

        // Paste at the end recreates the comment.
        const at = view.state.doc.length;
        pasteAt(view, at, event.clipboardData);

        expect(view.state.doc.toString()).toBe("Hello brave new world");
        const comments = getComments(view);
        expect(comments).toHaveLength(1);
        expect(
            view.state.sliceDoc(comments[0].selection.main.from, comments[0].selection.main.to),
        ).toBe("brave");
    });
});

// ── Deferral (no comments) ───────────────────────────────────────────────────

describe("deferral to CodeMirror default", () => {
    it("copy returns false (no preventDefault) when the selection has no comments", () => {
        const view = createView("plain text only");
        view.dispatch({ selection: EditorSelection.range(0, 5) });
        const event = makeEvent();
        expect(handleCopy(event, view)).toBe(false);
        expect(event.defaultPrevented).toBe(false);
    });

    it("copy/cut defer when nothing is selected", () => {
        const view = createView("plain text only");
        view.dispatch({ selection: EditorSelection.cursor(3) });
        expect(handleCopy(makeEvent(), view)).toBe(false);
        expect(handleCut(makeEvent(), view)).toBe(false);
    });
});
