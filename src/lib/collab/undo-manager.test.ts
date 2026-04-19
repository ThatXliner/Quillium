/**
 * undo-manager.test.ts -- Y.UndoManager behavior matrix (Phase 8.5).
 *
 * Wave 0 scaffold. Tests wired by Plan 8.5b-02 (addToScope, stopCapturing).
 * Remaining todos implemented by Plans 8.5c-01 and 8.5c-02.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { addSubtreeToUndoScope, breakUndoCapture, createYjsUndoExtension } from "./yjsUndo";

describe("yjs undo manager", () => {
    it.todo("chronological across scopes");
    it.todo("nested local undo");
    it.todo("auto-nav event emitted");

    it("addToScope captures new type", () => {
        // Setup: Create an UndoManager with just ytext + ymap
        const ydoc = new Y.Doc();
        const ytext = ydoc.getText("content");
        const ymap = ydoc.getMap<unknown>("annotations");
        const { undoManager } = createYjsUndoExtension(ytext, ymap);

        // Create a subtree Y.Text (representing a nested revision's content)
        const subtree = new Y.Text();
        ydoc.getMap("subtrees").set("rev-1", subtree);

        // Make a local edit to the subtree BEFORE calling addSubtreeToUndoScope
        ydoc.transact(() => {
            subtree.insert(0, "pre-registration edit");
        }, "local");

        // Should NOT be undoable because subtree wasn't tracked yet
        expect(undoManager.canUndo()).toBe(false);

        // Now register the subtree with the undo manager
        addSubtreeToUndoScope(undoManager, subtree);

        // Make another local edit to the subtree
        ydoc.transact(() => {
            subtree.insert(subtree.length, " post-registration");
        }, "local");

        // NOW it should be undoable
        expect(undoManager.canUndo()).toBe(true);

        // Undo should only revert the post-registration edit
        undoManager.undo();
        expect(subtree.toString()).toBe("pre-registration edit");
        expect(undoManager.canUndo()).toBe(false);
    });

    it("addToScope is idempotent", () => {
        const ydoc = new Y.Doc();
        const ytext = ydoc.getText("content");
        const ymap = ydoc.getMap<unknown>("annotations");
        const { undoManager } = createYjsUndoExtension(ytext, ymap);

        // Create a subtree
        const subtree = new Y.Text();
        ydoc.getMap("subtrees").set("rev-1", subtree);

        // Call addSubtreeToUndoScope TWICE on the same subtree
        addSubtreeToUndoScope(undoManager, subtree);
        addSubtreeToUndoScope(undoManager, subtree);

        // Make one local edit
        ydoc.transact(() => {
            subtree.insert(0, "single edit");
        }, "local");

        // Should have exactly one undo step, not two
        expect(undoManager.canUndo()).toBe(true);
        undoManager.undo();
        expect(subtree.toString()).toBe("");
        expect(undoManager.canUndo()).toBe(false);
    });

    it("remote updates not captured", () => {
        // Setup two Y.Docs to simulate remote collaboration
        const docA = new Y.Doc();
        const docB = new Y.Doc();

        const ytextA = docA.getText("content");
        const ytextB = docB.getText("content");

        // Create UndoManager on doc A tracking ytext
        const { undoManager } = createYjsUndoExtension(ytextA);

        // Doc B makes an edit (remote origin perspective from doc A)
        docB.transact(() => {
            ytextB.insert(0, "remote edit from B");
        });

        // Sync B's changes to A via update encoding
        const update = Y.encodeStateAsUpdate(docB);
        Y.applyUpdate(docA, update);

        // Doc A should see the text
        expect(ytextA.toString()).toBe("remote edit from B");

        // But A's UndoManager should NOT be able to undo it (D-74 per-user-undo)
        expect(undoManager.canUndo()).toBe(false);
    });

    it("stopCapturing creates new stack item", () => {
        const ydoc = new Y.Doc();
        const ytext = ydoc.getText("content");
        const { undoManager } = createYjsUndoExtension(ytext);

        // Make first edit
        ydoc.transact(() => {
            ytext.insert(0, "first");
        }, "local");

        // Break the capture window
        breakUndoCapture(undoManager);

        // Make second edit (should be a separate stack item now)
        ydoc.transact(() => {
            ytext.insert(ytext.length, " second");
        }, "local");

        expect(ytext.toString()).toBe("first second");

        // First undo should only revert the second edit
        expect(undoManager.canUndo()).toBe(true);
        undoManager.undo();
        expect(ytext.toString()).toBe("first");

        // Second undo should revert the first edit
        expect(undoManager.canUndo()).toBe(true);
        undoManager.undo();
        expect(ytext.toString()).toBe("");

        // No more undo available
        expect(undoManager.canUndo()).toBe(false);
    });
});
