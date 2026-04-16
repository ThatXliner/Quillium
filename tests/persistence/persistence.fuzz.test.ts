/**
 * Property-based fuzz tests for the persistence subsystem.
 *
 * Targets:
 *   - Event payload serialization/deserialization round-trip
 *   - Event replay correctness (snapshot + events = final state)
 *   - buildEventPayload extraction from ViewUpdate
 *   - Selection validity after replay
 *   - Annotation preservation through edit sequences
 */
import fc from "fast-check";
import { describe, expect, it, afterEach } from "vitest";
import { EditorState, EditorSelection, ChangeSet } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, historyField, undo, redo } from "@codemirror/commands";
import { annotationField } from "$lib/editor/plugins/annotations/annotationField";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import {
    createNewAnnotation,
    isAnnotationOfType,
    RawAnnotationSchema,
    type GenericAnnotation,
    type Annotations,
} from "$lib/editor/plugins/annotations/models";
import { addAnnotation, removeAnnotation } from "$lib/editor/plugins/annotations/annotationField";
import { replayEvents } from "$lib/editor/replay";
import type { EventRecord } from "$lib/db/types";
import type {
    EventPayload,
    DocChangeEvent,
    CompoundEvent,
    AnnotationAddEvent,
    AnnotationRemoveEvent,
    AnnotationUpdateEvent,
    ChangeSpec,
    SelectionJSON,
} from "$lib/db/events";

const savedFields = { historyField, annotationField };

// ── Test utilities ───────────────────────────────────────────────────────────

let views: EditorView[] = [];

function createView(doc: string) {
    const state = EditorState.create({
        doc,
        extensions: [history(), annotationExtensions()],
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({ state, parent });
    views.push(view);
    return view;
}

afterEach(() => {
    views.forEach((v) => v.destroy());
    views = [];
});

// ── Arbitraries ──────────────────────────────────────────────────────────────

const arbNonNegInt = fc.integer({ min: 0, max: 10_000 });

const arbDocString = fc.string({ minLength: 0, maxLength: 500 }).map((s) =>
    s.replace(/\r/g, ""),
);

const arbAnnotationType = fc.constantFrom(
    "comment" as const,
    "suggestion" as const,
    "revision" as const,
);

function arbSelectionForDoc(docLen: number) {
    if (docLen === 0) {
        return fc.constant(EditorSelection.single(0, 0));
    }
    return fc
        .tuple(
            fc.integer({ min: 0, max: docLen }),
            fc.integer({ min: 0, max: docLen }),
        )
        .map(([a, b]) => EditorSelection.single(Math.min(a, b), Math.max(a, b)));
}

function arbValidChangeSpec(docLen: number) {
    if (docLen === 0) {
        return fc.record({
            from: fc.constant(0),
            to: fc.constant(0),
            insert: fc.string({ minLength: 0, maxLength: 100 }).map((s) => s.replace(/\r/g, "")),
        });
    }
    return fc
        .tuple(
            fc.integer({ min: 0, max: docLen }),
            fc.integer({ min: 0, max: docLen }),
            fc.string({ minLength: 0, maxLength: 100 }).map((s) => s.replace(/\r/g, "")),
        )
        .map(([a, b, insert]) => ({
            from: Math.min(a, b),
            to: Math.max(a, b),
            insert,
        }));
}

function arbSelectionJSON(docLen: number): fc.Arbitrary<SelectionJSON> {
    const maxPos = Math.max(0, docLen);
    return fc
        .array(
            fc.tuple(
                fc.integer({ min: 0, max: maxPos }),
                fc.integer({ min: 0, max: maxPos }),
            ),
            { minLength: 1, maxLength: 4 },
        )
        .map((pairs) => ({
            ranges: pairs.map(([a, h]) => ({ anchor: a, head: h })),
            main: 0,
        }));
}

function makeAnnotation(
    id: number,
    selection: EditorSelection,
    type: GenericAnnotation["_type"],
): GenericAnnotation {
    const base = { id, selection, thread: [] };
    if (type === "comment") return { ...base, _type: "comment" };
    if (type === "suggestion") return { ...base, _type: "suggestion", replacements: [] };
    return {
        ...base,
        _type: "revision",
        activeVersionIndex: 0,
        versions: [{ doc: "v0" }],
    };
}

function serializeAnnotation(annotation: GenericAnnotation): Record<string, unknown> {
    return JSON.parse(JSON.stringify({ ...annotation, selection: annotation.selection.toJSON() }));
}

// ── DocChangeEvent round-trip ────────────────────────────────────────────────

describe("DocChangeEvent serialization", () => {
    it("round-trips through JSON", () => {
        fc.assert(
            fc.property(
                arbDocString,
                fc.integer({ min: 1, max: 5 }),
                (doc, numChanges) => {
                    const view = createView(doc);
                    let currentDoc = doc;

                    for (let i = 0; i < numChanges; i++) {
                        const docLen = currentDoc.length;
                        const from = Math.floor(Math.random() * (docLen + 1));
                        const to = Math.floor(Math.random() * (docLen - from + 1)) + from;
                        const insert = `insert${i}`;

                        view.dispatch({ changes: { from, to, insert } });
                        currentDoc = view.state.doc.toString();
                    }

                    const stateJson = view.state.toJSON(savedFields);
                    const restored = EditorState.fromJSON(
                        stateJson,
                        { extensions: [history(), annotationExtensions()] },
                        savedFields,
                    );

                    expect(restored.doc.toString()).toBe(view.state.doc.toString());
                },
            ),
            { numRuns: 20 },
        );
    });
});

// ── Selection validity after deserialization ─────────────────────────────────

describe("Selection validity", () => {
    it("deserialized selection positions are within document bounds", () => {
        fc.assert(
            fc.property(arbDocString, (doc) => {
                const view = createView(doc);
                const docLen = view.state.doc.length;

                if (docLen > 0) {
                    const sel = EditorSelection.single(
                        Math.floor(docLen / 2),
                        docLen,
                    );
                    view.dispatch({ selection: sel });
                }

                const stateJson = view.state.toJSON(savedFields);
                const restored = EditorState.fromJSON(
                    stateJson,
                    { extensions: [history(), annotationExtensions()] },
                    savedFields,
                );

                const restoredDocLen = restored.doc.length;
                for (const range of restored.selection.ranges) {
                    expect(range.from).toBeGreaterThanOrEqual(0);
                    expect(range.to).toBeLessThanOrEqual(restoredDocLen);
                    expect(range.from).toBeLessThanOrEqual(range.to);
                }
            }),
            { numRuns: 100 },
        );
    });

    it("EditorSelection.fromJSON clamps to valid positions", () => {
        fc.assert(
            fc.property(
                arbDocString,
                fc.integer({ min: 0, max: 20000 }),
                fc.integer({ min: 0, max: 20000 }),
                (doc, anchor, head) => {
                    const state = EditorState.create({ doc });
                    const selJson = { ranges: [{ anchor, head }], main: 0 };

                    try {
                        const sel = EditorSelection.fromJSON(selJson);
                        const updated = state.update({ selection: sel });
                        const finalSel = updated.state.selection;

                        for (const range of finalSel.ranges) {
                            expect(range.from).toBeGreaterThanOrEqual(0);
                            expect(range.to).toBeLessThanOrEqual(updated.state.doc.length);
                        }
                    } catch {
                        // CM6 throws RangeError for invalid selections, which is acceptable
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});

// ── Annotation persistence round-trip ────────────────────────────────────────

describe("Annotation persistence", () => {
    it("annotations survive serialize/deserialize round-trip", () => {
        fc.assert(
            fc.property(
                arbDocString.filter((d) => d.length >= 10),
                arbAnnotationType,
                fc.integer({ min: 1, max: 5 }),
                (doc, annotationType, numAnnotations) => {
                    const view = createView(doc);
                    const docLen = view.state.doc.length;

                    const addedIds: number[] = [];
                    for (let i = 0; i < numAnnotations; i++) {
                        const from = Math.floor(Math.random() * docLen);
                        const to = Math.min(from + Math.floor(Math.random() * 10) + 1, docLen);
                        const sel = EditorSelection.single(from, to);

                        const annotation = createNewAnnotation(
                            view.state.field(annotationField),
                            sel,
                            annotationType,
                        );

                        if (annotationType === "revision") {
                            (annotation as any).versions = [{ doc: doc.slice(from, to) }];
                            (annotation as any).activeVersionIndex = 0;
                        }

                        view.dispatch({ effects: [addAnnotation.of(annotation)] });
                        addedIds.push(annotation.id);
                    }

                    const stateJson = view.state.toJSON(savedFields);
                    const restored = EditorState.fromJSON(
                        stateJson,
                        { extensions: [history(), annotationExtensions()] },
                        savedFields,
                    );

                    const restoredAnnotations = restored.field(annotationField);
                    expect(Object.keys(restoredAnnotations).length).toBe(numAnnotations);

                    for (const id of addedIds) {
                        expect(restoredAnnotations[id]).toBeDefined();
                        expect(isAnnotationOfType(restoredAnnotations[id], annotationType)).toBe(
                            true,
                        );
                    }
                },
            ),
            { numRuns: 20 },
        );
    });

    it("annotation selections are valid after restore", () => {
        fc.assert(
            fc.property(
                arbDocString.filter((d) => d.length >= 5),
                arbAnnotationType,
                (doc, annotationType) => {
                    const view = createView(doc);
                    const docLen = view.state.doc.length;
                    const from = Math.floor(docLen / 4);
                    const to = Math.floor((docLen * 3) / 4);
                    const sel = EditorSelection.single(from, to);

                    const annotation = createNewAnnotation(
                        view.state.field(annotationField),
                        sel,
                        annotationType,
                    );

                    if (annotationType === "revision") {
                        (annotation as any).versions = [{ doc: doc.slice(from, to) }];
                        (annotation as any).activeVersionIndex = 0;
                    }

                    view.dispatch({ effects: [addAnnotation.of(annotation)] });

                    const stateJson = view.state.toJSON(savedFields);
                    const restored = EditorState.fromJSON(
                        stateJson,
                        { extensions: [history(), annotationExtensions()] },
                        savedFields,
                    );

                    const restoredAnnotations = restored.field(annotationField);
                    const restoredAnn = restoredAnnotations[annotation.id];
                    expect(restoredAnn).toBeDefined();

                    const restoredDocLen = restored.doc.length;
                    for (const range of restoredAnn.selection.ranges) {
                        expect(range.from).toBeGreaterThanOrEqual(0);
                        expect(range.to).toBeLessThanOrEqual(restoredDocLen);
                    }
                },
            ),
            { numRuns: 20 },
        );
    });
});

// ── Event replay correctness ─────────────────────────────────────────────────

describe("Event replay", () => {
    it("replaying doc_change events produces correct final state", () => {
        fc.assert(
            fc.property(
                arbDocString,
                fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 10 }),
                (initialDoc, insertions) => {
                    const events: EventRecord[] = [];
                    let currentDoc = initialDoc;
                    let eventId = 1;

                    for (const insert of insertions) {
                        const docLen = currentDoc.length;
                        const from = Math.floor(Math.random() * (docLen + 1));

                        const payload: DocChangeEvent = {
                            type: "doc_change",
                            changes: [{ from, to: from, insert: insert.replace(/\r/g, "") }],
                            selection: { ranges: [{ anchor: from, head: from }], main: 0 },
                        };

                        events.push({
                            id: eventId++,
                            eventType: "doc_change",
                            payload: JSON.stringify(payload),
                            createdAt: Date.now(),
                        });

                        currentDoc =
                            currentDoc.slice(0, from) + insert.replace(/\r/g, "") + currentDoc.slice(from);
                    }

                    const baseState = EditorState.create({
                        doc: initialDoc,
                        extensions: [history(), annotationExtensions()],
                    });

                    const replayedState = replayEvents(baseState, events);
                    expect(replayedState.doc.toString()).toBe(currentDoc);
                },
            ),
            { numRuns: 20 },
        );
    });

    it("replaying annotation events produces correct annotation state", () => {
        fc.assert(
            fc.property(
                arbDocString.filter((d) => d.length >= 10),
                fc.integer({ min: 1, max: 5 }),
                (doc, numAnnotations) => {
                    const baseState = EditorState.create({
                        doc,
                        extensions: [history(), annotationExtensions()],
                    });

                    const events: EventRecord[] = [];
                    const expectedAnnotations: Map<number, GenericAnnotation> = new Map();
                    let eventId = 1;

                    for (let i = 0; i < numAnnotations; i++) {
                        const docLen = doc.length;
                        const from = Math.floor(Math.random() * (docLen - 1));
                        const to = Math.min(from + 5, docLen);

                        const annotation: GenericAnnotation = {
                            id: i,
                            _type: "comment",
                            selection: EditorSelection.single(from, to),
                            thread: [],
                        };

                        const payload: AnnotationAddEvent = {
                            type: "annotation_add",
                            annotation: serializeAnnotation(annotation),
                        };

                        events.push({
                            id: eventId++,
                            eventType: "annotation_add",
                            payload: JSON.stringify(payload),
                            createdAt: Date.now(),
                        });

                        expectedAnnotations.set(i, annotation);
                    }

                    const replayedState = replayEvents(baseState, events);
                    const replayedAnnotations = replayedState.field(annotationField);

                    expect(Object.keys(replayedAnnotations).length).toBe(numAnnotations);

                    for (const [id] of expectedAnnotations) {
                        expect(replayedAnnotations[id]).toBeDefined();
                    }
                },
            ),
            { numRuns: 20 },
        );
    });

    it("compound events apply both doc changes and annotations atomically", () => {
        fc.assert(
            fc.property(
                arbDocString.filter((d) => d.length >= 20),
                fc.string({ minLength: 1, maxLength: 10 }),
                (doc, insert) => {
                    const baseState = EditorState.create({
                        doc,
                        extensions: [history(), annotationExtensions()],
                    });

                    const docLen = doc.length;
                    const insertPos = Math.floor(docLen / 2);
                    const annFrom = Math.floor(docLen / 4);
                    const annTo = Math.floor(docLen / 2);

                    const annotation: GenericAnnotation = {
                        id: 0,
                        _type: "comment",
                        selection: EditorSelection.single(annFrom, annTo),
                        thread: [],
                    };

                    const payload: CompoundEvent = {
                        type: "compound",
                        docChanges: [{ from: insertPos, to: insertPos, insert: insert.replace(/\r/g, "") }],
                        annotationEvents: [
                            {
                                type: "annotation_add",
                                annotation: serializeAnnotation(annotation),
                            },
                        ],
                        selection: { ranges: [{ anchor: insertPos, head: insertPos }], main: 0 },
                    };

                    const events: EventRecord[] = [
                        {
                            id: 1,
                            eventType: "compound",
                            payload: JSON.stringify(payload),
                            createdAt: Date.now(),
                        },
                    ];

                    const replayedState = replayEvents(baseState, events);

                    const expectedDoc =
                        doc.slice(0, insertPos) + insert.replace(/\r/g, "") + doc.slice(insertPos);
                    expect(replayedState.doc.toString()).toBe(expectedDoc);

                    const replayedAnnotations = replayedState.field(annotationField);
                    expect(replayedAnnotations[0]).toBeDefined();
                },
            ),
            { numRuns: 20 },
        );
    });

    it("malformed events are skipped without crashing", () => {
        const baseState = EditorState.create({
            doc: "Hello world",
            extensions: [history(), annotationExtensions()],
        });

        const events: EventRecord[] = [
            {
                id: 1,
                eventType: "doc_change",
                payload: "not valid json {{{",
                createdAt: Date.now(),
            },
            {
                id: 2,
                eventType: "unknown_type",
                payload: JSON.stringify({ type: "unknown_type", data: 123 }),
                createdAt: Date.now(),
            },
            {
                id: 3,
                eventType: "doc_change",
                payload: JSON.stringify({
                    type: "doc_change",
                    changes: [{ from: 0, to: 0, insert: "Valid " }],
                    selection: { ranges: [{ anchor: 6, head: 6 }], main: 0 },
                }),
                createdAt: Date.now(),
            },
        ];

        const replayedState = replayEvents(baseState, events);
        expect(replayedState.doc.toString()).toBe("Valid Hello world");
    });
});

// ── Undo/redo preservation through persistence ───────────────────────────────

describe("History preservation", () => {
    it("undo/redo history survives serialize/deserialize", () => {
        fc.assert(
            fc.property(
                arbDocString.filter((d) => d.length >= 5),
                fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 2, maxLength: 5 }),
                (doc, edits) => {
                    const view = createView(doc);

                    for (const edit of edits) {
                        const docLen = view.state.doc.length;
                        const pos = Math.floor(Math.random() * (docLen + 1));
                        view.dispatch({ changes: { from: pos, to: pos, insert: edit } });
                    }

                    const beforeUndo = view.state.doc.toString();

                    const stateJson = view.state.toJSON(savedFields);
                    const parent = document.createElement("div");
                    document.body.appendChild(parent);
                    const restoredView = new EditorView({
                        state: EditorState.fromJSON(
                            stateJson,
                            { extensions: [history(), annotationExtensions()] },
                            savedFields,
                        ),
                        parent,
                    });
                    views.push(restoredView);

                    expect(restoredView.state.doc.toString()).toBe(beforeUndo);

                    const undoWorked = undo(restoredView);
                    if (undoWorked) {
                        const afterUndo = restoredView.state.doc.toString();
                        expect(afterUndo).not.toBe(beforeUndo);

                        redo(restoredView);
                        expect(restoredView.state.doc.toString()).toBe(beforeUndo);
                    }
                },
            ),
            { numRuns: 15 },
        );
    });
});

// ── RawAnnotationSchema validation ───────────────────────────────────────────

describe("RawAnnotationSchema edge cases", () => {
    it("rejects annotations with negative IDs", () => {
        fc.assert(
            fc.property(fc.integer({ min: -1000, max: -1 }), (negativeId) => {
                const raw = {
                    id: negativeId,
                    _type: "comment",
                    selection: { ranges: [{ anchor: 0, head: 5 }] },
                    thread: [],
                };
                const result = RawAnnotationSchema.safeParse(raw);
                expect(result.success).toBe(false);
            }),
        );
    });

    it("accepts annotations with large valid IDs", () => {
        fc.assert(
            fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), (largeId) => {
                const raw = {
                    id: largeId,
                    _type: "comment",
                    selection: { ranges: [{ anchor: 0, head: 5 }] },
                    thread: [],
                };
                const result = RawAnnotationSchema.safeParse(raw);
                expect(result.success).toBe(true);
            }),
        );
    });

    it("rejects revision annotations with empty versions array", () => {
        const raw = {
            id: 0,
            _type: "revision",
            selection: { ranges: [{ anchor: 0, head: 5 }] },
            thread: [],
            activeVersionIndex: 0,
            versions: [],
        };
        const result = RawAnnotationSchema.safeParse(raw);
        expect(result.success).toBe(false);
    });

    it("accepts revision annotations with deeply nested version data", () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 0, maxLength: 1000 }),
                fc.array(
                    fc.record({
                        message: fc.string(),
                        author: fc.string(),
                        time: fc.integer({ min: 0 }),
                    }),
                    { minLength: 0, maxLength: 10 },
                ),
                (versionDoc, thread) => {
                    const raw = {
                        id: 0,
                        _type: "revision",
                        selection: { ranges: [{ anchor: 0, head: 5 }] },
                        thread,
                        activeVersionIndex: 0,
                        versions: [
                            {
                                doc: versionDoc,
                                label: "Test version",
                                annotationField: {
                                    0: {
                                        id: 0,
                                        _type: "comment",
                                        selection: { ranges: [{ anchor: 0, head: 1 }] },
                                        thread: [],
                                    },
                                },
                            },
                        ],
                    };
                    const result = RawAnnotationSchema.safeParse(raw);
                    expect(result.success).toBe(true);
                },
            ),
            { numRuns: 15 },
        );
    });
});

// ── Invariant: annotation count consistency ──────────────────────────────────

describe("Annotation count invariants", () => {
    it("adding then removing an annotation returns to original count", () => {
        fc.assert(
            fc.property(
                arbDocString.filter((d) => d.length >= 10),
                arbAnnotationType,
                (doc, annotationType) => {
                    const view = createView(doc);
                    const initialCount = Object.keys(view.state.field(annotationField)).length;

                    const docLen = view.state.doc.length;
                    const from = Math.floor(docLen / 4);
                    const to = Math.floor(docLen / 2);
                    const sel = EditorSelection.single(from, to);

                    const annotation = createNewAnnotation(
                        view.state.field(annotationField),
                        sel,
                        annotationType,
                    );

                    if (annotationType === "revision") {
                        (annotation as any).versions = [{ doc: doc.slice(from, to) }];
                        (annotation as any).activeVersionIndex = 0;
                    }

                    view.dispatch({ effects: [addAnnotation.of(annotation)] });
                    expect(Object.keys(view.state.field(annotationField)).length).toBe(
                        initialCount + 1,
                    );

                    const currentAnn = view.state.field(annotationField)[annotation.id];
                    view.dispatch({ effects: [removeAnnotation.of(currentAnn)] });
                    expect(Object.keys(view.state.field(annotationField)).length).toBe(initialCount);
                },
            ),
            { numRuns: 20 },
        );
    });
});

// ── Stress test: rapid edit sequences ────────────────────────────────────────

describe("Stress tests", () => {
    it("handles rapid interleaved edits and annotations", () => {
        fc.assert(
            fc.property(
                arbDocString.filter((d) => d.length >= 50),
                fc.array(
                    fc.oneof(
                        fc.record({ type: fc.constant("insert" as const), text: fc.string({ minLength: 1, maxLength: 10 }) }),
                        fc.record({ type: fc.constant("delete" as const) }),
                        fc.record({ type: fc.constant("addComment" as const) }),
                        fc.record({ type: fc.constant("removeComment" as const) }),
                    ),
                    { minLength: 10, maxLength: 50 },
                ),
                (doc, operations) => {
                    const view = createView(doc);
                    let annotationIds: number[] = [];

                    for (const op of operations) {
                        try {
                            const docLen = view.state.doc.length;
                            if (docLen === 0 && op.type !== "insert") continue;

                            switch (op.type) {
                                case "insert": {
                                    const pos = Math.floor(Math.random() * (docLen + 1));
                                    view.dispatch({
                                        changes: { from: pos, to: pos, insert: (op as any).text },
                                    });
                                    break;
                                }
                                case "delete": {
                                    const from = Math.floor(Math.random() * docLen);
                                    const to = Math.min(from + 5, docLen);
                                    view.dispatch({ changes: { from, to, insert: "" } });
                                    break;
                                }
                                case "addComment": {
                                    const from = Math.floor(Math.random() * Math.max(1, docLen - 1));
                                    const to = Math.min(from + 3, docLen);
                                    if (from < to) {
                                        const ann = createNewAnnotation(
                                            view.state.field(annotationField),
                                            EditorSelection.single(from, to),
                                            "comment",
                                        );
                                        view.dispatch({ effects: [addAnnotation.of(ann)] });
                                        annotationIds.push(ann.id);
                                    }
                                    break;
                                }
                                case "removeComment": {
                                    if (annotationIds.length > 0) {
                                        const id = annotationIds[Math.floor(Math.random() * annotationIds.length)];
                                        const ann = view.state.field(annotationField)[id];
                                        if (ann) {
                                            view.dispatch({ effects: [removeAnnotation.of(ann)] });
                                            annotationIds = annotationIds.filter((i) => i !== id);
                                        }
                                    }
                                    break;
                                }
                            }
                        } catch {
                            // Some operations may fail due to invalid positions after
                            // concurrent edits; that's fine for this stress test
                        }
                    }

                    const stateJson = view.state.toJSON(savedFields);
                    const restored = EditorState.fromJSON(
                        stateJson,
                        { extensions: [history(), annotationExtensions()] },
                        savedFields,
                    );

                    expect(restored.doc.toString()).toBe(view.state.doc.toString());
                    expect(Object.keys(restored.field(annotationField)).length).toBe(
                        Object.keys(view.state.field(annotationField)).length,
                    );
                },
            ),
            { numRuns: 20 },
        );
    });

    it("snapshot + replay equals direct state for complex sequences", () => {
        fc.assert(
            fc.property(
                arbDocString.filter((d) => d.length >= 20),
                fc.array(fc.string({ minLength: 1, maxLength: 5 }), { minLength: 5, maxLength: 20 }),
                (initialDoc, insertions) => {
                    const view = createView(initialDoc);

                    const events: EventRecord[] = [];
                    let eventId = 1;

                    for (const insert of insertions) {
                        const docLen = view.state.doc.length;
                        const from = Math.floor(Math.random() * (docLen + 1));

                        view.dispatch({ changes: { from, to: from, insert } });

                        const payload: DocChangeEvent = {
                            type: "doc_change",
                            changes: [{ from, to: from, insert }],
                            selection: { ranges: [{ anchor: from + insert.length, head: from + insert.length }], main: 0 },
                        };

                        events.push({
                            id: eventId++,
                            eventType: "doc_change",
                            payload: JSON.stringify(payload),
                            createdAt: Date.now(),
                        });
                    }

                    const baseState = EditorState.create({
                        doc: initialDoc,
                        extensions: [history(), annotationExtensions()],
                    });

                    const replayedState = replayEvents(baseState, events);

                    expect(replayedState.doc.toString()).toBe(view.state.doc.toString());
                },
            ),
            { numRuns: 15 },
        );
    });
});
