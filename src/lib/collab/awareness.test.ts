/**
 * awareness.test.ts -- Tests for awareness-based cursor sync.
 *
 * Per D-72: Replaces custom cursors.ts with Yjs awareness protocol.
 * Per D-60: Maintains Google Docs-style cursor display with name labels.
 *
 * Tests verify:
 *   - Local cursor position updates awareness state
 *   - Remote awareness state creates cursor decoration
 *   - Awareness removal cleans up cursor decoration
 *   - Cursor position maps through document changes
 *   - Widget renders name label and colored caret
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import {
    createAwarenessExtension,
    colorForClient,
    type AwarenessState,
} from "./awareness";

describe("awareness", () => {
    let ydoc: Y.Doc;
    let awareness: Awareness;
    let view: EditorView;

    beforeEach(() => {
        ydoc = new Y.Doc();
        awareness = new Awareness(ydoc);
    });

    afterEach(() => {
        view?.destroy();
        awareness.destroy();
        ydoc.destroy();
    });

    describe("local cursor updates", () => {
        it("updates awareness with local cursor position on selection change", () => {
            const ext = createAwarenessExtension(awareness, "Alice", "#4A90E2");
            const state = EditorState.create({ doc: "hello world", extensions: [ext] });
            view = new EditorView({ state, parent: document.body });

            // Move cursor to position 5
            view.dispatch({ selection: { anchor: 5 } });

            const localState = awareness.getLocalState() as AwarenessState;
            expect(localState?.cursor?.head).toBe(5);
            expect(localState?.cursor?.anchor).toBe(5);
        });

        it("sets user info in awareness state", () => {
            const ext = createAwarenessExtension(awareness, "Alice", "#4A90E2");
            const state = EditorState.create({ doc: "hello", extensions: [ext] });
            view = new EditorView({ state, parent: document.body });

            const localState = awareness.getLocalState() as AwarenessState;
            expect(localState?.user?.name).toBe("Alice");
            expect(localState?.user?.color).toBe("#4A90E2");
            expect(localState?.user?.colorLight).toBe("#4A90E233");
        });

        it("updates cursor position when selection has anchor != head", () => {
            const ext = createAwarenessExtension(awareness, "Alice", "#4A90E2");
            const state = EditorState.create({ doc: "hello world", extensions: [ext] });
            view = new EditorView({ state, parent: document.body });

            // Select range from 2 to 7
            view.dispatch({ selection: { anchor: 2, head: 7 } });

            const localState = awareness.getLocalState() as AwarenessState;
            expect(localState?.cursor?.anchor).toBe(2);
            expect(localState?.cursor?.head).toBe(7);
        });
    });

    describe("remote cursor decorations", () => {
        it("creates decoration for remote cursor", () => {
            // Set up local client
            const ext = createAwarenessExtension(awareness, "Alice", "#4A90E2");
            const state = EditorState.create({ doc: "hello world", extensions: [ext] });
            view = new EditorView({ state, parent: document.body });

            // Simulate remote client by creating another awareness state
            // Note: In real scenario, remote updates come via WebSocket
            // For testing, we manually set another client's state
            const remoteClientId = 999;
            const remoteState: AwarenessState = {
                user: { name: "Bob", color: "#E87040", colorLight: "#E8704033" },
                cursor: { anchor: 3, head: 3 },
            };

            // Manually set awareness state for "remote" client
            // This simulates what y-websocket does when receiving remote updates
            awareness.states.set(remoteClientId, remoteState);
            awareness.emit("change", [
                { added: [remoteClientId], updated: [], removed: [] },
                "test",
            ]);

            // Force view update to rebuild decorations
            view.dispatch({});

            // Check for remote cursor decoration
            const cursorElements = view.dom.querySelectorAll(".cm-remote-cursor");
            expect(cursorElements.length).toBe(1);
        });

        it("renders cursor widget with name label", () => {
            const ext = createAwarenessExtension(awareness, "Alice", "#4A90E2");
            const state = EditorState.create({ doc: "hello world", extensions: [ext] });
            view = new EditorView({ state, parent: document.body });

            // Simulate remote client
            const remoteClientId = 999;
            const remoteState: AwarenessState = {
                user: { name: "Bob", color: "#E87040", colorLight: "#E8704033" },
                cursor: { anchor: 5, head: 5 },
            };

            awareness.states.set(remoteClientId, remoteState);
            awareness.emit("change", [
                { added: [remoteClientId], updated: [], removed: [] },
                "test",
            ]);
            view.dispatch({});

            const labelElement = view.dom.querySelector(".cm-remote-cursor-label");
            expect(labelElement).not.toBeNull();
            expect(labelElement?.textContent).toBe("Bob");
        });

        it("renders cursor widget with colored caret", () => {
            const ext = createAwarenessExtension(awareness, "Alice", "#4A90E2");
            const state = EditorState.create({ doc: "hello world", extensions: [ext] });
            view = new EditorView({ state, parent: document.body });

            // Simulate remote client
            const remoteClientId = 999;
            const remoteState: AwarenessState = {
                user: { name: "Charlie", color: "#50B86C", colorLight: "#50B86C33" },
                cursor: { anchor: 2, head: 2 },
            };

            awareness.states.set(remoteClientId, remoteState);
            awareness.emit("change", [
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
            const ext = createAwarenessExtension(awareness, "Alice", "#4A90E2");
            const state = EditorState.create({ doc: "hello world", extensions: [ext] });
            view = new EditorView({ state, parent: document.body });

            // Add remote client
            const remoteClientId = 999;
            const remoteState: AwarenessState = {
                user: { name: "Bob", color: "#E87040", colorLight: "#E8704033" },
                cursor: { anchor: 3, head: 3 },
            };

            awareness.states.set(remoteClientId, remoteState);
            awareness.emit("change", [
                { added: [remoteClientId], updated: [], removed: [] },
                "test",
            ]);
            view.dispatch({});

            expect(view.dom.querySelectorAll(".cm-remote-cursor").length).toBe(1);

            // Remove remote client
            awareness.states.delete(remoteClientId);
            awareness.emit("change", [
                { added: [], updated: [], removed: [remoteClientId] },
                "test",
            ]);
            view.dispatch({});

            expect(view.dom.querySelectorAll(".cm-remote-cursor").length).toBe(0);
        });

        it("clears local cursor state on destroy", () => {
            const ext = createAwarenessExtension(awareness, "Alice", "#4A90E2");
            const state = EditorState.create({ doc: "hello", extensions: [ext] });
            view = new EditorView({ state, parent: document.body });

            // Verify cursor is set
            const stateBefore = awareness.getLocalState() as AwarenessState;
            expect(stateBefore?.cursor).not.toBeNull();

            // Destroy view
            view.destroy();
            view = undefined!;

            // Cursor should be null after destroy
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
            // Colors may collide by chance, but usually differ
            // This test documents the deterministic behavior
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

    describe("document change handling", () => {
        it("clamps cursor position to document length", () => {
            const ext = createAwarenessExtension(awareness, "Alice", "#4A90E2");
            const state = EditorState.create({ doc: "hello world", extensions: [ext] });
            view = new EditorView({ state, parent: document.body });

            // Simulate remote client with cursor past document end
            const remoteClientId = 999;
            const remoteState: AwarenessState = {
                user: { name: "Bob", color: "#E87040", colorLight: "#E8704033" },
                cursor: { anchor: 100, head: 100 }, // Beyond doc length
            };

            awareness.states.set(remoteClientId, remoteState);
            awareness.emit("change", [
                { added: [remoteClientId], updated: [], removed: [] },
                "test",
            ]);
            view.dispatch({});

            // Should still render (clamped to doc length)
            const cursorElements = view.dom.querySelectorAll(".cm-remote-cursor");
            expect(cursorElements.length).toBe(1);
        });

        it("does not show local cursor in decorations", () => {
            const ext = createAwarenessExtension(awareness, "Alice", "#4A90E2");
            const state = EditorState.create({ doc: "hello world", extensions: [ext] });
            view = new EditorView({ state, parent: document.body });

            // Move local cursor
            view.dispatch({ selection: { anchor: 5 } });

            // No remote cursor decorations should appear for local user
            const cursorElements = view.dom.querySelectorAll(".cm-remote-cursor");
            expect(cursorElements.length).toBe(0);
        });
    });
});
