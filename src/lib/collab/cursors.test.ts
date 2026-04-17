/**
 * cursors.test.ts -- Unit tests for remote cursor StateField, position mapping, and color assignment.
 *
 * Tests cover:
 * - colorForClient determinism and palette membership
 * - remoteCursorsField StateField mutations (set/remove)
 * - Position mapping through document changes
 */
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
    colorForClient,
    remoteCursorsField,
    setRemoteCursor,
    removeRemoteCursor,
    type RemoteCursor,
} from "./cursors";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a minimal EditorState with remoteCursorsField. */
function makeState(doc: string): EditorState {
    return EditorState.create({
        doc,
        extensions: [remoteCursorsField],
    });
}

/** Read cursors map from an EditorState. */
function getCursors(state: EditorState): Map<string, RemoteCursor> {
    return state.field(remoteCursorsField);
}

// ── colorForClient ───────────────────────────────────────────────────────────

describe("colorForClient", () => {
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

    it("returns the same color on repeated calls (deterministic)", () => {
        const id = "abc-123";
        const color1 = colorForClient(id);
        const color2 = colorForClient(id);
        expect(color1).toBe(color2);
    });

    it("returns a color from the CURSOR_COLORS palette", () => {
        expect(CURSOR_COLORS).toContain(colorForClient("any-id"));
        expect(CURSOR_COLORS).toContain(colorForClient("another-id"));
        expect(CURSOR_COLORS).toContain(colorForClient("user-xyz-789"));
    });
});

// ── remoteCursorsField StateField ────────────────────────────────────────────

describe("remoteCursorsField", () => {
    it("starts with an empty map", () => {
        const state = makeState("hello world");
        expect(getCursors(state).size).toBe(0);
    });

    it("setRemoteCursor effect adds cursor to map", () => {
        let state = makeState("hello world");

        const cursor: RemoteCursor = {
            clientID: "user-1",
            pos: 5,
            name: "Alice",
            color: "#4A90E2",
        };

        state = state.update({
            effects: [setRemoteCursor.of(cursor)],
        }).state;

        const cursors = getCursors(state);
        expect(cursors.size).toBe(1);
        expect(cursors.get("user-1")).toEqual(cursor);
    });

    it("removeRemoteCursor effect removes cursor by clientID", () => {
        let state = makeState("hello world");

        const cursor: RemoteCursor = {
            clientID: "user-1",
            pos: 5,
            name: "Alice",
            color: "#4A90E2",
        };

        state = state.update({
            effects: [setRemoteCursor.of(cursor)],
        }).state;
        expect(getCursors(state).size).toBe(1);

        state = state.update({
            effects: [removeRemoteCursor.of("user-1")],
        }).state;
        expect(getCursors(state).size).toBe(0);
    });

    it("positions are mapped through doc changes (pos increases when text inserted before)", () => {
        let state = makeState("hello");

        const cursor: RemoteCursor = {
            clientID: "user-1",
            pos: 5, // at end of "hello"
            name: "Alice",
            color: "#4A90E2",
        };

        state = state.update({
            effects: [setRemoteCursor.of(cursor)],
        }).state;

        // Insert "hey " at position 0 => "hey hello"
        // Cursor should map from 5 to 9 (5 + 4 inserted chars)
        state = state.update({
            changes: { from: 0, to: 0, insert: "hey " },
        }).state;

        const mappedCursor = getCursors(state).get("user-1");
        expect(mappedCursor).toBeDefined();
        expect(mappedCursor!.pos).toBe(9);
    });

    it("positions are clamped via mapPos when content deleted past cursor", () => {
        let state = makeState("hello world");

        const cursor: RemoteCursor = {
            clientID: "user-1",
            pos: 8, // in "world"
            name: "Alice",
            color: "#4A90E2",
        };

        state = state.update({
            effects: [setRemoteCursor.of(cursor)],
        }).state;

        // Delete " world" (from 5 to 11) => "hello"
        // Cursor at 8 is within the deleted range, should map to 5 (deletion start)
        state = state.update({
            changes: { from: 5, to: 11, insert: "" },
        }).state;

        const mappedCursor = getCursors(state).get("user-1");
        expect(mappedCursor).toBeDefined();
        expect(mappedCursor!.pos).toBe(5);
    });

    it("handles multiple cursors independently", () => {
        let state = makeState("hello");

        const cursor1: RemoteCursor = {
            clientID: "user-1",
            pos: 2,
            name: "Alice",
            color: "#4A90E2",
        };
        const cursor2: RemoteCursor = {
            clientID: "user-2",
            pos: 4,
            name: "Bob",
            color: "#E87040",
        };

        state = state.update({
            effects: [setRemoteCursor.of(cursor1), setRemoteCursor.of(cursor2)],
        }).state;

        expect(getCursors(state).size).toBe(2);
        expect(getCursors(state).get("user-1")!.pos).toBe(2);
        expect(getCursors(state).get("user-2")!.pos).toBe(4);

        // Insert "XX" at position 3 => "helXXlo"
        // Cursor1 at 2 should stay at 2 (before insertion)
        // Cursor2 at 4 should map to 6 (after insertion)
        state = state.update({
            changes: { from: 3, to: 3, insert: "XX" },
        }).state;

        expect(getCursors(state).get("user-1")!.pos).toBe(2);
        expect(getCursors(state).get("user-2")!.pos).toBe(6);
    });

    it("updating same clientID replaces existing cursor", () => {
        let state = makeState("hello");

        const cursor1: RemoteCursor = {
            clientID: "user-1",
            pos: 2,
            name: "Alice",
            color: "#4A90E2",
        };

        state = state.update({
            effects: [setRemoteCursor.of(cursor1)],
        }).state;

        const cursor2: RemoteCursor = {
            clientID: "user-1",
            pos: 4,
            name: "Alice (updated)",
            color: "#E87040",
        };

        state = state.update({
            effects: [setRemoteCursor.of(cursor2)],
        }).state;

        expect(getCursors(state).size).toBe(1);
        expect(getCursors(state).get("user-1")).toEqual(cursor2);
    });
});
