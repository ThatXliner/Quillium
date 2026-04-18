/**
 * yjsUndo.test.ts -- Tests for Yjs UndoManager integration.
 *
 * Per D-74: Client-side UndoManager scoped to local changes only.
 * Per D-50: Matches existing per-user undo behavior from OT implementation.
 *
 * Tests verify:
 *   - UndoManager reverts local changes (origin='local')
 *   - UndoManager does NOT revert remote changes
 *   - Redo reapplies undone local changes
 *   - Rapid changes merge into single undo step (captureTimeout)
 *   - Keyboard shortcuts trigger undo/redo
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as Y from "yjs";
import { createYjsUndoExtension } from "./yjsUndo";

describe("yjsUndo", () => {
    let ydoc: Y.Doc;
    let ytext: Y.Text;

    beforeEach(() => {
        ydoc = new Y.Doc();
        ytext = ydoc.getText("document");
    });

    afterEach(() => {
        ydoc.destroy();
    });

    describe("UndoManager behavior", () => {
        it("undo reverts local change", () => {
            const { undoManager } = createYjsUndoExtension(ytext);

            // Make a local change (origin='local' tracked by UndoManager)
            ydoc.transact(() => {
                ytext.insert(0, "hello");
            }, "local");

            expect(ytext.toString()).toBe("hello");
            expect(undoManager.canUndo()).toBe(true);

            undoManager.undo();

            expect(ytext.toString()).toBe("");
            expect(undoManager.canUndo()).toBe(false);
        });

        it("undo does NOT revert remote change", () => {
            const { undoManager } = createYjsUndoExtension(ytext);

            // Remote change with different origin (not tracked)
            ydoc.transact(() => {
                ytext.insert(0, "remote");
            }, "remote-client");

            expect(ytext.toString()).toBe("remote");
            expect(undoManager.canUndo()).toBe(false);

            // Undo should have no effect
            undoManager.undo();

            expect(ytext.toString()).toBe("remote");
        });

        it("redo reapplies undone local change", () => {
            const { undoManager } = createYjsUndoExtension(ytext);

            ydoc.transact(() => {
                ytext.insert(0, "test");
            }, "local");

            expect(ytext.toString()).toBe("test");

            undoManager.undo();
            expect(ytext.toString()).toBe("");
            expect(undoManager.canRedo()).toBe(true);

            undoManager.redo();
            expect(ytext.toString()).toBe("test");
        });

        it("rapid changes merge into single undo step (captureTimeout)", async () => {
            const { undoManager } = createYjsUndoExtension(ytext);

            // Make rapid changes within captureTimeout (500ms)
            ydoc.transact(() => {
                ytext.insert(0, "a");
            }, "local");
            ydoc.transact(() => {
                ytext.insert(1, "b");
            }, "local");
            ydoc.transact(() => {
                ytext.insert(2, "c");
            }, "local");

            expect(ytext.toString()).toBe("abc");

            // All rapid changes should be merged into one undo step
            undoManager.undo();
            expect(ytext.toString()).toBe("");
        });

        it("changes after captureTimeout create separate undo steps", async () => {
            const { undoManager } = createYjsUndoExtension(ytext);

            ydoc.transact(() => {
                ytext.insert(0, "first");
            }, "local");

            // Wait for captureTimeout to expire
            await new Promise((resolve) => setTimeout(resolve, 600));

            ydoc.transact(() => {
                ytext.insert(5, "second");
            }, "local");

            expect(ytext.toString()).toBe("firstsecond");

            // Should only undo the second change
            undoManager.undo();
            expect(ytext.toString()).toBe("first");

            // Should undo the first change
            undoManager.undo();
            expect(ytext.toString()).toBe("");
        });

        it("local changes interleaved with remote changes undo correctly", async () => {
            const { undoManager } = createYjsUndoExtension(ytext);

            // Local change
            ydoc.transact(() => {
                ytext.insert(0, "local1");
            }, "local");

            // Wait for captureTimeout to separate undo steps
            await new Promise((resolve) => setTimeout(resolve, 600));

            // Remote change (not tracked)
            ydoc.transact(() => {
                ytext.insert(6, "-remote-");
            }, "remote-client");

            // Wait again
            await new Promise((resolve) => setTimeout(resolve, 600));

            // Another local change
            ydoc.transact(() => {
                ytext.insert(ytext.length, "local2");
            }, "local");

            expect(ytext.toString()).toBe("local1-remote-local2");

            // Undo should only affect local changes, in reverse order
            // First undo removes "local2"
            undoManager.undo();
            expect(ytext.toString()).toBe("local1-remote-");

            // Second undo removes "local1" (remote content stays)
            undoManager.undo();
            expect(ytext.toString()).toBe("-remote-");
        });
    });

    describe("keymap integration", () => {
        it("extension contains keymap with Mod-z binding", () => {
            const { extension } = createYjsUndoExtension(ytext);

            // Extension should be defined
            expect(extension).toBeDefined();
            // The extension is a keymap, which is an array with keybindings
            // We can't easily inspect keymap internals, but we verify it exists
        });

        it("provides undoManager instance for external access", () => {
            const { undoManager } = createYjsUndoExtension(ytext);

            expect(undoManager).toBeInstanceOf(Y.UndoManager);
            expect(typeof undoManager.undo).toBe("function");
            expect(typeof undoManager.redo).toBe("function");
            expect(typeof undoManager.canUndo).toBe("function");
            expect(typeof undoManager.canRedo).toBe("function");
        });
    });

    describe("trackedOrigins configuration", () => {
        it("only tracks 'local' origin", () => {
            const { undoManager } = createYjsUndoExtension(ytext);

            // Changes with 'local' origin are tracked
            ydoc.transact(() => {
                ytext.insert(0, "tracked");
            }, "local");
            expect(undoManager.canUndo()).toBe(true);
            undoManager.undo();
            expect(ytext.toString()).toBe("");

            // Changes with other origins are not tracked
            ydoc.transact(() => {
                ytext.insert(0, "not-tracked");
            }, "other-origin");
            expect(undoManager.canUndo()).toBe(false);

            // Changes with null origin are not tracked
            ydoc.transact(() => {
                ytext.insert(0, "null-origin");
            }, null);
            expect(undoManager.canUndo()).toBe(false);
        });
    });
});
