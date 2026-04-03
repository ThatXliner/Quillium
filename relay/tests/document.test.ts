import { describe, it, expect } from "vitest";
import { Document } from "../src/document.js";
import { Text, ChangeSet } from "@codemirror/state";

describe("Document", () => {
    it("starts at version 0 with given content", () => {
        const doc = new Document("hello");
        expect(doc.version).toBe(0);
        expect(doc.text.toString()).toBe("hello");
    });

    it("starts at a given version", () => {
        const doc = new Document("hello", 5);
        expect(doc.version).toBe(5);
    });

    it("applies an update and increments version", () => {
        const doc = new Document("hello");
        // Insert " world" at position 5
        const changes = ChangeSet.of({ from: 5, insert: " world" }, 5);
        const result = doc.applyUpdate(changes, "client-1", 0);
        expect(result).toBe(true);
        expect(doc.version).toBe(1);
        expect(doc.text.toString()).toBe("hello world");
    });

    it("rejects update with wrong base version", () => {
        const doc = new Document("hello");
        const changes = ChangeSet.of({ from: 5, insert: " world" }, 5);
        const result = doc.applyUpdate(changes, "client-1", 99);
        expect(result).toBe(false);
        expect(doc.version).toBe(0);
    });

    it("returns updates since a version", () => {
        const doc = new Document("hello");
        const changes1 = ChangeSet.of({ from: 5, insert: " world" }, 5);
        doc.applyUpdate(changes1, "client-1", 0);
        const changes2 = ChangeSet.of({ from: 11, insert: "!" }, 11);
        doc.applyUpdate(changes2, "client-2", 1);

        const since0 = doc.getUpdatesSince(0);
        expect(since0).toHaveLength(2);
        expect(since0[0].clientID).toBe("client-1");
        expect(since0[1].clientID).toBe("client-2");

        const since1 = doc.getUpdatesSince(1);
        expect(since1).toHaveLength(1);
        expect(since1[0].clientID).toBe("client-2");
    });

    it("tracks pending pull requests and resolves them on update", () => {
        const doc = new Document("hello");
        let resolved = false;
        doc.addPendingPull(0, () => { resolved = true; });
        expect(resolved).toBe(false);

        const changes = ChangeSet.of({ from: 5, insert: " world" }, 5);
        doc.applyUpdate(changes, "client-1", 0);
        expect(resolved).toBe(true);
    });
});
