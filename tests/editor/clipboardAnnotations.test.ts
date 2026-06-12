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
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
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

function createView(doc: string, extra: Extension[] = []) {
    const state = EditorState.create({
        doc,
        extensions: [
            history({ newGroupDelay: 0 }),
            // The production editor enables multi-range selections (extensions.ts);
            // the clipboard handlers mirror CM's multi-range copy/cut, so the test
            // harness must enable it too or dispatched multi-ranges collapse.
            EditorState.allowMultipleSelections.of(true),
            annotationExtensions(),
            ...extra,
        ],
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({ state, parent });
    views.push(view);
    return view;
}

/** A readOnly editor, mirroring the Version History snapshot preview. */
function createReadOnlyView(doc: string) {
    return createView(doc, [EditorState.readOnly.of(true)]);
}

function getComments(view: EditorView) {
    return Object.values(view.state.field(annotationField)).filter((a) =>
        isAnnotationOfType(a, "comment"),
    );
}

function getSuggestions(view: EditorView) {
    return Object.values(view.state.field(annotationField)).filter((a) =>
        isAnnotationOfType(a, "suggestion"),
    );
}

function getRevisions(view: EditorView) {
    return Object.values(view.state.field(annotationField)).filter((a) =>
        isAnnotationOfType(a, "revision"),
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

/** Adds a suggestion over [from, to] with the given replacements. */
function addSuggestionOver(
    view: EditorView,
    from: number,
    to: number,
    replacements: { text: string; rationale?: string }[],
    author?: string,
) {
    view.dispatch(
        view.state.update({
            effects: addAnnotation.of({
                ...createNewAnnotation(
                    view.state.field(annotationField),
                    EditorSelection.single(from, to),
                    "suggestion",
                ),
                replacements,
                author,
            }),
        }),
    );
}

/**
 * Adds a revision over [from, to] whose active version's doc is the text
 * currently under that range. `versions` are the alternative texts; the active
 * one is set to `activeVersionIndex`. We seed versions[active].doc with the
 * current doc slice so the annotation is consistent (mirrors how a real
 * revision's active version always matches the rendered range).
 */
function addRevisionOver(
    view: EditorView,
    from: number,
    to: number,
    altDocs: string[],
    activeVersionIndex = 0,
) {
    const activeDoc = view.state.sliceDoc(from, to);
    const versions = altDocs.map((doc, i) => ({
        doc: i === activeVersionIndex ? activeDoc : doc,
        label: `v${i}`,
    }));
    view.dispatch(
        view.state.update({
            effects: addAnnotation.of({
                ...createNewAnnotation(
                    view.state.field(annotationField),
                    EditorSelection.single(from, to),
                    "revision",
                ),
                activeVersionIndex,
                versions,
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
        const out = serializeAnnotationsForCopy(view.state, [{ from: 6, to: 21 }]); // "brave new world"
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
        const out = serializeAnnotationsForCopy(view.state, [{ from: 6, to: 21 }]);
        expect(out).toHaveLength(0);
    });

    it("excludes a pending comment (empty thread) so paste can't bypass the single-pending guard", () => {
        const view = createView("Hello brave new world");
        // Pending comment: created with no thread message.
        view.dispatch(
            view.state.update({
                effects: addAnnotation.of(
                    createNewAnnotation(
                        view.state.field(annotationField),
                        EditorSelection.single(6, 11),
                        "comment",
                    ),
                ),
            }),
        );
        const out = serializeAnnotationsForCopy(view.state, [{ from: 6, to: 21 }]);
        expect(out).toHaveLength(0);
    });

    it("serializes a fully-contained suggestion with its replacements", () => {
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
        const out = serializeAnnotationsForCopy(view.state, [{ from: 6, to: 21 }]); // "brave new world"
        expect(out).toEqual([
            {
                _type: "suggestion",
                relAnchor: 0,
                relHead: 5,
                thread: [],
                replacements: [{ text: "bold" }],
                author: undefined,
            },
        ]);
        expect(out[0]).not.toHaveProperty("id");
    });
});

describe("encodeHtml / decodeHtml", () => {
    it("round-trips annotation JSON through a data-quillium attribute", () => {
        const ann = [{ _type: "comment" as const, relAnchor: 0, relHead: 5, thread: [] }];
        const html = encodeHtml("brave", ann);
        expect(html).toContain("data-quillium=");
        expect(html).toContain("brave");
        expect(decodeHtml(html, "brave")).toEqual(ann);
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
        expect(decodeHtml(html, "ünï")).toEqual(ann);
    });

    it("escapes HTML-special characters in the copied text", () => {
        const html = encodeHtml('<b>"x"</b> & y', []);
        expect(html).not.toContain("<b>");
        expect(html).toContain("&lt;b&gt;");
        expect(html).toContain("&amp;");
    });

    it("returns null for html without the data attribute or with junk", () => {
        expect(decodeHtml("<div>plain</div>", "x")).toBeNull();
        expect(decodeHtml('<div data-quillium="not-base64!!!">x</div>', "x")).toBeNull();
    });

    it("rejects a payload whose bound text differs from the pasted text", () => {
        const ann = [{ _type: "comment" as const, relAnchor: 0, relHead: 5, thread: [] }];
        const html = encodeHtml("brave", ann);
        // Same valid envelope, but pasted text doesn't match what was copied —
        // guards against foreign clipboards carrying a data-quillium attribute.
        expect(decodeHtml(html, "different text")).toBeNull();
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

// ── Suggestion round trip ─────────────────────────────────────────────────────

describe("suggestion copy → paste round trip", () => {
    it("recreates a suggestion on pasted text with its replacements and author", () => {
        const view = createView("Hello brave new world");
        addSuggestionOver(view, 6, 11, [{ text: "bold", rationale: "stronger" }], "AI");

        const clip = copyRange(view, 6, 21); // copy "brave new world"
        expect(clip.getData("text/html")).toContain("data-quillium=");

        view.dispatch({ changes: { from: view.state.doc.length, insert: " " } });
        const at = view.state.doc.length;
        pasteAt(view, at, clip);

        const suggestions = getSuggestions(view);
        expect(suggestions).toHaveLength(2); // source + pasted
        const pasted = suggestions.find((s) => s.selection.main.from === at);
        expect(pasted).toBeDefined();
        expect(view.state.sliceDoc(pasted!.selection.main.from, pasted!.selection.main.to)).toBe(
            "brave",
        );
        expect(pasted!.replacements).toEqual([{ text: "bold", rationale: "stronger" }]);
        expect(pasted!.author).toBe("AI");
        // Fresh id distinct from the source.
        expect(pasted!.id).not.toBe(suggestions.find((s) => s.selection.main.from === 6)!.id);
    });

    it("restores a suggestion when pasting into a different document", () => {
        const source = createView("Hello brave new world");
        addSuggestionOver(source, 6, 11, [{ text: "courageous" }]);
        const clip = copyRange(source, 6, 21);

        const target = createView("Existing. ");
        const at = target.state.doc.length;
        pasteAt(target, at, clip);

        expect(target.state.doc.toString()).toBe("Existing. brave new world");
        const suggestions = getSuggestions(target);
        expect(suggestions).toHaveLength(1);
        expect(suggestions[0].replacements).toEqual([{ text: "courageous" }]);
        expect(
            target.state.sliceDoc(
                suggestions[0].selection.main.from,
                suggestions[0].selection.main.to,
            ),
        ).toBe("brave");
    });
});

// ── Revision round trip ───────────────────────────────────────────────────────

describe("revision copy → paste round trip", () => {
    it("recreates a revision with its versions and active index on pasted text", () => {
        const view = createView("Hello brave new world");
        // Active version (index 1) renders "brave"; the alternative is "bold".
        addRevisionOver(view, 6, 11, ["bold", "brave"], 1);

        const clip = copyRange(view, 6, 21); // copy "brave new world"
        expect(clip.getData("text/html")).toContain("data-quillium=");

        view.dispatch({ changes: { from: view.state.doc.length, insert: " " } });
        const at = view.state.doc.length;
        pasteAt(view, at, clip);

        const revisions = getRevisions(view);
        expect(revisions).toHaveLength(2); // source + pasted
        const pasted = revisions.find((r) => r.selection.main.from === at);
        expect(pasted).toBeDefined();
        // The pasted revision range renders the active version's text.
        expect(view.state.sliceDoc(pasted!.selection.main.from, pasted!.selection.main.to)).toBe(
            "brave",
        );
        expect(pasted!.activeVersionIndex).toBe(1);
        expect(pasted!.versions.map((v) => v.doc)).toEqual(["bold", "brave"]);
        // Version labels carried verbatim.
        expect(pasted!.versions.map((v) => v.label)).toEqual(["v0", "v1"]);
        // Fresh id distinct from the source.
        const srcId = revisions.find((r) => r.selection.main.from === 6)!.id;
        expect(pasted!.id).not.toBe(srcId);
    });

    it("restores a revision when pasting into a different document", () => {
        const source = createView("Hello brave new world");
        addRevisionOver(source, 6, 11, ["bold", "brave"], 1);
        const clip = copyRange(source, 6, 21);

        const target = createView("Existing. ");
        const at = target.state.doc.length;
        pasteAt(target, at, clip);

        expect(target.state.doc.toString()).toBe("Existing. brave new world");
        const revisions = getRevisions(target);
        expect(revisions).toHaveLength(1);
        expect(revisions[0].activeVersionIndex).toBe(1);
        expect(revisions[0].versions.map((v) => v.doc)).toEqual(["bold", "brave"]);
        expect(
            target.state.sliceDoc(revisions[0].selection.main.from, revisions[0].selection.main.to),
        ).toBe("brave");
    });

    it("clamps an out-of-range activeVersionIndex from a malformed payload", () => {
        // Build a clip whose payload claims activeVersionIndex 9 (only 1 version).
        const html = encodeHtml("brave", [
            {
                _type: "revision",
                relAnchor: 0,
                relHead: 5,
                thread: [],
                activeVersionIndex: 9,
                versions: [{ doc: "brave", label: "only" }],
            },
        ]);
        const clip = new MockDataTransfer();
        clip.setData("text/plain", "brave");
        clip.setData("text/html", html);

        const view = createView("Existing. ");
        const at = view.state.doc.length;
        pasteAt(view, at, clip);

        const revisions = getRevisions(view);
        expect(revisions).toHaveLength(1);
        // Clamped to the last valid index (0).
        expect(revisions[0].activeVersionIndex).toBe(0);
    });
});

// ── Mixed selection ───────────────────────────────────────────────────────────

describe("mixed annotation types in one copied region", () => {
    it("carries a comment, a suggestion, and a revision together", () => {
        const view = createView("alpha beta gamma delta");
        addComment(view, 0, 5, "on alpha"); // alpha
        addSuggestionOver(view, 6, 10, [{ text: "BETA" }]); // beta
        addRevisionOver(view, 11, 16, ["GAMMA", "gamma"], 1); // gamma

        const clip = copyRange(view, 0, 22); // whole doc
        view.dispatch({ changes: { from: 22, insert: "\n" } });
        const base = view.state.doc.length;
        pasteAt(view, base, clip);

        expect(getComments(view).filter((c) => c.selection.main.from >= base)).toHaveLength(1);
        expect(getSuggestions(view).filter((s) => s.selection.main.from >= base)).toHaveLength(1);
        expect(getRevisions(view).filter((r) => r.selection.main.from >= base)).toHaveLength(1);
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

    it("does not resurrect stale annotations for identical text copied clean afterwards", () => {
        const view = createView("brave new world. brave new world");
        // First copy: a region WITH a comment populates the side-table.
        addComment(view, 0, 5, "stale"); // "brave"
        copyRange(view, 0, 15); // "brave new world"

        // Second copy: the IDENTICAL text from a clean region with no annotations.
        // handleCopy returns early without refreshing/clearing the side-table.
        const event = makeEvent();
        view.dispatch({ selection: EditorSelection.range(17, 32) }); // "brave new world"
        expect(handleCopy(event, view)).toBe(false);

        // Paste that clean copy via a plaintext-only source (html stripped).
        const stripped = new MockDataTransfer();
        stripped.setData("text/plain", "brave new world");
        const at = view.state.doc.length;
        pasteAt(view, at, stripped);

        // No phantom comment from the stale side-table entry.
        expect(getComments(view).filter((c) => c.selection.main.from >= at)).toHaveLength(0);
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

    it("leaves no phantom zero-width revision behind after cutting a revision", () => {
        const view = createView("Hello brave new world");
        addRevisionOver(view, 6, 11, ["bold", "brave"], 1); // "brave"

        view.dispatch({ selection: EditorSelection.range(6, 21) });
        handleCut(makeEvent(), view);

        // The cut must not strand a collapsed revision at the cut site — without
        // explicit cleanup, mapRange keeps the zero-width revision range.
        expect(getRevisions(view)).toHaveLength(0);
        expect(view.state.doc.toString()).toBe("Hello ");
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

// ── readOnly guard ────────────────────────────────────────────────────────────

describe("readOnly editors are never mutated", () => {
    it("cut on a readOnly view defers to default and deletes nothing", () => {
        const view = createReadOnlyView("Hello brave new world");
        addComment(view, 6, 11, "cut me");
        view.dispatch({ selection: EditorSelection.range(6, 21) });
        const event = makeEvent();
        expect(handleCut(event, view)).toBe(false);
        expect(event.defaultPrevented).toBe(false);
        // Text and annotation untouched.
        expect(view.state.doc.toString()).toBe("Hello brave new world");
        expect(getComments(view)).toHaveLength(1);
    });

    it("paste on a readOnly view defers to default and inserts nothing", () => {
        const source = createView("Hello brave new world");
        addComment(source, 6, 11, "x");
        const clip = copyRange(source, 6, 21);

        const target = createReadOnlyView("read only ");
        const event = makeEvent(clip);
        target.dispatch({ selection: EditorSelection.cursor(target.state.doc.length) });
        expect(handlePaste(event, target)).toBe(false);
        expect(event.defaultPrevented).toBe(false);
        expect(target.state.doc.toString()).toBe("read only ");
        expect(getComments(target)).toHaveLength(0);
    });
});

// ── Multi-range selections ────────────────────────────────────────────────────

describe("multi-range copy → paste", () => {
    it("carries annotations from every selected range with correct joined offsets", () => {
        const view = createView("alpha beta gamma delta");
        addComment(view, 0, 5, "A"); // alpha
        addComment(view, 11, 16, "G"); // gamma

        // Two disjoint ranges: "alpha" and "gamma". Joined text is "alpha\ngamma".
        view.dispatch({
            selection: EditorSelection.create([
                EditorSelection.range(0, 5),
                EditorSelection.range(11, 16),
            ]),
        });
        const event = makeEvent();
        expect(handleCopy(event, view)).toBe(true);
        expect(event.clipboardData.getData("text/plain")).toBe("alpha\ngamma");

        // Paste at the end.
        view.dispatch({ changes: { from: view.state.doc.length, insert: "\n" } });
        const base = view.state.doc.length;
        pasteAt(view, base, event.clipboardData);

        const pasted = getComments(view)
            .filter((c) => c.selection.main.from >= base)
            .sort((a, b) => a.selection.main.from - b.selection.main.from);
        expect(pasted).toHaveLength(2);
        expect(
            pasted.map((c) => view.state.sliceDoc(c.selection.main.from, c.selection.main.to)),
        ).toEqual(["alpha", "gamma"]);
    });

    it("cut deletes every selected range, not just the main one", () => {
        const view = createView("alpha beta gamma delta");
        addComment(view, 0, 5, "A"); // alpha — gives the cut something to carry
        view.dispatch({
            selection: EditorSelection.create([
                EditorSelection.range(0, 5), // alpha
                EditorSelection.range(11, 16), // gamma
            ]),
        });
        expect(handleCut(makeEvent(), view)).toBe(true);
        // Both ranges removed: "alpha"→"" and "gamma"→"".
        expect(view.state.doc.toString()).toBe(" beta  delta");
    });
});

// ── CRLF / line-ending normalization ──────────────────────────────────────────

describe("CRLF clipboard round trip", () => {
    it("matches the side-table entry after a CRLF round trip of the plain text", () => {
        const view = createView("line one\nline two\nend");
        addComment(view, 0, 17, "spans newlines"); // "line one\nline two"
        copyRange(view, 0, 17); // populates side-table with LF text

        // Simulate Windows: the OS clipboard hands back CRLF plain text, html stripped.
        const stripped = new MockDataTransfer();
        stripped.setData("text/plain", "line one\r\nline two");

        view.dispatch({ changes: { from: view.state.doc.length, insert: "\n" } });
        const at = view.state.doc.length;
        pasteAt(view, at, stripped);

        const pasted = getComments(view).find((c) => c.selection.main.from >= at);
        expect(pasted).toBeDefined();
        // Inserted text was normalized to LF, so the doc has no stray \r.
        expect(view.state.doc.toString()).not.toContain("\r");
    });

    it("decodeHtml matches when the pasted text is the CRLF form of the copied text", () => {
        const ann = [{ _type: "comment" as const, relAnchor: 0, relHead: 8, thread: [] }];
        const html = encodeHtml("line one\nline two", ann);
        // Same content, CRLF on paste (Windows clipboard) — still matches.
        expect(decodeHtml(html, "line one\r\nline two")).toEqual(ann);
    });

    it("does not throw when restoring a CRLF payload (insertEnd stays in bounds)", () => {
        const html = encodeHtml("a\nb\nc", [
            { _type: "comment", relAnchor: 0, relHead: 5, thread: [] },
        ]);
        const clip = new MockDataTransfer();
        clip.setData("text/plain", "a\r\nb\r\nc"); // longer than the normalized form
        clip.setData("text/html", html);

        const view = createView("X");
        const at = view.state.doc.length;
        expect(() => pasteAt(view, at, clip)).not.toThrow();
        expect(view.state.doc.toString()).toBe("Xa\nb\nc");
    });
});

// ── Malformed payload hardening ───────────────────────────────────────────────

describe("malformed payload hardening", () => {
    it("rejects a fractional activeVersionIndex at the schema boundary", () => {
        const html = encodeHtml("brave", [
            {
                // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
                _type: "revision" as any,
                relAnchor: 0,
                relHead: 5,
                thread: [],
                activeVersionIndex: 0.5,
                versions: [
                    { doc: "brave", label: "a" },
                    { doc: "bold", label: "b" },
                ],
            },
        ]);
        // Schema rejects the non-integer index → decode returns null → plain paste.
        expect(decodeHtml(html, "brave")).toBeNull();
    });

    it("drops a zero-width comment payload instead of inserting an invisible annotation", () => {
        const html = encodeHtml("brave", [
            // relAnchor === relHead → collapsed range, which copy never produces.
            { _type: "comment", relAnchor: 2, relHead: 2, thread: [] },
        ]);
        const clip = new MockDataTransfer();
        clip.setData("text/plain", "brave");
        clip.setData("text/html", html);

        const view = createView("X");
        const at = view.state.doc.length;
        pasteAt(view, at, clip);
        // Text pasted, but no collapsed comment slipped into state.
        expect(view.state.doc.toString()).toBe("Xbrave");
        expect(getComments(view)).toHaveLength(0);
    });
});

// ── Foreign clipboard side-table guard ────────────────────────────────────────

describe("foreign clipboard does not resurrect annotations", () => {
    it("ignores the side-table when text/html is present but foreign (non-Quillium)", () => {
        const view = createView("brave new world here");
        addComment(view, 0, 5, "internal"); // "brave"
        copyRange(view, 0, 15); // side-table now holds "brave new world"

        // A foreign app's clipboard: identical text, but its own (non-quillium) html.
        const foreign = new MockDataTransfer();
        foreign.setData("text/plain", "brave new world");
        foreign.setData("text/html", "<p>brave new world</p>");

        const at = view.state.doc.length;
        pasteAt(view, at, foreign);
        // No phantom comment from the stale side-table entry.
        expect(getComments(view).filter((c) => c.selection.main.from >= at)).toHaveLength(0);
    });
});
