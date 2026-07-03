import {
    AnnotationIdMap,
    codeMirrorToYjsAnnotation,
    generateAnnotationId,
    syncRawAnnotationsToYjsMap,
    yjsAnnotationToCodeMirror,
} from "$lib/collab/annotationSchema";
import type { YjsAnnotationNode } from "$lib/collab/types";
import {
    type GenericAnnotation,
    type RawAnnotations,
    type VersionState,
    activeVersionIndex,
    makeVersion,
} from "$lib/editor/plugins/annotations/models";
import type { ThreadMessage } from "$lib/editor/plugins/annotations/models";
import { EditorSelection } from "@codemirror/state";
/**
 * annotationSchema.test.ts -- Tests for Yjs annotation schema and bidirectional converters.
 *
 * Per D-90/D-92: YjsAnnotationNode is a recursive Y.Map structure with Y.Array for
 * threads and Y.Map for versions. Tests verify converters handle the new shape.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";

describe("annotationSchema", () => {
    let ydoc: Y.Doc;
    let ytext: Y.Text;
    let ymap: Y.Map<YjsAnnotationNode>;
    const CLIENT_ID = "test-client";

    beforeEach(() => {
        ydoc = new Y.Doc();
        ytext = ydoc.getText("document");
        ymap = ydoc.getMap<YjsAnnotationNode>("annotations");
        ydoc.transact(() => ytext.insert(0, "hello world"), "init");
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
        it("converts a comment annotation to recursive Y.Map", () => {
            const ann: GenericAnnotation = {
                id: 1,
                _type: "comment",
                selection: EditorSelection.single(0, 5),
                thread: [{ message: "test", author: "user", time: 1000 }],
            };

            const node = codeMirrorToYjsAnnotation(ann, ytext, CLIENT_ID, ydoc);
            // Integrate into ymap so we can read it
            ydoc.transact(() => ymap.set("test", node));
            const retrieved = ymap.get("test")!;

            expect(retrieved.get("_type")).toBe("comment");
            expect(retrieved.get("startPos")).toBeInstanceOf(Uint8Array);
            expect(retrieved.get("endPos")).toBeInstanceOf(Uint8Array);
            expect((retrieved.get("id") as string).includes(CLIENT_ID)).toBe(true);
            const threadArr = retrieved.get("thread") as Y.Array<ThreadMessage>;
            expect(threadArr).toBeInstanceOf(Y.Array);
            expect(threadArr.length).toBe(1);
            expect(threadArr.get(0).message).toBe("test");
        });

        it("converts a suggestion annotation to recursive Y.Map", () => {
            const ann: GenericAnnotation = {
                id: 2,
                _type: "suggestion",
                selection: EditorSelection.single(0, 5),
                thread: [],
                replacements: [{ text: "better", rationale: "clarity" }],
                author: "ai",
            };

            const node = codeMirrorToYjsAnnotation(ann, ytext, CLIENT_ID, ydoc);
            ydoc.transact(() => ymap.set("test", node));
            const retrieved = ymap.get("test")!;

            expect(retrieved.get("_type")).toBe("suggestion");
            const replacements = retrieved.get("replacements") as Y.Array<unknown>;
            expect(replacements).toBeInstanceOf(Y.Array);
            expect(replacements.length).toBe(1);
            expect((replacements.get(0) as { text: string }).text).toBe("better");
            expect(retrieved.get("author")).toBe("ai");
        });

        it("converts a revision annotation to recursive Y.Map with Y.Text versions", () => {
            const revVersion = makeVersion({ doc: "version text", label: "v1" });
            const ann: GenericAnnotation = {
                id: 3,
                _type: "revision",
                selection: EditorSelection.single(0, 5),
                thread: [],
                versions: [revVersion],
                activeVersionId: revVersion.id,
            };

            const node = codeMirrorToYjsAnnotation(ann, ytext, CLIENT_ID, ydoc);
            ydoc.transact(() => ymap.set("test", node));
            const retrieved = ymap.get("test")!;

            expect(retrieved.get("_type")).toBe("revision");
            const versions = retrieved.get("versions") as Y.Map<Y.Map<unknown>>;
            expect(versions).toBeInstanceOf(Y.Map);
            expect(versions.size).toBe(1);
            const order = retrieved.get("order") as Y.Array<string>;
            expect(order).toBeInstanceOf(Y.Array);
            expect(order.toArray()).toEqual([revVersion.id]);
            const v0 = versions.get(revVersion.id) as Y.Map<unknown>;
            expect(v0.get("id")).toBe(revVersion.id);
            expect(v0.get("text")).toBeInstanceOf(Y.Text);
            expect((v0.get("text") as Y.Text).toString()).toBe("version text");
            expect(v0.get("label")).toBe("v1");
            expect(retrieved.get("activeVersionId")).toBe(revVersion.id);
            expect(retrieved.get("activeVersionIndex")).toBeUndefined();
        });

        it("syncs nested annotations inside integrated revision versions", () => {
            const nestedAnnotations: RawAnnotations = {
                "0": {
                    id: 0,
                    _type: "comment",
                    selection: EditorSelection.single(0, 7).toJSON(),
                    thread: [],
                },
            };
            const version = {
                ...makeVersion({ doc: "version text" }),
                annotationField: nestedAnnotations,
            } as VersionState & { annotationField: RawAnnotations };
            const ann: GenericAnnotation = {
                id: 3,
                _type: "revision",
                selection: EditorSelection.single(0, 5),
                thread: [],
                versions: [version],
                activeVersionId: version.id,
            };

            const node = codeMirrorToYjsAnnotation(ann, ytext, CLIENT_ID, ydoc);
            ydoc.transact(() => ymap.set("test", node));
            const retrieved = ymap.get("test")!;
            const versions = retrieved.get("versions") as Y.Map<Y.Map<unknown>>;
            const v0 = versions.get(version.id) as Y.Map<unknown>;
            const nestedMap = v0.get("annotations") as Y.Map<YjsAnnotationNode>;
            const vtext = v0.get("text") as Y.Text;

            expect(nestedMap).toBeInstanceOf(Y.Map);
            expect(nestedMap.size).toBe(0);

            syncRawAnnotationsToYjsMap(
                nestedAnnotations,
                nestedMap,
                vtext,
                CLIENT_ID,
                ydoc,
                new AnnotationIdMap(),
            );
            expect(nestedMap.size).toBe(1);
        });

        it("normalizes legacy raw revisions before syncing them to Yjs", () => {
            const legacyAnnotations: RawAnnotations = {
                "0": {
                    id: 0,
                    _type: "revision",
                    selection: EditorSelection.single(0, 5).toJSON(),
                    thread: [],
                    activeVersionIndex: 1,
                    versions: [{ doc: "hello" }, { doc: "hullo" }],
                },
            };

            syncRawAnnotationsToYjsMap(
                legacyAnnotations,
                ymap,
                ytext,
                CLIENT_ID,
                ydoc,
                new AnnotationIdMap(),
            );

            const node = Array.from(ymap.values())[0];
            expect(node.get("_type")).toBe("revision");
            expect(node.get("activeVersionIndex")).toBeUndefined();
            const activeVersionId = node.get("activeVersionId");
            expect(typeof activeVersionId).toBe("string");
            const versions = node.get("versions") as Y.Map<Y.Map<unknown>>;
            expect(versions.size).toBe(2);
            const order = node.get("order") as Y.Array<string>;
            expect(order).toBeInstanceOf(Y.Array);
            expect(order.length).toBe(2);
            expect(activeVersionId).toBe(order.get(1));
            for (const versionId of order.toArray()) {
                expect(versions.get(versionId)).toBeInstanceOf(Y.Map);
            }
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

            const node = codeMirrorToYjsAnnotation(ann, ytext, CLIENT_ID, ydoc);
            ydoc.transact(() => ymap.set("test", node));
            const retrieved = ymap.get("test")!;
            const restored = yjsAnnotationToCodeMirror(retrieved, ydoc, ytext, 42);

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

            const node = codeMirrorToYjsAnnotation(ann, ytext, CLIENT_ID, ydoc);
            ydoc.transact(() => ymap.set("test", node));
            const retrieved = ymap.get("test")!;
            const restored = yjsAnnotationToCodeMirror(retrieved, ydoc, ytext, 99);

            expect(restored).not.toBeNull();
            expect(restored!._type).toBe("suggestion");
            if (restored !== null && restored._type === "suggestion") {
                expect(restored.replacements).toEqual(ann.replacements);
                expect(restored.author).toBe("ai");
            }
        });

        it("round-trips a revision annotation", () => {
            const roundtripVersion = makeVersion({ doc: "v1 text" });
            const ann: GenericAnnotation = {
                id: 3,
                _type: "revision",
                selection: EditorSelection.single(0, 5),
                thread: [],
                versions: [roundtripVersion],
                activeVersionId: roundtripVersion.id,
            };

            const node = codeMirrorToYjsAnnotation(ann, ytext, CLIENT_ID, ydoc);
            ydoc.transact(() => ymap.set("test", node));
            const retrieved = ymap.get("test")!;
            const restored = yjsAnnotationToCodeMirror(retrieved, ydoc, ytext, 5);

            expect(restored).not.toBeNull();
            expect(restored!._type).toBe("revision");
            if (restored !== null && restored._type === "revision") {
                expect(restored.versions[0].doc).toBe("v1 text");
                expect(activeVersionIndex(restored)).toBe(0);
            }
        });

        it("round-trips nested annotations inside revision versions", () => {
            const nestedAnnotations: RawAnnotations = {
                "0": {
                    id: 0,
                    _type: "comment",
                    selection: EditorSelection.single(0, 2).toJSON(),
                    thread: [],
                },
            };
            const version = {
                ...makeVersion({ doc: "v1 text" }),
                annotationField: nestedAnnotations,
            } as VersionState & { annotationField: RawAnnotations };
            const ann: GenericAnnotation = {
                id: 3,
                _type: "revision",
                selection: EditorSelection.single(0, 5),
                thread: [],
                versions: [version],
                activeVersionId: version.id,
            };

            const idMap = new AnnotationIdMap();
            const node = codeMirrorToYjsAnnotation(ann, ytext, CLIENT_ID, ydoc);
            ydoc.transact(() => ymap.set("test", node));
            const retrieved = ymap.get("test")!;
            const versions = retrieved.get("versions") as Y.Map<Y.Map<unknown>>;
            const v0 = versions.get(version.id) as Y.Map<unknown>;
            syncRawAnnotationsToYjsMap(
                nestedAnnotations,
                v0.get("annotations") as Y.Map<YjsAnnotationNode>,
                v0.get("text") as Y.Text,
                CLIENT_ID,
                ydoc,
                idMap,
            );
            const restored = yjsAnnotationToCodeMirror(retrieved, ydoc, ytext, 5, {
                nestedIdMapFor: () => idMap,
            });

            expect(restored).not.toBeNull();
            expect(restored!._type).toBe("revision");
            if (restored !== null && restored._type === "revision") {
                const restoredField = (
                    restored.versions[0] as VersionState & { annotationField?: RawAnnotations }
                ).annotationField;
                expect(restoredField?.["0"]?._type).toBe("comment");
                expect(restoredField?.["0"]?.selection).toEqual(
                    EditorSelection.single(0, 2).toJSON(),
                );
            }
        });

        it("returns null for malformed node (missing positions)", () => {
            const node = new Y.Map<unknown>();
            ydoc.transact(() => {
                node.set("id", "x");
                node.set("_type", "comment");
                // Missing startPos and endPos
                node.set("thread", new Y.Array());
                ymap.set("test", node as YjsAnnotationNode);
            });

            const retrieved = ymap.get("test")!;
            const result = yjsAnnotationToCodeMirror(retrieved, ydoc, ytext, 1);
            expect(result).toBeNull();
        });

        it("returns null for unknown _type", () => {
            const node = new Y.Map<unknown>();
            ydoc.transact(() => {
                node.set("id", "x");
                node.set("_type", "unknown_type");
                const startRel = Y.createRelativePositionFromTypeIndex(ytext, 0);
                const endRel = Y.createRelativePositionFromTypeIndex(ytext, 5);
                node.set("startPos", Y.encodeRelativePosition(startRel));
                node.set("endPos", Y.encodeRelativePosition(endRel));
                node.set("thread", new Y.Array());
                ymap.set("test", node as YjsAnnotationNode);
            });

            const retrieved = ymap.get("test")!;
            const result = yjsAnnotationToCodeMirror(retrieved, ydoc, ytext, 1);
            expect(result).toBeNull();
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
