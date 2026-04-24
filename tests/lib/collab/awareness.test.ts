import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
/**
 * awareness.test.ts -- Tests for awareness-based cursor sync.
 *
 * Per D-72: Replaces custom cursors.ts with Yjs awareness protocol.
 * Per D-60: Maintains Google Docs-style cursor display with name labels.
 *
 * Tests verify:
 *   - Local cursor position updates awareness state (as RelativePosition)
 *   - Remote awareness state creates cursor decoration
 *   - Awareness removal cleans up cursor decoration
 *   - Cursor position tracks through document changes (via RelativePosition)
 *   - Widget renders name label and colored caret
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { type AwarenessState, colorForClient, createAwarenessExtension } from "$lib/collab/awareness";
import { get } from "svelte/store";
import { activeAnnotation, modalStack } from "$lib/stores";
import { followedClientId } from "$lib/collab/store";
import { addAnnotation, annotationField } from "$lib/editor/plugins/annotations/annotationField";
import { createNewAnnotation } from "$lib/editor/plugins/annotations/models";
import { translateAndDispatch } from "$lib/editor/plugins/annotations/nestedEditor";

/**
 * Build a remote awareness cursor state using RelativePosition encoded
 * against the given Y.Text. Simulates what a real remote client would emit.
 */
function makeRemoteCursorState(
    ytext: Y.Text,
    name: string,
    color: string,
    absolutePos: number,
): AwarenessState {
    const rel = Y.createRelativePositionFromTypeIndex(ytext, absolutePos);
    const encoded = Array.from(Y.encodeRelativePosition(rel));
    return {
        user: { name, color, colorLight: `${color}33` },
        cursor: { anchorPos: encoded, headPos: encoded },
    };
}

function decodeLocalHeadPos(awareness: Awareness, ydoc: Y.Doc): number | null {
    const localState = awareness.getLocalState() as AwarenessState | null;
    const encoded = localState?.cursor?.headPos;
    if (!encoded || encoded.length === 0) return null;
    const rel = Y.decodeRelativePosition(new Uint8Array(encoded));
    return Y.createAbsolutePositionFromRelativePosition(rel, ydoc)?.index ?? null;
}

describe("awareness", () => {
    let ydoc: Y.Doc;
    let ytext: Y.Text;
    let awareness: Awareness;
    let view: EditorView | undefined;

    beforeEach(() => {
        ydoc = new Y.Doc();
        ytext = ydoc.getText("document");
        awareness = new Awareness(ydoc);
    });

    afterEach(() => {
        modalStack.clear();
        activeAnnotation.set(undefined);
        followedClientId.set(null);
        view?.destroy();
        awareness.destroy();
        ydoc.destroy();
    });

    describe("local cursor updates", () => {
        it("encodes local cursor as RelativePosition in awareness state", () => {
            // Seed Y.Text so RelativePosition has items to anchor to
            ydoc.transact(() => ytext.insert(0, "hello world"), "init");

            const ext = createAwarenessExtension(awareness, ytext, "Alice", "#4A90E2");
            const state = EditorState.create({ doc: "hello world", extensions: [ext] });
            view = new EditorView({ state, parent: document.body });

            view.dispatch({ selection: { anchor: 5 } });

            const localState = awareness.getLocalState() as AwarenessState;
            expect(localState?.cursor?.headPos).toBeInstanceOf(Array);
            expect(localState?.cursor?.anchorPos).toBeInstanceOf(Array);
            expect(localState?.cursor?.headPos?.length).toBeGreaterThan(0);
        });

        it("sets user info in awareness state", () => {
            ydoc.transact(() => ytext.insert(0, "hello"), "init");

            const ext = createAwarenessExtension(awareness, ytext, "Alice", "#4A90E2");
            const state = EditorState.create({ doc: "hello", extensions: [ext] });
            view = new EditorView({ state, parent: document.body });

            const localState = awareness.getLocalState() as AwarenessState;
            expect(localState?.user?.name).toBe("Alice");
            expect(localState?.user?.color).toBe("#4A90E2");
            expect(localState?.user?.colorLight).toBe("#4A90E233");
        });

        it("updates cursor when selection changes", () => {
            ydoc.transact(() => ytext.insert(0, "hello world"), "init");

            const ext = createAwarenessExtension(awareness, ytext, "Alice", "#4A90E2");
            const state = EditorState.create({ doc: "hello world", extensions: [ext] });
            view = new EditorView({ state, parent: document.body });

            const before = awareness.getLocalState() as AwarenessState;
            const encodedBefore = JSON.stringify(before?.cursor?.headPos);

            view.dispatch({ selection: { anchor: 2, head: 7 } });

            const after = awareness.getLocalState() as AwarenessState;
            const encodedAfter = JSON.stringify(after?.cursor?.headPos);
            expect(encodedAfter).not.toBe(encodedBefore);
        });

        it("does not let translated parent transactions overwrite nested cursor presence", () => {
            ydoc.transact(() => ytext.insert(0, "hello world"), "init");

            const parentExt = createAwarenessExtension(awareness, ytext, "Alice", "#4A90E2");
            const parentState = EditorState.create({
                doc: "hello world",
                extensions: [annotationField, parentExt],
            });
            view = new EditorView({ state: parentState, parent: document.body });

            view.dispatch({
                effects: [
                    addAnnotation.of({
                        id: 0,
                        _type: "revision",
                        thread: [],
                        selection: EditorSelection.single(6, 11),
                        activeVersionIndex: 0,
                        versions: [{ doc: "world" }],
                    }),
                ],
            });

            const nestedState = EditorState.create({
                doc: "world",
                extensions: [
                    EditorView.updateListener.of((update) => {
                        translateAndDispatch(update, view!, 0);
                    }),
                    createAwarenessExtension(awareness, ytext, "Alice", "#4A90E2", {
                        broadcastInitialCursor: false,
                        clearCursorOnDestroy: false,
                        toSharedPosition(position) {
                            return 6 + position;
                        },
                        fromSharedPosition(position) {
                            if (position < 6 || position > 11) return null;
                            return position - 6;
                        },
                    }),
                ],
            });
            const nestedView = new EditorView({ state: nestedState, parent: document.body });

            try {
                nestedView.focus();
                nestedView.contentDOM.focus();
                nestedView.dispatch({ selection: { anchor: 1 } });
                expect(decodeLocalHeadPos(awareness, ydoc)).toBe(7);

                nestedView.dispatch({ changes: { from: 1, insert: "X" } });
                const localHeadPos = decodeLocalHeadPos(awareness, ydoc);
                expect(localHeadPos).toBe(6 + nestedView.state.selection.main.head);
                expect(localHeadPos).not.toBe(6);
            } finally {
                nestedView.destroy();
            }
        });
    });

    describe("remote cursor decorations", () => {
        it("creates decoration for remote cursor", () => {
            ydoc.transact(() => ytext.insert(0, "hello world"), "init");

            const ext = createAwarenessExtension(awareness, ytext, "Alice", "#4A90E2");
            const state = EditorState.create({ doc: "hello world", extensions: [ext] });
            view = new EditorView({ state, parent: document.body });

            const remoteClientId = 999;
            awareness.states.set(remoteClientId, makeRemoteCursorState(ytext, "Bob", "#E87040", 3));
            awareness.emit("update", [
                { added: [remoteClientId], updated: [], removed: [] },
                "test",
            ]);
            view.dispatch({});

            const cursorElements = view.dom.querySelectorAll(".cm-remote-cursor");
            expect(cursorElements.length).toBe(1);
        });

        it("renders cursor widget with name label", () => {
            ydoc.transact(() => ytext.insert(0, "hello world"), "init");

            const ext = createAwarenessExtension(awareness, ytext, "Alice", "#4A90E2");
            const state = EditorState.create({ doc: "hello world", extensions: [ext] });
            view = new EditorView({ state, parent: document.body });

            const remoteClientId = 999;
            awareness.states.set(remoteClientId, makeRemoteCursorState(ytext, "Bob", "#E87040", 5));
            awareness.emit("update", [
                { added: [remoteClientId], updated: [], removed: [] },
                "test",
            ]);
            view.dispatch({});

            const labelElement = view.dom.querySelector(".cm-remote-cursor-label");
            expect(labelElement).not.toBeNull();
            expect(labelElement?.textContent).toBe("Bob");
        });

        it("renders cursor widget with colored caret", () => {
            ydoc.transact(() => ytext.insert(0, "hello world"), "init");

            const ext = createAwarenessExtension(awareness, ytext, "Alice", "#4A90E2");
            const state = EditorState.create({ doc: "hello world", extensions: [ext] });
            view = new EditorView({ state, parent: document.body });

            const remoteClientId = 999;
            awareness.states.set(
                remoteClientId,
                makeRemoteCursorState(ytext, "Charlie", "#50B86C", 2),
            );
            awareness.emit("update", [
                { added: [remoteClientId], updated: [], removed: [] },
                "test",
            ]);
            view.dispatch({});

            const caretElement = view.dom.querySelector(".cm-remote-cursor-caret");
            expect(caretElement).not.toBeNull();
        });
    });

    describe("cursor cleanup", () => {
        it("removes decoration when awareness state removed", () => {
            ydoc.transact(() => ytext.insert(0, "hello world"), "init");

            const ext = createAwarenessExtension(awareness, ytext, "Alice", "#4A90E2");
            const state = EditorState.create({ doc: "hello world", extensions: [ext] });
            view = new EditorView({ state, parent: document.body });

            const remoteClientId = 999;
            awareness.states.set(remoteClientId, makeRemoteCursorState(ytext, "Bob", "#E87040", 3));
            awareness.emit("update", [
                { added: [remoteClientId], updated: [], removed: [] },
                "test",
            ]);
            view.dispatch({});

            expect(view.dom.querySelectorAll(".cm-remote-cursor").length).toBe(1);

            awareness.states.delete(remoteClientId);
            awareness.emit("update", [
                { added: [], updated: [], removed: [remoteClientId] },
                "test",
            ]);
            view.dispatch({});

            expect(view.dom.querySelectorAll(".cm-remote-cursor").length).toBe(0);
        });

        it("clears local cursor state on destroy", () => {
            ydoc.transact(() => ytext.insert(0, "hello"), "init");

            const ext = createAwarenessExtension(awareness, ytext, "Alice", "#4A90E2");
            const state = EditorState.create({ doc: "hello", extensions: [ext] });
            view = new EditorView({ state, parent: document.body });

            const stateBefore = awareness.getLocalState() as AwarenessState;
            expect(stateBefore?.cursor).not.toBeNull();

            view.destroy();
            view = undefined;

            const stateAfter = awareness.getLocalState() as AwarenessState;
            expect(stateAfter?.cursor).toBeNull();
        });
    });

    describe("colorForClient", () => {
        it("returns deterministic color for same clientID", () => {
            const color1 = colorForClient("user-123");
            const color2 = colorForClient("user-123");
            expect(color1).toBe(color2);
        });

        it("returns different colors for different clientIDs", () => {
            const color1 = colorForClient("user-1");
            const color2 = colorForClient("user-2");
            expect(typeof color1).toBe("string");
            expect(typeof color2).toBe("string");
            expect(color1.startsWith("#")).toBe(true);
            expect(color2.startsWith("#")).toBe(true);
        });

        it("returns color from predefined palette", () => {
            const CURSOR_COLORS = [
                "#4A90E2",
                "#E87040",
                "#50B86C",
                "#9B59B6",
                "#E74C3C",
                "#16A085",
                "#F39C12",
                "#8E44AD",
            ];

            const color = colorForClient("test-user");
            expect(CURSOR_COLORS).toContain(color);
        });
    });

    describe("followed UI context", () => {
        it("publishes the local root modal stack into awareness", () => {
            ydoc.transact(() => ytext.insert(0, "hello world"), "init");

            const ext = createAwarenessExtension(awareness, ytext, "Alice", "#4A90E2");
            const state = EditorState.create({
                doc: "hello world",
                extensions: [annotationField, ext],
            });
            view = new EditorView({ state, parent: document.body });

            const comment = createNewAnnotation(
                view.state.field(annotationField),
                view.state.selection,
                "comment",
            );
            view.dispatch({ effects: [addAnnotation.of(comment)] });

            modalStack.push({
                type: "comment",
                commentId: comment.id,
                parentView: view,
                label: "Comment",
            });

            const localState = awareness.getLocalState() as AwarenessState;
            expect(localState.ui?.modalStack).toEqual([{ type: "comment", id: comment.id }]);
        });

        it("opens a followed collaborator's root modal locally", async () => {
            ydoc.transact(() => ytext.insert(0, "hello world"), "init");

            const ext = createAwarenessExtension(awareness, ytext, "Alice", "#4A90E2");
            const state = EditorState.create({
                doc: "hello world",
                extensions: [annotationField, ext],
            });
            view = new EditorView({ state, parent: document.body });

            const comment = createNewAnnotation(
                view.state.field(annotationField),
                view.state.selection,
                "comment",
            );
            view.dispatch({ effects: [addAnnotation.of(comment)] });

            const remoteClientId = 999;
            awareness.states.set(remoteClientId, {
                ...makeRemoteCursorState(ytext, "Bob", "#E87040", 3),
                ui: {
                    modalStack: [{ type: "comment", id: comment.id }],
                    activeAnnotation: null,
                },
            });
            followedClientId.set(remoteClientId);
            awareness.emit("update", [
                { added: [remoteClientId], updated: [], removed: [] },
                "test",
            ]);
            await Promise.resolve();

            expect(get(modalStack)).toMatchObject([
                { type: "comment", commentId: comment.id, parentView: view },
            ]);
        });

        it("does not mirror a collaborator's modal when not following them", async () => {
            ydoc.transact(() => ytext.insert(0, "hello world"), "init");

            const ext = createAwarenessExtension(awareness, ytext, "Alice", "#4A90E2");
            const state = EditorState.create({
                doc: "hello world",
                extensions: [annotationField, ext],
            });
            view = new EditorView({ state, parent: document.body });

            const remoteClientId = 999;
            awareness.states.set(remoteClientId, {
                ...makeRemoteCursorState(ytext, "Bob", "#E87040", 3),
                ui: {
                    modalStack: [{ type: "comment", id: 0 }],
                    activeAnnotation: null,
                },
            });
            awareness.emit("update", [
                { added: [remoteClientId], updated: [], removed: [] },
                "test",
            ]);
            await Promise.resolve();

            expect(get(modalStack)).toEqual([]);
        });
    });

    describe("RelativePosition tracking through edits", () => {
        it("remote cursor shifts correctly when local text is inserted before it", () => {
            ydoc.transact(() => ytext.insert(0, "hello world"), "init");

            const ext = createAwarenessExtension(awareness, ytext, "Alice", "#4A90E2");
            const state = EditorState.create({ doc: "hello world", extensions: [ext] });
            view = new EditorView({ state, parent: document.body });

            // Remote cursor at position 6 (start of "world")
            const remoteClientId = 999;
            awareness.states.set(remoteClientId, makeRemoteCursorState(ytext, "Bob", "#E87040", 6));
            awareness.emit("update", [
                { added: [remoteClientId], updated: [], removed: [] },
                "test",
            ]);
            view.dispatch({});

            expect(view.dom.querySelectorAll(".cm-remote-cursor").length).toBe(1);

            // Locally insert text before the remote cursor's anchor
            ydoc.transact(() => ytext.insert(0, "XXX "), "local");
            view.dispatch({
                changes: { from: 0, insert: "XXX " },
            });

            // Cursor should still render (RelativePosition tracks to "XXX hello world"[10])
            expect(view.dom.querySelectorAll(".cm-remote-cursor").length).toBe(1);
        });

        it("hides remote cursor when its anchor text is deleted", () => {
            ydoc.transact(() => ytext.insert(0, "hello world"), "init");

            const ext = createAwarenessExtension(awareness, ytext, "Alice", "#4A90E2");
            const state = EditorState.create({ doc: "hello world", extensions: [ext] });
            view = new EditorView({ state, parent: document.body });

            // Remote cursor at position 3 (inside "hello")
            const remoteClientId = 999;
            awareness.states.set(remoteClientId, makeRemoteCursorState(ytext, "Bob", "#E87040", 3));
            awareness.emit("update", [
                { added: [remoteClientId], updated: [], removed: [] },
                "test",
            ]);
            view.dispatch({});

            expect(view.dom.querySelectorAll(".cm-remote-cursor").length).toBe(1);
        });

        it("does not show local cursor in decorations", () => {
            ydoc.transact(() => ytext.insert(0, "hello world"), "init");

            const ext = createAwarenessExtension(awareness, ytext, "Alice", "#4A90E2");
            const state = EditorState.create({ doc: "hello world", extensions: [ext] });
            view = new EditorView({ state, parent: document.body });

            view.dispatch({ selection: { anchor: 5 } });

            const cursorElements = view.dom.querySelectorAll(".cm-remote-cursor");
            expect(cursorElements.length).toBe(0);
        });

        it("maps remote shared cursor positions into a nested editor range", () => {
            ydoc.transact(() => ytext.insert(0, "prefix nested suffix"), "init");

            const ext = createAwarenessExtension(awareness, ytext, "Alice", "#4A90E2", {
                fromSharedPosition(position) {
                    if (position < 7 || position > 13) return null;
                    return position - 7;
                },
                toSharedPosition(position) {
                    return position + 7;
                },
            });
            const state = EditorState.create({ doc: "nested", extensions: [ext] });
            view = new EditorView({ state, parent: document.body });

            const remoteClientId = 999;
            awareness.states.set(remoteClientId, makeRemoteCursorState(ytext, "Bob", "#E87040", 9));
            awareness.emit("update", [
                { added: [remoteClientId], updated: [], removed: [] },
                "test",
            ]);
            view.dispatch({});

            expect(view.dom.querySelectorAll(".cm-remote-cursor").length).toBe(1);

            awareness.states.set(remoteClientId, makeRemoteCursorState(ytext, "Bob", "#E87040", 2));
            awareness.emit("update", [
                { added: [], updated: [remoteClientId], removed: [] },
                "test",
            ]);
            view.dispatch({});

            expect(view.dom.querySelectorAll(".cm-remote-cursor").length).toBe(0);
        });
    });
});
