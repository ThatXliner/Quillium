/**
 * undo-manager.test.ts -- Y.UndoManager behavior matrix (Phase 8.5).
 *
 * Wave 0 scaffold. Tests wired by Plan 8.5b-02 (addToScope, stopCapturing).
 * Remaining todos implemented by Plans 8.5c-01 and 8.5c-02.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { addSubtreeToUndoScope, breakUndoCapture, createYjsUndoExtension } from "./yjsUndo";
import { AnnotationIdMap } from "./annotationSchema";
import { annotationEventBus, type EventOfType } from "$lib/editor/plugins/annotations/eventBus";
import { findOwningAnnotationId } from "./index";

describe("yjs undo manager", () => {
    it("chronological across scopes", () => {
        // Setup: main ytext + ymap, then a subtree Y.Text
        const ydoc = new Y.Doc();
        const ytext = ydoc.getText("content");
        const ymap = ydoc.getMap<unknown>("annotations");
        const { undoManager } = createYjsUndoExtension(ytext, ymap);

        // Create and register a subtree
        const subtree = new Y.Text();
        ydoc.getMap("subtrees").set("rev-1", subtree);
        addSubtreeToUndoScope(undoManager, subtree);

        // Edit 1: main ytext
        ydoc.transact(() => {
            ytext.insert(0, "main");
        }, "local");

        breakUndoCapture(undoManager);

        // Edit 2: subtree
        ydoc.transact(() => {
            subtree.insert(0, "nested");
        }, "local");

        expect(ytext.toString()).toBe("main");
        expect(subtree.toString()).toBe("nested");

        // Undo once → subtree edit reverts
        undoManager.undo();
        expect(ytext.toString()).toBe("main");
        expect(subtree.toString()).toBe("");

        // Undo again → main edit reverts
        undoManager.undo();
        expect(ytext.toString()).toBe("");
        expect(subtree.toString()).toBe("");
    });

    it("nested local undo", () => {
        // Two subtrees; undo respects chronological order
        const ydoc = new Y.Doc();
        const ytext = ydoc.getText("content");
        const ymap = ydoc.getMap<unknown>("annotations");
        const { undoManager } = createYjsUndoExtension(ytext, ymap);

        const subtree1 = new Y.Text();
        const subtree2 = new Y.Text();
        ydoc.getMap("subtrees").set("rev-1", subtree1);
        ydoc.getMap("subtrees").set("rev-2", subtree2);
        addSubtreeToUndoScope(undoManager, subtree1);
        addSubtreeToUndoScope(undoManager, subtree2);

        // Edit subtree1, then subtree2
        ydoc.transact(() => subtree1.insert(0, "first"), "local");
        breakUndoCapture(undoManager);
        ydoc.transact(() => subtree2.insert(0, "second"), "local");

        expect(subtree1.toString()).toBe("first");
        expect(subtree2.toString()).toBe("second");

        // Undo once → subtree2 reverts
        undoManager.undo();
        expect(subtree1.toString()).toBe("first");
        expect(subtree2.toString()).toBe("");

        // Undo again → subtree1 reverts
        undoManager.undo();
        expect(subtree1.toString()).toBe("");
        expect(subtree2.toString()).toBe("");
    });

    it("auto-nav event emitted", () => {
        // Setup doc-level ymap with a registered annotation node
        const ydoc = new Y.Doc();
        const ymap = ydoc.getMap<Y.Map<unknown>>("anns");
        const mainIdMap = new AnnotationIdMap();

        // Seed one revision annotation (CM id 42) with one version
        const node = new Y.Map<unknown>();
        const versions = new Y.Map<Y.Map<unknown>>();
        const v0 = new Y.Map<unknown>();
        const subtreeText = new Y.Text();
        v0.set("text", subtreeText);
        versions.set("0", v0);
        node.set("versions", versions);
        ymap.set("yjs-id-42", node);
        mainIdMap.register("yjs-id-42", 42);

        const undoManager = new Y.UndoManager([ymap], {
            trackedOrigins: new Set(["local"]),
        });
        addSubtreeToUndoScope(undoManager, subtreeText);

        // Subscribe to undo-target
        const received: EventOfType<"undo-target">[] = [];
        const unsub = annotationEventBus.on("undo-target", (e) => received.push(e));

        // Wire the listener directly (mirrors enableCollab's logic with deduplication)
        undoManager.on("stack-item-popped", (event) => {
            const emittedCmIds = new Set<number>();
            for (const yType of event.changedParentTypes.keys()) {
                const owning = findOwningAnnotationId(yType, ymap, mainIdMap);
                if (!owning) continue;
                if (emittedCmIds.has(owning.cmId)) continue;
                emittedCmIds.add(owning.cmId);
                annotationEventBus.emit({
                    type: "undo-target",
                    annotationId: owning.cmId,
                    versionIndex: owning.versionIndex,
                    undoType: event.type,
                });
            }
        });

        // Make a local edit
        ydoc.transact(() => subtreeText.insert(0, "hello"), "local");
        undoManager.undo();

        expect(received).toHaveLength(1);
        expect(received[0]).toMatchObject({ annotationId: 42, versionIndex: 0, undoType: "undo" });
        unsub();
    });

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
