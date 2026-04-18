/**
 * annotationSchema.test.ts -- Tests for Yjs annotation schema and bidirectional converters.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EditorSelection } from "@codemirror/state";
import * as Y from "yjs";
import {
    codeMirrorToYjsAnnotation,
    yjsAnnotationToCodeMirror,
    generateAnnotationId,
    AnnotationIdMap,
    YjsAnnotationSchema,
} from "./annotationSchema";
import type { GenericAnnotation } from "$lib/editor/plugins/annotations/models";

describe("annotationSchema", () => {
    let ydoc: Y.Doc;
    let ytext: Y.Text;
    const CLIENT_ID = "test-client";

    beforeEach(() => {
        ydoc = new Y.Doc();
        ytext = ydoc.getText("document");
        ytext.insert(0, "hello world");
    });

    afterEach(() => {
        ydoc.destroy();
    });

    describe("generateAnnotationId", () => {
        it("generates a string ID with client prefix", () => {
            const id = generateAnnotationId(CLIENT_ID);
            expect(id.startsWith(CLIENT_ID)).toBe(true);
        });

        it("generates unique IDs", () => {
            const id1 = generateAnnotationId(CLIENT_ID);
            const id2 = generateAnnotationId(CLIENT_ID);
            expect(id1).not.toBe(id2);
        });
    });

    describe("codeMirrorToYjsAnnotation", () => {
        it("converts a comment annotation", () => {
            const ann: GenericAnnotation = {
                id: 1,
                _type: "comment",
                selection: EditorSelection.single(0, 5),
                thread: [{ message: "test", author: "user", time: 1000 }],
            };

            const yjs = codeMirrorToYjsAnnotation(ann, ytext, CLIENT_ID);

            expect(yjs._type).toBe("comment");
            expect(yjs.startPos).toBeInstanceOf(Uint8Array);
            expect(yjs.endPos).toBeInstanceOf(Uint8Array);
            expect(yjs.id).toContain(CLIENT_ID);
            expect(JSON.parse(yjs.thread)).toEqual(ann.thread);
        });

        it("converts a suggestion annotation", () => {
            const ann: GenericAnnotation = {
                id: 2,
                _type: "suggestion",
                selection: EditorSelection.single(0, 5),
                thread: [],
                replacements: [{ text: "better", rationale: "clarity" }],
                author: "ai",
            };

            const yjs = codeMirrorToYjsAnnotation(ann, ytext, CLIENT_ID);

            expect(yjs._type).toBe("suggestion");
            expect(yjs.replacements).toBeDefined();
            expect(JSON.parse(yjs.replacements!)).toEqual(ann.replacements);
            expect(yjs.author).toBe("ai");
        });

        it("converts a revision annotation", () => {
            const ann: GenericAnnotation = {
                id: 3,
                _type: "revision",
                selection: EditorSelection.single(0, 5),
                thread: [],
                versions: [{ doc: "version text", label: "v1" }],
                activeVersionIndex: 0,
            };

            const yjs = codeMirrorToYjsAnnotation(ann, ytext, CLIENT_ID);

            expect(yjs._type).toBe("revision");
            expect(yjs.versions).toBeDefined();
            expect(JSON.parse(yjs.versions!)).toEqual(ann.versions);
            expect(yjs.activeVersionIndex).toBe(0);
        });
    });

    describe("yjsAnnotationToCodeMirror", () => {
        it("round-trips a comment annotation", () => {
            const ann: GenericAnnotation = {
                id: 1,
                _type: "comment",
                selection: EditorSelection.single(0, 5),
                thread: [{ message: "hello", author: "user", time: 1000 }],
            };

            const yjs = codeMirrorToYjsAnnotation(ann, ytext, CLIENT_ID);
            const restored = yjsAnnotationToCodeMirror(yjs, ydoc, ytext, 42);

            expect(restored).not.toBeNull();
            expect(restored!._type).toBe("comment");
            expect(restored!.id).toBe(42);
            expect(restored!.selection.main.from).toBe(0);
            expect(restored!.selection.main.to).toBe(5);
            expect(restored!.thread).toEqual(ann.thread);
        });

        it("round-trips a suggestion annotation", () => {
            const ann: GenericAnnotation = {
                id: 2,
                _type: "suggestion",
                selection: EditorSelection.single(6, 11),
                thread: [],
                replacements: [{ text: "world2" }],
                author: "ai",
            };

            const yjs = codeMirrorToYjsAnnotation(ann, ytext, CLIENT_ID);
            const restored = yjsAnnotationToCodeMirror(yjs, ydoc, ytext, 99);

            expect(restored).not.toBeNull();
            expect(restored!._type).toBe("suggestion");
            if (restored !== null && restored._type === "suggestion") {
                expect(restored.replacements).toEqual(ann.replacements);
                expect(restored.author).toBe("ai");
            }
        });

        it("round-trips a revision annotation", () => {
            const ann: GenericAnnotation = {
                id: 3,
                _type: "revision",
                selection: EditorSelection.single(0, 5),
                thread: [],
                versions: [{ doc: "v1 text" }],
                activeVersionIndex: 0,
            };

            const yjs = codeMirrorToYjsAnnotation(ann, ytext, CLIENT_ID);
            const restored = yjsAnnotationToCodeMirror(yjs, ydoc, ytext, 5);

            expect(restored).not.toBeNull();
            expect(restored!._type).toBe("revision");
            if (restored !== null && restored._type === "revision") {
                expect(restored.versions).toEqual(ann.versions);
                expect(restored.activeVersionIndex).toBe(0);
            }
        });

        it("returns null for malformed JSON in thread (T-08-02 safety)", () => {
            const yjs = {
                id: "x",
                _type: "comment" as const,
                startPos: new Uint8Array([]),
                endPos: new Uint8Array([]),
                thread: "not valid json {{{",
            };

            // Should not throw; returns null for bad data
            const result = yjsAnnotationToCodeMirror(yjs, ydoc, ytext, 1);
            expect(result).toBeNull();
        });
    });

    describe("YjsAnnotationSchema validation (T-08-01)", () => {
        it("validates a well-formed YjsAnnotation", () => {
            const valid = {
                id: "client-123",
                _type: "comment",
                startPos: new Uint8Array([1]),
                endPos: new Uint8Array([2]),
                thread: "[]",
            };
            const result = YjsAnnotationSchema.safeParse(valid);
            expect(result.success).toBe(true);
        });

        it("rejects missing required fields", () => {
            const invalid = { id: "x", _type: "comment" };
            const result = YjsAnnotationSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });

        it("rejects invalid _type values", () => {
            const invalid = {
                id: "x",
                _type: "unknown",
                startPos: new Uint8Array([1]),
                endPos: new Uint8Array([2]),
                thread: "[]",
            };
            const result = YjsAnnotationSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });
    });

    describe("AnnotationIdMap", () => {
        it("creates and retrieves CM IDs", () => {
            const map = new AnnotationIdMap();
            const cmId = map.getOrCreateCmId("yjs-id-1");
            expect(typeof cmId).toBe("number");
            expect(map.getOrCreateCmId("yjs-id-1")).toBe(cmId); // Same ID on second call
        });

        it("assigns different IDs for different Yjs IDs", () => {
            const map = new AnnotationIdMap();
            const id1 = map.getOrCreateCmId("yjs-a");
            const id2 = map.getOrCreateCmId("yjs-b");
            expect(id1).not.toBe(id2);
        });

        it("supports reverse lookup", () => {
            const map = new AnnotationIdMap();
            const cmId = map.getOrCreateCmId("yjs-id-x");
            expect(map.getYjsId(cmId)).toBe("yjs-id-x");
        });

        it("can register an existing CM ID", () => {
            const map = new AnnotationIdMap();
            map.register("yjs-id", 100);
            expect(map.getCmId("yjs-id")).toBe(100);
            expect(map.getYjsId(100)).toBe("yjs-id");
        });

        it("can remove a mapping", () => {
            const map = new AnnotationIdMap();
            map.register("yjs-id", 50);
            map.remove("yjs-id");
            expect(map.getCmId("yjs-id")).toBeUndefined();
            expect(map.getYjsId(50)).toBeUndefined();
        });

        it("clears all mappings", () => {
            const map = new AnnotationIdMap();
            map.register("a", 1);
            map.register("b", 2);
            map.clear();
            expect(map.getCmId("a")).toBeUndefined();
            expect(map.getCmId("b")).toBeUndefined();
        });
    });
});
