import { describe, it, expect, vi, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { mockIPC } from "@tauri-apps/api/mocks";
import { listeners } from "$lib/editor/listeners";
import { annotationField } from "$lib/editor/plugins/annotations/annotationField";

// ── Helpers ─────────────────────────────────────────────────────

function makeView(options = {}) {
    const state = EditorState.create({
        doc: "Hello world",
        extensions: [annotationField, listeners(options)],
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return new EditorView({ state, parent });
}

let view: EditorView | undefined;

afterEach(() => {
    view?.destroy();
    view = undefined;
});

// ── Unit tests ──────────────────────────────────────────────────

describe("listeners", () => {
    it("returns an array with at least one extension", () => {
        const exts = listeners();
        expect(Array.isArray(exts)).toBe(true);
        expect(exts.length).toBeGreaterThanOrEqual(1);
    });

    it("returns fewer extensions when persist is false", () => {
        const defaultExts = listeners();
        const noPersistExts = listeners({ persist: false });
        expect(noPersistExts.length).toBeLessThan(defaultExts.length);
    });

    it("returns more extensions when updateListener is provided", () => {
        const defaultExts = listeners();
        const withListener = listeners({ updateListener: vi.fn() });
        expect(withListener.length).toBeGreaterThan(defaultExts.length);
    });

    it("only includes updateListener when persist is false", () => {
        const exts = listeners({
            persist: false,
            updateListener: vi.fn(),
        });
        // persist=false removes save, updateListener adds one => 1
        expect(exts.length).toBe(1);
    });
});

// ── Integration: save invocation ────────────────────────────────

describe("save listener integration", () => {
    it("invokes save when the document changes", async () => {
        const invoked: Array<{ cmd: string; args: unknown }> = [];

        mockIPC((cmd, args) => {
            invoked.push({ cmd, args });
            return null;
        });

        view = makeView(); // default options — persist enabled

        // Dispatch a doc-changing transaction
        view.dispatch({
            changes: { from: 0, insert: "Hi " },
        });

        // The save listener calls invoke asynchronously via
        // a .then() chain, so flush the microtask queue.
        await new Promise((r) => setTimeout(r, 0));

        expect(invoked.some((call) => call.cmd === "save")).toBe(true);
    });
});
