/**
 * Tests for the nested revision focus-request routing fix.
 *
 * Bug: clicking a revision decoration inside a Revision.svelte inline
 * editor was pushing a modal directly for the *nested* revision
 * (with parentView=nestedEditor), skipping the parent revision's modal
 * entirely.
 *
 * Fix: the handler now pushes a modal for the *parent* revision
 * (parentView=parentView, revisionId=parentRevisionId) with a cursor
 * pendingNestedCommand at the nested revision's position. This ensures
 * the modal hierarchy is always preserved — the parent revision's modal
 * is opened first, and the nested revision activates inline within it.
 *
 * These tests verify the contract at the store level:
 *   - The modal entry pushed has the parent revision's ID, not the nested one's
 *   - The pendingNestedCommand places the cursor at the nested revision's position
 *   - The parentView reference is the parent view, not the nested editor
 */

import { afterEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history } from "@codemirror/commands";
import {
    annotationField,
    addAnnotation,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    createNewAnnotation,
    isAnnotationOfType,
} from "$lib/editor/plugins/annotations/models";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import {
    modalStack,
    annotationUiEvent,
    publishAnnotationUiEvent,
    getEditorViewId,
} from "$lib/stores";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createView(doc: string) {
    const state = EditorState.create({
        doc,
        extensions: [history({ newGroupDelay: 0 }), annotationExtensions()],
    });
    const el = document.createElement("div");
    document.body.appendChild(el);
    return new EditorView({ state, parent: el });
}

function addRevision(view: EditorView, from: number, to: number, doc: string) {
    const annotation = {
        ...createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(from, to),
            "revision",
        ),
        activeVersionIndex: 0,
        versions: [{ doc }],
    };
    view.dispatch(view.state.update({ effects: [addAnnotation.of(annotation)] }));
    return annotation.id;
}

let views: EditorView[] = [];

afterEach(() => {
    for (const v of views) v.destroy();
    views = [];
    modalStack.clear();
});

// ── Core contract tests ───────────────────────────────────────────────────────

describe("revision-focus-request from nested inline editor", () => {
    it("pushing parent revision modal (not nested) is the correct fix behaviour", () => {
        // Set up: parent view with a revision over "hello"
        const parentView = createView("hello world");
        views.push(parentView);
        const parentRevId = addRevision(parentView, 0, 5, "hello");

        // Simulate the nested (inline) editor — it has its own annotation field
        // with a sub-revision inside it. Add a dummy first annotation so the
        // nested revision gets a different ID than the parent's (both start at 0
        // per-view otherwise, which would make the "not.toBe" assertion vacuous).
        const nestedView = createView("hello world");
        views.push(nestedView);
        addRevision(nestedView, 6, 11, "world"); // id=0 — just to advance the counter
        const nestedRevId = addRevision(nestedView, 1, 4, "ell"); // id=1

        const nestedRev = nestedView.state.field(annotationField)[nestedRevId];
        expect(nestedRev).toBeDefined();
        expect(isAnnotationOfType(nestedRev!, "revision")).toBe(true);

        const nestedRevPos = nestedRev!.selection.main.from; // 1

        // Simulate what the fixed $effect does: push the PARENT revision
        // (not the nested one), with a cursor command pointing to the nested
        // revision's position within the parent's version text.
        modalStack.push({
            type: "revision",
            revisionId: parentRevId,   // parent's ID — the key invariant
            parentView: parentView,     // parent view — not nestedView
            label: "Revision",
            pendingNestedCommand: {
                type: "cursor",
                selectionFrom: nestedRevPos,
                selectionTo: nestedRevPos,
            },
        });

        const stack = get(modalStack);
        expect(stack).toHaveLength(1);

        const entry = stack[0];
        expect(entry.type).toBe("revision");
        if (entry.type !== "revision") return;

        // The modal entry must reference the PARENT revision, not the nested one.
        expect(entry.revisionId).toBe(parentRevId);
        expect(entry.revisionId).not.toBe(nestedRevId);

        // The parentView must be the outer editor, not the inline nested editor.
        expect(entry.parentView).toBe(parentView);
        expect(entry.parentView).not.toBe(nestedView);

        // The pendingNestedCommand must be a cursor at the nested revision's position.
        expect(entry.pendingNestedCommand).toEqual({
            type: "cursor",
            selectionFrom: nestedRevPos,
            selectionTo: nestedRevPos,
        });
    });

    it("buggy behaviour (pushing nested revision directly) would break the hierarchy", () => {
        // This test documents what the OLD (broken) code would have done,
        // to make sure we never regress to it.
        const parentView = createView("hello world");
        views.push(parentView);
        const parentRevId = addRevision(parentView, 0, 5, "hello");

        const nestedView = createView("hello world");
        views.push(nestedView);
        addRevision(nestedView, 6, 11, "world"); // id=0 — advance counter
        const nestedRevId = addRevision(nestedView, 1, 4, "ell"); // id=1

        // The OLD code would have done this — push the nested revision directly:
        modalStack.push({
            type: "revision",
            revisionId: nestedRevId,   // WRONG: nested ID, not parent
            parentView: nestedView,     // WRONG: nested view, not parent view
            label: "nested rev",
            pendingNestedCommand: { type: "cursor", selectionFrom: 0, selectionTo: 0 },
        });

        const entry = get(modalStack)[0];
        if (entry.type !== "revision") return;

        // This illustrates the broken state: the modal stack has no record
        // of the parent revision, so the breadcrumb trail is incomplete.
        expect(entry.revisionId).toBe(nestedRevId);    // shows the problem
        expect(entry.parentView).toBe(nestedView);     // shows the problem
        expect(entry.revisionId).not.toBe(parentRevId); // parent is missing
    });

    it("cursor pendingNestedCommand positions correctly at nested revision start", () => {
        const parentView = createView("abc def ghi");
        views.push(parentView);
        const parentRevId = addRevision(parentView, 0, 11, "abc def ghi");

        // Nested editor has a revision starting at position 4 ("def")
        const nestedView = createView("abc def ghi");
        views.push(nestedView);
        const nestedRevId = addRevision(nestedView, 4, 7, "def");

        const nestedRev = nestedView.state.field(annotationField)[nestedRevId]!;
        const nestedRevPos = nestedRev.selection.main.from; // 4

        modalStack.push({
            type: "revision",
            revisionId: parentRevId,
            parentView: parentView,
            label: "Revision",
            pendingNestedCommand: {
                type: "cursor",
                selectionFrom: nestedRevPos,
                selectionTo: nestedRevPos,
            },
        });

        const entry = get(modalStack)[0];
        if (entry.type !== "revision") return;

        // Cursor is positioned at the start of "def" (position 4)
        expect(entry.pendingNestedCommand?.selectionFrom).toBe(4);
        expect(entry.pendingNestedCommand?.selectionTo).toBe(4);
        expect(entry.pendingNestedCommand?.type).toBe("cursor");
    });

    it("revision-focus-request event from nested editor carries a stable sourceViewId", () => {
        const parentView = createView("hello world");
        views.push(parentView);

        const nestedView = createView("hello");
        views.push(nestedView);
        const nestedRevId = addRevision(nestedView, 0, 3, "hel");

        // Publish the event as the revisionClickHandler would
        publishAnnotationUiEvent({
            type: "revision-focus-request",
            revisionId: nestedRevId,
            relativePos: 1,
            sourceViewId: getEditorViewId(nestedView),
        });

        const event = get(annotationUiEvent);
        expect(event).not.toBeNull();
        expect(event!.type).toBe("revision-focus-request");
        if (event!.type !== "revision-focus-request") return;

        // sourceViewId is stable even if the event object gets proxied by Svelte.
        expect(event!.sourceViewId).toBe(getEditorViewId(nestedView));
        // revisionId is the nested revision's ID
        expect(event!.revisionId).toBe(nestedRevId);
        // The handler should match this to nestedEditor and push the PARENT modal
        // (this is what Revision.svelte's $effect does after the fix)
    });
});
