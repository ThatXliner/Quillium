/**
 * types.test.ts -- Type smoke tests for YjsAnnotationNode and CollabSession types.
 *
 * Per D-90/D-92: YjsAnnotationNode is now a recursive Y.Map structure.
 * These tests verify the shapes of the types at runtime using Y.Map construction.
 */
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import type { YjsAnnotationNode, CollabSession, MessageObject } from "./types";

describe("YjsAnnotationNode type", () => {
    it("can construct a comment YjsAnnotationNode", () => {
        const ydoc = new Y.Doc();
        const ymap = ydoc.getMap<YjsAnnotationNode>("annotations");

        const node = new Y.Map<unknown>();
        ydoc.transact(() => {
            node.set("id", "client-123-abc");
            node.set("_type", "comment");
            node.set("startPos", new Uint8Array([1, 2, 3]));
            node.set("endPos", new Uint8Array([4, 5, 6]));
            const thread = new Y.Array<MessageObject>();
            thread.push([{ message: "hello", author: "user", time: 1000 }]);
            node.set("thread", thread);
            node.set("annotations", new Y.Map<YjsAnnotationNode>());
            ymap.set("test", node as YjsAnnotationNode);
        });

        const retrieved = ymap.get("test")!;
        expect(retrieved.get("id")).toBe("client-123-abc");
        expect(retrieved.get("_type")).toBe("comment");
        expect(retrieved.get("startPos")).toBeInstanceOf(Uint8Array);
        expect(retrieved.get("endPos")).toBeInstanceOf(Uint8Array);
        expect(retrieved.get("thread")).toBeInstanceOf(Y.Array);
        expect(retrieved.get("annotations")).toBeInstanceOf(Y.Map);

        ydoc.destroy();
    });

    it("can construct a suggestion YjsAnnotationNode with optional fields", () => {
        const ydoc = new Y.Doc();
        const ymap = ydoc.getMap<YjsAnnotationNode>("annotations");

        const node = new Y.Map<unknown>();
        ydoc.transact(() => {
            node.set("id", "client-456-def");
            node.set("_type", "suggestion");
            node.set("startPos", new Uint8Array([1]));
            node.set("endPos", new Uint8Array([2]));
            node.set("thread", new Y.Array<MessageObject>());
            node.set("annotations", new Y.Map<YjsAnnotationNode>());
            const replacements = new Y.Array<{ text: string; rationale?: string }>();
            replacements.push([{ text: "better word", rationale: "clarity" }]);
            node.set("replacements", replacements);
            node.set("author", "ai-assistant");
            ymap.set("test", node as YjsAnnotationNode);
        });

        const retrieved = ymap.get("test")!;
        expect(retrieved.get("_type")).toBe("suggestion");
        expect(retrieved.get("replacements")).toBeInstanceOf(Y.Array);
        expect(retrieved.get("author")).toBe("ai-assistant");

        ydoc.destroy();
    });

    it("can construct a revision YjsAnnotationNode with optional fields", () => {
        const ydoc = new Y.Doc();
        const ymap = ydoc.getMap<YjsAnnotationNode>("annotations");

        const node = new Y.Map<unknown>();
        ydoc.transact(() => {
            node.set("id", "client-789-ghi");
            node.set("_type", "revision");
            node.set("startPos", new Uint8Array([1]));
            node.set("endPos", new Uint8Array([2]));
            node.set("thread", new Y.Array<MessageObject>());
            node.set("annotations", new Y.Map<YjsAnnotationNode>());

            const versions = new Y.Map<Y.Map<unknown>>();
            const v0 = new Y.Map<unknown>();
            const v0Text = new Y.Text();
            v0Text.insert(0, "version 1 text");
            v0.set("text", v0Text);
            v0.set("label", "v1");
            v0.set("annotations", new Y.Map<YjsAnnotationNode>());
            versions.set("0", v0);
            node.set("versions", versions);
            node.set("activeVersionIndex", 0);

            ymap.set("test", node as YjsAnnotationNode);
        });

        const retrieved = ymap.get("test")!;
        expect(retrieved.get("_type")).toBe("revision");
        expect(retrieved.get("versions")).toBeInstanceOf(Y.Map);
        expect(retrieved.get("activeVersionIndex")).toBe(0);

        const versions = retrieved.get("versions") as Y.Map<Y.Map<unknown>>;
        const v0 = versions.get("0") as Y.Map<unknown>;
        expect(v0.get("text")).toBeInstanceOf(Y.Text);
        expect((v0.get("text") as Y.Text).toString()).toBe("version 1 text");

        ydoc.destroy();
    });

    it("comment has thread as Y.Array and annotations as Y.Map", () => {
        const ydoc = new Y.Doc();
        const ymap = ydoc.getMap<YjsAnnotationNode>("annotations");

        const node = new Y.Map<unknown>();
        ydoc.transact(() => {
            node.set("id", "x");
            node.set("_type", "comment");
            node.set("startPos", new Uint8Array(0));
            node.set("endPos", new Uint8Array(0));
            node.set("thread", new Y.Array<MessageObject>());
            node.set("annotations", new Y.Map<YjsAnnotationNode>());
            ymap.set("test", node as YjsAnnotationNode);
        });

        const retrieved = ymap.get("test")!;
        expect(retrieved.get("thread")).toBeInstanceOf(Y.Array);
        expect(retrieved.get("annotations")).toBeInstanceOf(Y.Map);
        // Optional fields are undefined when not set
        expect(retrieved.get("replacements")).toBeUndefined();
        expect(retrieved.get("author")).toBeUndefined();
        expect(retrieved.get("versions")).toBeUndefined();
        expect(retrieved.get("activeVersionIndex")).toBeUndefined();

        ydoc.destroy();
    });
});

describe("CollabSession ymap field", () => {
    it("CollabSession type includes ymap field (type-level check)", () => {
        // Verify ymap is part of the type by checking the keys
        // This is a structural check using TypeScript's type system at compile time.
        // At runtime we just verify the type is exported correctly.
        type HasYmap = CollabSession extends { ymap: unknown } ? true : false;
        const result: HasYmap = true;
        expect(result).toBe(true);
    });
});
