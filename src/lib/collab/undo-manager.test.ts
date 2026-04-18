/**
 * undo-manager.test.ts -- Y.UndoManager behavior matrix (Phase 8.5).
 *
 * Wave 0 scaffold. Tests will be wired in Plans 8.5b-02 (addToScope,
 * stack-item-popped) and 05 (chronological across scopes).
 */
import { describe, it } from "vitest";

describe("yjs undo manager", () => {
    it.todo("chronological across scopes");
    it.todo("nested local undo");
    it.todo("remote origin ignored");
    it.todo("auto-nav event emitted");
    it.todo("addToScope captures new type");
    it.todo("remote updates not captured");
});
