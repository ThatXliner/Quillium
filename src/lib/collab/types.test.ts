/**
 * types.test.ts -- Type smoke tests for YjsAnnotation and CollabSession types.
 *
 * These tests verify the shapes of the types at runtime using
 * object construction and field access.
 */
import { describe, it, expect } from "vitest";
import type { YjsAnnotation, CollabSession } from "./types";

describe("YjsAnnotation type", () => {
    it("can construct a comment YjsAnnotation", () => {
        const ann: YjsAnnotation = {
            id: "client-123-abc",
            _type: "comment",
            startPos: new Uint8Array([1, 2, 3]),
            endPos: new Uint8Array([4, 5, 6]),
            thread: JSON.stringify([{ message: "hello", author: "user", time: 1000 }]),
        };
        expect(ann.id).toBe("client-123-abc");
        expect(ann._type).toBe("comment");
        expect(ann.startPos).toBeInstanceOf(Uint8Array);
        expect(ann.endPos).toBeInstanceOf(Uint8Array);
    });

    it("can construct a suggestion YjsAnnotation with optional fields", () => {
        const ann: YjsAnnotation = {
            id: "client-456-def",
            _type: "suggestion",
            startPos: new Uint8Array([1]),
            endPos: new Uint8Array([2]),
            thread: "[]",
            replacements: JSON.stringify([{ text: "better word", rationale: "clarity" }]),
            author: "ai-assistant",
        };
        expect(ann._type).toBe("suggestion");
        expect(ann.replacements).toBeTruthy();
        expect(ann.author).toBe("ai-assistant");
    });

    it("can construct a revision YjsAnnotation with optional fields", () => {
        const ann: YjsAnnotation = {
            id: "client-789-ghi",
            _type: "revision",
            startPos: new Uint8Array([1]),
            endPos: new Uint8Array([2]),
            thread: "[]",
            versions: JSON.stringify([{ doc: "version 1 text", label: "v1" }]),
            activeVersionIndex: 0,
        };
        expect(ann._type).toBe("revision");
        expect(ann.versions).toBeTruthy();
        expect(ann.activeVersionIndex).toBe(0);
    });

    it("has no required optional fields for a plain comment", () => {
        // Should compile with only required fields
        const ann: YjsAnnotation = {
            id: "x",
            _type: "comment",
            startPos: new Uint8Array(0),
            endPos: new Uint8Array(0),
            thread: "[]",
        };
        expect(ann.replacements).toBeUndefined();
        expect(ann.author).toBeUndefined();
        expect(ann.versions).toBeUndefined();
        expect(ann.activeVersionIndex).toBeUndefined();
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
