// undoManagerEventNames.probe.test.ts - Wave 0 probe (A1) confirming Y.UndoManager event-name spelling.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

describe("Y.UndoManager event probes", () => {
    it("probe A1: Y.UndoManager stack-item event spelling", () => {
        const ydoc = new Y.Doc();
        const ytext = ydoc.getText("document");
        const undoManager = new Y.UndoManager(ytext, {
            trackedOrigins: new Set(["local"]),
        });
        const events = undoManager as unknown as {
            on(name: string, handler: () => void): void;
            off(name: string, handler: () => void): void;
        };
        const fired: string[] = [];
        const kebab = () => fired.push("stack-item-added");
        const camel = () => fired.push("stackItemAdded");

        events.on("stack-item-added", kebab);
        events.on("stackItemAdded", camel);

        try {
            ydoc.transact(() => ytext.insert(0, "x"), "local");
            expect(fired).toHaveLength(1);
            console.log("[probe-a1] event spelling:", fired[0]);
            expect(fired[0]).toBe("stack-item-added");
        } finally {
            events.off("stack-item-added", kebab);
            events.off("stackItemAdded", camel);
            ydoc.destroy();
        }
    });
});
