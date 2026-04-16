/**
 * Property-based fuzz tests specifically for event replay logic.
 *
 * Targets:
 *   - replayEvents function correctness
 *   - Event ordering invariants
 *   - Selection position clamping
 *   - Annotation selection remapping through doc changes
 */
import fc from "fast-check";
import { describe, expect, it, afterEach } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, historyField } from "@codemirror/commands";
import { annotationField } from "$lib/editor/plugins/annotations/annotationField";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import { addAnnotation, removeAnnotation } from "$lib/editor/plugins/annotations/annotationField";
import {
    createNewAnnotation,
    isAnnotationOfType,
    type GenericAnnotation,
} from "$lib/editor/plugins/annotations/models";
import { replayEvents } from "$lib/editor/replay";
import type { EventRecord } from "$lib/db/types";
import type {
    DocChangeEvent,
    CompoundEvent,
    AnnotationAddEvent,
    AnnotationRemoveEvent,
    AnnotationUpdateEvent,
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

function serializeAnnotation(annotation: GenericAnnotation): Record<string, unknown> {
    return JSON.parse(JSON.stringify({ ...annotation, selection: annotation.selection.toJSON() }));
}

function makeEventRecord(id: number, payload: object): EventRecord {
    return {
        id,
        eventType: (payload as { type: string }).type,
        payload: JSON.stringify(payload),
        createdAt: Date.now(),
    };
}

// ── Replay order independence for non-overlapping changes ───────────────────

describe("Replay order properties", () => {
    it("sequential insertions are replayed correctly", () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 10, maxLength: 100 }).map((s) => s.replace(/\r/g, "")),
                fc.array(
                    fc.record({
                        relativePos: fc.integer({ min: 0, max: 100 }).map((n) => n / 100),
                        text: fc.string({ minLength: 1, maxLength: 5 }).map((s) => s.replace(/\r/g, "")),
                    }),
                    { minLength: 1, maxLength: 3 },
                ),
                (doc, insertions) => {
                    let currentDoc = doc;
                    const events: EventRecord[] = [];

                    for (let i = 0; i < insertions.length; i++) {
                        const ins = insertions[i];
                        const docLen = currentDoc.length;
                        const pos = Math.min(Math.floor(ins.relativePos * docLen), docLen);
                        const text = ins.text;

                        const payload: DocChangeEvent = {
                            type: "doc_change",
                            changes: [{ from: pos, to: pos, insert: text }],
                            selection: { ranges: [{ anchor: pos + text.length, head: pos + text.length }], main: 0 },
                        };
                        events.push(makeEventRecord(i + 1, payload));

                        currentDoc = currentDoc.slice(0, pos) + text + currentDoc.slice(pos);
                    }

                    const baseState = EditorState.create({
                        doc,
                        extensions: [history(), annotationExtensions()],
                    });

                    const replayedState = replayEvents(baseState, events);

                    expect(replayedState.doc.toString()).toBe(currentDoc);
                },
            ),
            { numRuns: 30 },
        );
    });
});

// ── Selection clamping after replay ──────────────────────────────────────────

describe("Selection clamping", () => {
    it("selections are always valid after replaying deletions", () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 50, maxLength: 200 }).map((s) => s.replace(/\r/g, "")),
                fc.array(
                    fc.record({
                        fromRel: fc.integer({ min: 0, max: 90 }).map((n) => n / 100),
                        lenRel: fc.integer({ min: 1, max: 10 }).map((n) => n / 100),
                    }),
                    { minLength: 1, maxLength: 5 },
                ),
                (doc, deletions) => {
                    let currentDoc = doc;
                    const events: EventRecord[] = [];

                    for (let i = 0; i < deletions.length; i++) {
                        const del = deletions[i];
                        const docLen = currentDoc.length;
                        if (docLen < 2) break;

                        const from = Math.floor(del.fromRel * docLen);
                        const len = Math.max(1, Math.floor(del.lenRel * docLen));
                        const to = Math.min(from + len, docLen);

                        const payload: DocChangeEvent = {
                            type: "doc_change",
                            changes: [{ from, to, insert: "" }],
                            selection: { ranges: [{ anchor: from, head: from }], main: 0 },
                        };

                        events.push(makeEventRecord(i + 1, payload));
                        currentDoc = currentDoc.slice(0, from) + currentDoc.slice(to);
                    }

                    const baseState = EditorState.create({
                        doc,
                        extensions: [history(), annotationExtensions()],
                    });

                    const replayedState = replayEvents(baseState, events);

                    const docLen = replayedState.doc.length;
                    for (const range of replayedState.selection.ranges) {
                        expect(range.from).toBeGreaterThanOrEqual(0);
                        expect(range.to).toBeLessThanOrEqual(docLen);
                        expect(range.from).toBeLessThanOrEqual(range.to);
                    }
                },
            ),
            { numRuns: 30 },
        );
    });
});

// ── Annotation remapping through doc changes ─────────────────────────────────

describe("Annotation remapping", () => {
    it("annotation added before deletion is remapped correctly", () => {
        const doc = "Hello wonderful world";
        const baseState = EditorState.create({
            doc,
            extensions: [history(), annotationExtensions()],
        });

        const annotation: GenericAnnotation = {
            id: 0,
            _type: "comment",
            selection: EditorSelection.single(16, 21),
            thread: [],
        };

        const events: EventRecord[] = [
            makeEventRecord(1, {
                type: "annotation_add",
                annotation: serializeAnnotation(annotation),
            } as AnnotationAddEvent),
            makeEventRecord(2, {
                type: "doc_change",
                changes: [{ from: 6, to: 16, insert: "" }],
                selection: { ranges: [{ anchor: 6, head: 6 }], main: 0 },
            } as DocChangeEvent),
        ];

        const replayedState = replayEvents(baseState, events);

        expect(replayedState.doc.toString()).toBe("Hello world");
        const annotations = replayedState.field(annotationField);
        expect(annotations[0]).toBeDefined();
        expect(annotations[0].selection.main.from).toBe(6);
        expect(annotations[0].selection.main.to).toBe(11);
    });

    it("annotation selection survives multiple edits", () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 30, maxLength: 100 }).map((s) => s.replace(/\r/g, "")),
                fc.array(
                    fc.oneof(
                        fc.record({
                            type: fc.constant("insert" as const),
                            posRel: fc.integer({ min: 0, max: 100 }).map((n) => n / 100),
                            text: fc.string({ minLength: 1, maxLength: 5 }).map((s) => s.replace(/\r/g, "")),
                        }),
                        fc.record({
                            type: fc.constant("delete" as const),
                            posRel: fc.integer({ min: 0, max: 80 }).map((n) => n / 100),
                            lenRel: fc.integer({ min: 1, max: 10 }).map((n) => n / 100),
                        }),
                    ),
                    { minLength: 3, maxLength: 10 },
                ),
                (doc, edits) => {
                    const docLen = doc.length;
                    const annFrom = Math.floor(docLen * 0.4);
                    const annTo = Math.floor(docLen * 0.6);

                    const annotation: GenericAnnotation = {
                        id: 0,
                        _type: "comment",
                        selection: EditorSelection.single(annFrom, annTo),
                        thread: [],
                    };

                    const events: EventRecord[] = [
                        makeEventRecord(1, {
                            type: "annotation_add",
                            annotation: serializeAnnotation(annotation),
                        } as AnnotationAddEvent),
                    ];

                    let currentDoc = doc;
                    let eventId = 2;

                    for (const edit of edits) {
                        const len = currentDoc.length;
                        if (len < 2) break;

                        if (edit.type === "insert") {
                            const pos = Math.floor((edit as any).posRel * len);
                            const text = (edit as any).text;
                            events.push(
                                makeEventRecord(eventId++, {
                                    type: "doc_change",
                                    changes: [{ from: pos, to: pos, insert: text }],
                                    selection: { ranges: [{ anchor: pos, head: pos }], main: 0 },
                                } as DocChangeEvent),
                            );
                            currentDoc = currentDoc.slice(0, pos) + text + currentDoc.slice(pos);
                        } else {
                            const pos = Math.floor((edit as any).posRel * len);
                            const delLen = Math.max(1, Math.floor((edit as any).lenRel * len));
                            const to = Math.min(pos + delLen, len);
                            events.push(
                                makeEventRecord(eventId++, {
                                    type: "doc_change",
                                    changes: [{ from: pos, to, insert: "" }],
                                    selection: { ranges: [{ anchor: pos, head: pos }], main: 0 },
                                } as DocChangeEvent),
                            );
                            currentDoc = currentDoc.slice(0, pos) + currentDoc.slice(to);
                        }
                    }

                    const baseState = EditorState.create({
                        doc,
                        extensions: [history(), annotationExtensions()],
                    });

                    const replayedState = replayEvents(baseState, events);

                    const annotations = replayedState.field(annotationField);
                    expect(annotations[0]).toBeDefined();

                    const sel = annotations[0].selection;
                    const replayedDocLen = replayedState.doc.length;
                    expect(sel.main.from).toBeGreaterThanOrEqual(0);
                    expect(sel.main.to).toBeLessThanOrEqual(replayedDocLen);
                },
            ),
            { numRuns: 30 },
        );
    });
});

// ── Compound event atomicity ─────────────────────────────────────────────────

describe("Compound event atomicity", () => {
    it("compound events apply doc changes and annotations together", () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 20, maxLength: 100 }).map((s) => s.replace(/\r/g, "")),
                fc.string({ minLength: 1, maxLength: 10 }).map((s) => s.replace(/\r/g, "")),
                (doc, insert) => {
                    const docLen = doc.length;
                    const insertPos = Math.floor(docLen / 2);
                    const annFrom = Math.floor(docLen / 4);
                    const annTo = Math.floor(docLen / 3);

                    const annotation: GenericAnnotation = {
                        id: 0,
                        _type: "comment",
                        selection: EditorSelection.single(annFrom, annTo),
                        thread: [],
                    };

                    const compound: CompoundEvent = {
                        type: "compound",
                        docChanges: [{ from: insertPos, to: insertPos, insert }],
                        annotationEvents: [
                            {
                                type: "annotation_add",
                                annotation: serializeAnnotation(annotation),
                            },
                        ],
                        selection: { ranges: [{ anchor: insertPos + insert.length, head: insertPos + insert.length }], main: 0 },
                    };

                    const baseState = EditorState.create({
                        doc,
                        extensions: [history(), annotationExtensions()],
                    });

                    const replayedState = replayEvents(baseState, [makeEventRecord(1, compound)]);

                    const expectedDoc = doc.slice(0, insertPos) + insert + doc.slice(insertPos);
                    expect(replayedState.doc.toString()).toBe(expectedDoc);

                    const annotations = replayedState.field(annotationField);
                    expect(annotations[0]).toBeDefined();
                },
            ),
            { numRuns: 30 },
        );
    });
});

// ── Annotation update events ─────────────────────────────────────────────────

describe("Annotation update events", () => {
    it("annotation_update replaces existing annotation", () => {
        const doc = "Hello world";
        const baseState = EditorState.create({
            doc,
            extensions: [history(), annotationExtensions()],
        });

        const original: GenericAnnotation = {
            id: 0,
            _type: "comment",
            selection: EditorSelection.single(0, 5),
            thread: [],
        };

        const updated: GenericAnnotation = {
            id: 0,
            _type: "comment",
            selection: EditorSelection.single(0, 5),
            thread: [{ message: "Updated!", author: "Test", time: Date.now() }],
        };

        const events: EventRecord[] = [
            makeEventRecord(1, {
                type: "annotation_add",
                annotation: serializeAnnotation(original),
            } as AnnotationAddEvent),
            makeEventRecord(2, {
                type: "annotation_update",
                annotation: serializeAnnotation(updated),
            } as AnnotationUpdateEvent),
        ];

        const replayedState = replayEvents(baseState, events);

        const annotations = replayedState.field(annotationField);
        expect(annotations[0]).toBeDefined();
        expect(annotations[0].thread.length).toBe(1);
        expect(annotations[0].thread[0].message).toBe("Updated!");
    });

    it("multiple updates to same annotation accumulate correctly", () => {
        fc.assert(
            fc.property(
                fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 2, maxLength: 10 }),
                (messages) => {
                    const doc = "Test document for annotations";
                    const baseState = EditorState.create({
                        doc,
                        extensions: [history(), annotationExtensions()],
                    });

                    const events: EventRecord[] = [];
                    let eventId = 1;

                    const initial: GenericAnnotation = {
                        id: 0,
                        _type: "comment",
                        selection: EditorSelection.single(0, 4),
                        thread: [],
                    };

                    events.push(
                        makeEventRecord(eventId++, {
                            type: "annotation_add",
                            annotation: serializeAnnotation(initial),
                        } as AnnotationAddEvent),
                    );

                    let currentThread: { message: string; author: string; time: number }[] = [];
                    for (const message of messages) {
                        currentThread = [...currentThread, { message, author: "Tester", time: Date.now() }];
                        const updated: GenericAnnotation = {
                            id: 0,
                            _type: "comment",
                            selection: EditorSelection.single(0, 4),
                            thread: currentThread,
                        };
                        events.push(
                            makeEventRecord(eventId++, {
                                type: "annotation_update",
                                annotation: serializeAnnotation(updated),
                            } as AnnotationUpdateEvent),
                        );
                    }

                    const replayedState = replayEvents(baseState, events);

                    const annotations = replayedState.field(annotationField);
                    expect(annotations[0]).toBeDefined();
                    expect(annotations[0].thread.length).toBe(messages.length);

                    for (let i = 0; i < messages.length; i++) {
                        expect(annotations[0].thread[i].message).toBe(messages[i]);
                    }
                },
            ),
            { numRuns: 20 },
        );
    });
});

// ── Annotation remove events ─────────────────────────────────────────────────

describe("Annotation remove events", () => {
    it("annotation_remove deletes existing annotation", () => {
        const doc = "Hello world";
        const baseState = EditorState.create({
            doc,
            extensions: [history(), annotationExtensions()],
        });

        const annotation: GenericAnnotation = {
            id: 0,
            _type: "comment",
            selection: EditorSelection.single(0, 5),
            thread: [],
        };

        const events: EventRecord[] = [
            makeEventRecord(1, {
                type: "annotation_add",
                annotation: serializeAnnotation(annotation),
            } as AnnotationAddEvent),
            makeEventRecord(2, {
                type: "annotation_remove",
                annotationId: 0,
            } as AnnotationRemoveEvent),
        ];

        const replayedState = replayEvents(baseState, events);

        const annotations = replayedState.field(annotationField);
        expect(annotations[0]).toBeUndefined();
        expect(Object.keys(annotations).length).toBe(0);
    });

    it("removing non-existent annotation is a no-op", () => {
        const doc = "Hello world";
        const baseState = EditorState.create({
            doc,
            extensions: [history(), annotationExtensions()],
        });

        const events: EventRecord[] = [
            makeEventRecord(1, {
                type: "annotation_remove",
                annotationId: 999,
            } as AnnotationRemoveEvent),
        ];

        const replayedState = replayEvents(baseState, events);

        expect(replayedState.doc.toString()).toBe(doc);
        const annotations = replayedState.field(annotationField);
        expect(Object.keys(annotations).length).toBe(0);
    });
});

// ── Empty and edge case events ───────────────────────────────────────────────

describe("Edge cases", () => {
    it("empty event list returns base state unchanged", () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 0, maxLength: 100 }).map((s) => s.replace(/\r/g, "")),
                (doc) => {
                    const baseState = EditorState.create({
                        doc,
                        extensions: [history(), annotationExtensions()],
                    });

                    const replayedState = replayEvents(baseState, []);

                    expect(replayedState.doc.toString()).toBe(doc);
                    expect(Object.keys(replayedState.field(annotationField)).length).toBe(0);
                },
            ),
            { numRuns: 20 },
        );
    });

    it("doc_change with empty changes array is a no-op", () => {
        const doc = "Hello world";
        const baseState = EditorState.create({
            doc,
            extensions: [history(), annotationExtensions()],
        });

        const events: EventRecord[] = [
            makeEventRecord(1, {
                type: "doc_change",
                changes: [],
                selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 },
            } as DocChangeEvent),
        ];

        const replayedState = replayEvents(baseState, events);
        expect(replayedState.doc.toString()).toBe(doc);
    });

    it("handles very long documents", () => {
        const doc = "x".repeat(10000);
        const baseState = EditorState.create({
            doc,
            extensions: [history(), annotationExtensions()],
        });

        const events: EventRecord[] = [
            makeEventRecord(1, {
                type: "doc_change",
                changes: [{ from: 5000, to: 5000, insert: "INSERTED" }],
                selection: { ranges: [{ anchor: 5008, head: 5008 }], main: 0 },
            } as DocChangeEvent),
        ];

        const replayedState = replayEvents(baseState, events);
        expect(replayedState.doc.length).toBe(10008);
        expect(replayedState.doc.sliceString(5000, 5008)).toBe("INSERTED");
    });

    it("handles unicode characters correctly", () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 10, maxLength: 100 }).map((s) => s.replace(/\r/g, "")),
                fc.string({ minLength: 1, maxLength: 10 }).map((s) => s.replace(/\r/g, "")),
                (doc, insert) => {
                    const baseState = EditorState.create({
                        doc,
                        extensions: [history(), annotationExtensions()],
                    });

                    const pos = Math.floor(doc.length / 2);
                    const events: EventRecord[] = [
                        makeEventRecord(1, {
                            type: "doc_change",
                            changes: [{ from: pos, to: pos, insert }],
                            selection: { ranges: [{ anchor: pos + insert.length, head: pos + insert.length }], main: 0 },
                        } as DocChangeEvent),
                    ];

                    const replayedState = replayEvents(baseState, events);

                    const expected = doc.slice(0, pos) + insert + doc.slice(pos);
                    expect(replayedState.doc.toString()).toBe(expected);
                },
            ),
            { numRuns: 30 },
        );
    });
});

// ── Revision-specific tests ──────────────────────────────────────────────────

describe("Revision annotations", () => {
    it("revision annotations with versions survive replay", () => {
        const doc = "Hello world";
        const baseState = EditorState.create({
            doc,
            extensions: [history(), annotationExtensions()],
        });

        const revision: GenericAnnotation = {
            id: 0,
            _type: "revision",
            selection: EditorSelection.single(6, 11),
            thread: [],
            activeVersionIndex: 0,
            versions: [
                { doc: "world", label: "Original" },
                { doc: "universe", label: "Alternative" },
            ],
        } as any;

        const events: EventRecord[] = [
            makeEventRecord(1, {
                type: "annotation_add",
                annotation: serializeAnnotation(revision),
            } as AnnotationAddEvent),
        ];

        const replayedState = replayEvents(baseState, events);

        const annotations = replayedState.field(annotationField);
        expect(annotations[0]).toBeDefined();
        expect(isAnnotationOfType(annotations[0], "revision")).toBe(true);

        if (isAnnotationOfType(annotations[0], "revision")) {
            expect(annotations[0].versions.length).toBe(2);
            expect(annotations[0].versions[0].doc).toBe("world");
            expect(annotations[0].versions[1].doc).toBe("universe");
        }
    });

    it("revision version updates are preserved", () => {
        const doc = "Hello world";
        const baseState = EditorState.create({
            doc,
            extensions: [history(), annotationExtensions()],
        });

        const initial: GenericAnnotation = {
            id: 0,
            _type: "revision",
            selection: EditorSelection.single(6, 11),
            thread: [],
            activeVersionIndex: 0,
            versions: [{ doc: "world" }],
        } as any;

        const updated: GenericAnnotation = {
            id: 0,
            _type: "revision",
            selection: EditorSelection.single(6, 11),
            thread: [],
            activeVersionIndex: 1,
            versions: [{ doc: "world" }, { doc: "universe" }],
        } as any;

        const events: EventRecord[] = [
            makeEventRecord(1, {
                type: "annotation_add",
                annotation: serializeAnnotation(initial),
            } as AnnotationAddEvent),
            makeEventRecord(2, {
                type: "annotation_update",
                annotation: serializeAnnotation(updated),
            } as AnnotationUpdateEvent),
        ];

        const replayedState = replayEvents(baseState, events);

        const annotations = replayedState.field(annotationField);
        if (isAnnotationOfType(annotations[0], "revision")) {
            expect(annotations[0].activeVersionIndex).toBe(1);
            expect(annotations[0].versions.length).toBe(2);
        }
    });
});
