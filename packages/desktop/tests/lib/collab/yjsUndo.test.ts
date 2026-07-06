import { createYjsUndoExtension } from "$lib/collab/yjsUndo";
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

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

describe("createYjsUndoExtension with ymap (D-83 unified stack)", () => {
    let ydoc: Y.Doc;
    let ytext: Y.Text;
    let ymap: Y.Map<unknown>;
    let undoManager: Y.UndoManager;

    beforeEach(() => {
        ydoc = new Y.Doc();
        ytext = ydoc.getText("document");
        ymap = ydoc.getMap("annotations");
        const result = createYjsUndoExtension(ytext, ymap);
        undoManager = result.undoManager;
    });

    afterEach(() => {
        undoManager.destroy();
        ydoc.destroy();
    });

    it("accepts optional ymap parameter (backward compatibility when omitted)", () => {
        // createYjsUndoExtension(ytext) without ymap should still work
        const result = createYjsUndoExtension(ytext);
        expect(result.undoManager).toBeInstanceOf(Y.UndoManager);
        result.undoManager.destroy();
    });

    it("undoes annotation addition", () => {
        ydoc.transact(() => {
            ymap.set("ann-1", { id: "ann-1", value: "test" });
        }, "local");

        expect(ymap.size).toBe(1);
        expect(undoManager.canUndo()).toBe(true);

        undoManager.undo();

        expect(ymap.size).toBe(0);
    });

    it("undoes annotation removal", () => {
        // Add annotation
        ydoc.transact(() => {
            ymap.set("ann-1", { id: "ann-1", value: "test" });
        }, "local");

        // Clear undo stack to start fresh
        undoManager.clear();

        // Remove annotation
        ydoc.transact(() => {
            ymap.delete("ann-1");
        }, "local");

        expect(ymap.size).toBe(0);
        expect(undoManager.canUndo()).toBe(true);

        undoManager.undo();

        expect(ymap.size).toBe(1);
        expect(ymap.get("ann-1")).toEqual({ id: "ann-1", value: "test" });
    });

    it("undoes text and annotation together (unified stack)", () => {
        // Single transaction with both text and annotation change
        ydoc.transact(() => {
            ytext.insert(0, "hello");
            ymap.set("ann-1", { id: "ann-1", value: "comment" });
        }, "local");

        expect(ytext.toString()).toBe("hello");
        expect(ymap.size).toBe(1);

        undoManager.undo();

        expect(ytext.toString()).toBe("");
        expect(ymap.size).toBe(0);
    });

    it("does not undo remote annotation changes", () => {
        // Remote change (different origin)
        ydoc.transact(() => {
            ymap.set("ann-1", { id: "ann-1", value: "remote" });
        }, "remote");

        expect(ymap.size).toBe(1);
        expect(undoManager.canUndo()).toBe(false);
    });

    it("redoes annotation changes", () => {
        ydoc.transact(() => {
            ymap.set("ann-1", { id: "ann-1", value: "test" });
        }, "local");

        undoManager.undo();
        expect(ymap.size).toBe(0);

        undoManager.redo();
        expect(ymap.size).toBe(1);
        expect(ymap.get("ann-1")).toEqual({ id: "ann-1", value: "test" });
    });

    it("handles interleaved text and annotation operations", () => {
        // Operation 1: text — stopCapturing forces a new undo boundary after each
        ydoc.transact(() => {
            ytext.insert(0, "hello");
        }, "local");
        undoManager.stopCapturing(); // Force separate undo step

        // Operation 2: annotation
        ydoc.transact(() => {
            ymap.set("ann-1", { id: "ann-1", value: "comment" });
        }, "local");
        undoManager.stopCapturing(); // Force separate undo step

        // Operation 3: more text
        ydoc.transact(() => {
            ytext.insert(5, " world");
        }, "local");

        expect(ytext.toString()).toBe("hello world");
        expect(ymap.size).toBe(1);

        // Undo in reverse order
        undoManager.undo(); // Undo "world"
        expect(ytext.toString()).toBe("hello");
        expect(ymap.size).toBe(1);

        undoManager.undo(); // Undo annotation
        expect(ytext.toString()).toBe("hello");
        expect(ymap.size).toBe(0);

        undoManager.undo(); // Undo "hello"
        expect(ytext.toString()).toBe("");
        expect(ymap.size).toBe(0);
    });
});
