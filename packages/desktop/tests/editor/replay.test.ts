import type { EventRecord } from "$lib/db/types";
import { savedFields } from "$lib/editor/extensions";
import {
    persistentHistoryRuntimeExtension,
    persistentHistoryStateExtension,
} from "$lib/editor/persistentHistory";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import { addAnnotation, annotationField } from "$lib/editor/plugins/annotations/annotationField";
import {
    activeVersionIndex,
    createNewAnnotation,
    isAnnotationOfType,
} from "$lib/editor/plugins/annotations/models";
import { reconstructState, replayEvents } from "$lib/editor/replay";
import { history } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";

function makeRecord(id: number, payload: object): EventRecord {
    return {
        id,
        eventType: (payload as { type: string }).type,
        payload: JSON.stringify(payload),
        createdAt: Date.now(),
    };
}

function createBaseState(doc = "") {
    return EditorState.create({
        doc,
        extensions: [annotationExtensions()],
    });
}

describe("replayEvents", () => {
    it("returns the base state unchanged when there are no events", () => {
        const state = createBaseState("Hello");
        const result = replayEvents(state, []);
        expect(result.doc.toString()).toBe("Hello");
    });

    it("replays a doc_change event to restore inserted text", () => {
        const state = createBaseState("");
        const result = replayEvents(state, [
            makeRecord(0, {
                type: "doc_change",
                changes: [{ from: 0, to: 0, insert: "Hello world" }],
                selection: { ranges: [{ anchor: 11, head: 11 }], main: 0 },
            }),
        ]);
        expect(result.doc.toString()).toBe("Hello world");
    });

    it("replays multiple doc_change events in sequence", () => {
        const state = createBaseState("");
        const result = replayEvents(state, [
            makeRecord(0, {
                type: "doc_change",
                changes: [{ from: 0, to: 0, insert: "foo" }],
                selection: { ranges: [{ anchor: 3, head: 3 }], main: 0 },
            }),
            makeRecord(1, {
                type: "doc_change",
                changes: [{ from: 3, to: 3, insert: " bar" }],
                selection: { ranges: [{ anchor: 7, head: 7 }], main: 0 },
            }),
        ]);
        expect(result.doc.toString()).toBe("foo bar");
    });

    it("replays a doc_change deletion", () => {
        const state = createBaseState("Hello world");
        const result = replayEvents(state, [
            makeRecord(0, {
                type: "doc_change",
                changes: [{ from: 5, to: 11, insert: "" }],
                selection: { ranges: [{ anchor: 5, head: 5 }], main: 0 },
            }),
        ]);
        expect(result.doc.toString()).toBe("Hello");
    });

    it("restores cursor position from selection in doc_change", () => {
        const state = createBaseState("Hello");
        const result = replayEvents(state, [
            makeRecord(0, {
                type: "doc_change",
                changes: [{ from: 5, to: 5, insert: " world" }],
                selection: { ranges: [{ anchor: 3, head: 7 }], main: 0 },
            }),
        ]);
        expect(result.selection.main.anchor).toBe(3);
        expect(result.selection.main.head).toBe(7);
    });

    it("replays an annotation_add event", () => {
        const base = createBaseState("Hello world");
        const ann = createNewAnnotation({}, EditorSelection.single(0, 5), "comment");
        const rawAnnotation = {
            ...ann,
            selection: ann.selection.toJSON(),
        };
        const result = replayEvents(base, [
            makeRecord(0, { type: "annotation_add", annotation: rawAnnotation }),
        ]);
        const annotations = Object.values(result.field(annotationField));
        expect(annotations).toHaveLength(1);
        expect(isAnnotationOfType(annotations[0], "comment")).toBe(true);
    });

    it("replays an annotation_remove event", () => {
        const ann = {
            ...createNewAnnotation({}, EditorSelection.single(0, 5), "comment"),
            id: 0,
        };
        const base = EditorState.create({
            doc: "Hello world",
            extensions: [annotationExtensions()],
        });
        // First add the annotation so it exists in state
        const withAnnotation = base.update({ effects: [addAnnotation.of(ann)] }).state;
        expect(Object.keys(withAnnotation.field(annotationField))).toHaveLength(1);

        const result = replayEvents(withAnnotation, [
            makeRecord(0, { type: "annotation_remove", annotationId: 0 }),
        ]);
        expect(Object.keys(result.field(annotationField))).toHaveLength(0);
    });

    it("replays an annotation_update event by overwriting the annotation", () => {
        const ann = {
            ...createNewAnnotation({}, EditorSelection.single(0, 5), "comment"),
            id: 0,
            thread: [],
        };
        const base = EditorState.create({
            doc: "Hello world",
            extensions: [annotationExtensions()],
        });
        const withAnnotation = base.update({ effects: [addAnnotation.of(ann)] }).state;

        const updatedAnn = {
            ...ann,
            thread: [{ message: "Updated comment", author: "user", time: 1 }],
            selection: ann.selection.toJSON(),
        };
        const result = replayEvents(withAnnotation, [
            makeRecord(0, { type: "annotation_update", annotation: updatedAnn }),
        ]);
        const annotations = Object.values(result.field(annotationField));
        expect(annotations).toHaveLength(1);
        expect(annotations[0].thread[0]?.message).toBe("Updated comment");
    });

    it("normalizes legacy revision payloads during replay", () => {
        const base = createBaseState("Hello");
        const legacyRevision = {
            id: 0,
            _type: "revision",
            status: "active" as const,
            thread: [],
            selection: EditorSelection.single(0, 5).toJSON(),
            activeVersionIndex: 1,
            versions: [{ doc: "Hello" }, { doc: "Hallo" }],
        };

        const result = replayEvents(base, [
            makeRecord(0, { type: "annotation_update", annotation: legacyRevision }),
        ]);

        const [annotation] = Object.values(result.field(annotationField));
        expect(annotation).toBeDefined();
        expect(isAnnotationOfType(annotation, "revision")).toBe(true);
        if (!annotation || !isAnnotationOfType(annotation, "revision")) return;

        expect(annotation.versions.every((version) => typeof version.id === "string")).toBe(true);
        expect(activeVersionIndex(annotation)).toBe(1);
        expect(annotation.activeVersionId).toBe(annotation.versions[1].id);
        expect("activeVersionIndex" in annotation).toBe(false);
        expect(
            annotation.versions.filter((version) => version.id === annotation.activeVersionId),
        ).toHaveLength(1);
    });

    it("replays a compound event (doc change + annotation add)", () => {
        const base = createBaseState("Hello");
        const ann = createNewAnnotation({}, EditorSelection.single(0, 5), "comment");
        const rawAnnotation = {
            ...ann,
            selection: ann.selection.toJSON(),
        };
        const result = replayEvents(base, [
            makeRecord(0, {
                type: "compound",
                docChanges: [{ from: 5, to: 5, insert: " world" }],
                annotationEvents: [{ type: "annotation_add", annotation: rawAnnotation }],
                selection: { ranges: [{ anchor: 11, head: 11 }], main: 0 },
            }),
        ]);
        expect(result.doc.toString()).toBe("Hello world");
        const annotations = Object.values(result.field(annotationField));
        expect(annotations).toHaveLength(1);
    });

    it("skips a corrupt event and continues replaying the rest", () => {
        const state = createBaseState("Hello");
        const result = replayEvents(state, [
            makeRecord(0, {
                type: "doc_change",
                changes: [{ from: 5, to: 5, insert: " world" }],
                selection: { ranges: [{ anchor: 11, head: 11 }], main: 0 },
            }),
            // Corrupt payload -- changes positions out of doc range
            makeRecord(1, {
                type: "doc_change",
                changes: [{ from: 9999, to: 9999, insert: "oops" }],
                selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 },
            }),
            makeRecord(2, {
                type: "doc_change",
                changes: [{ from: 11, to: 11, insert: "!" }],
                selection: { ranges: [{ anchor: 12, head: 12 }], main: 0 },
            }),
        ]);
        // First and third events applied, corrupt middle event skipped.
        expect(result.doc.toString()).toBe("Hello world!");
    });

    it("applies an exact state fallback before invalid legacy aggregate changes", () => {
        const state = createBaseState("abc");
        const result = replayEvents(state, [
            makeRecord(0, {
                type: "doc_change",
                // A failed trace can leave aggregate coordinates that are not
                // valid as one transaction. The full-state fallback is the
                // authoritative post-event state and must run first.
                changes: [{ from: 999, to: 999, insert: "unreachable" }],
                selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 },
                stateFallback: {
                    doc: "recovered",
                    annotations: {},
                    versionGroups: {},
                    selection: { ranges: [{ anchor: 2, head: 7 }], main: 0 },
                },
            }),
        ]);

        expect(result.doc.toString()).toBe("recovered");
        expect(result.selection.main.anchor).toBe(2);
        expect(result.selection.main.head).toBe(7);
    });

    it("handles annotation_remove for missing annotation id gracefully", () => {
        const state = createBaseState("Hello");
        // Should not throw even when annotationId doesn't exist
        const result = replayEvents(state, [
            makeRecord(0, { type: "annotation_remove", annotationId: 999 }),
        ]);
        expect(result.doc.toString()).toBe("Hello");
    });
});

describe("startup replay evidence", () => {
    it("reports snapshot fallback so a trial frontend cannot confirm a failed load", () => {
        const failed = vi.fn();
        reconstructState("{broken", [], annotationExtensions(), undefined, failed);
        expect(failed).toHaveBeenCalledOnce();
    });

    it("reports skipped corrupt events while retaining the existing recovery behavior", () => {
        const failed = vi.fn();
        const state = reconstructState(
            null,
            [
                makeRecord(1, {
                    type: "doc_change",
                    changes: [{ from: 999, to: 999, insert: "unreachable" }],
                    selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 },
                }),
            ],
            annotationExtensions(),
            undefined,
            failed,
        );
        expect(state.doc.toString()).toBe("");
        expect(failed).toHaveBeenCalledOnce();
    });
});

it.each(["annotation_add", "annotation_update"])("reports a silently skipped legacy %s", (type) => {
    const failed = vi.fn();
    const state = reconstructState(
        null,
        [
            makeRecord(1, {
                type,
                annotation: { _type: "unknown-ota-format", id: "revision" },
            }),
        ],
        annotationExtensions(),
        undefined,
        failed,
    );
    expect(state.doc.toString()).toBe("");
    expect(failed).toHaveBeenCalledOnce();
});

it("reports a dropped compound annotation while preserving the recoverable text", () => {
    const failed = vi.fn();
    const state = reconstructState(
        null,
        [
            makeRecord(1, {
                type: "compound",
                docChanges: [{ from: 0, to: 0, insert: "Recovered text" }],
                annotationEvents: [
                    {
                        type: "annotation_add",
                        annotation: { _type: "unknown-ota-format", id: "revision" },
                    },
                ],
                selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 },
            }),
        ],
        annotationExtensions(),
        undefined,
        failed,
    );
    expect(state.doc.toString()).toBe("Recovered text");
    expect(state.field(annotationField)).toEqual({});
    expect(failed).toHaveBeenCalledOnce();
});

it.each([
    { annotationField: { "1": { _type: "unknown-ota-format", id: "revision" } } },
    { versionGroupField: { group: { id: "group", members: "unsupported" } } },
    { annotationHistoryScope: "unsupported" },
    {
        annotationField: {
            "1": {
                id: 1,
                _type: "revision",
                thread: [],
                selection: { ranges: [{ anchor: 0, head: 1 }], main: 0 },
                versions: [
                    {
                        id: "version",
                        doc: "draft",
                        annotationField: { "2": { _type: "unknown-ota-format" } },
                    },
                ],
                activeVersionId: "version",
            },
        },
    },
])(
    "reports malformed snapshot fields before their forgiving deserializers discard data",
    (fields) => {
        const failed = vi.fn();
        const state = reconstructState(
            JSON.stringify({ doc: "draft", ...fields }),
            [],
            annotationExtensions(),
            undefined,
            failed,
        );
        expect(state.doc.toString()).toBe("draft");
        expect(failed).toHaveBeenCalled();
    },
);

it("reports malformed current-format snapshot undo data while keeping the document readable", () => {
    const failed = vi.fn();
    const extensions = [
        annotationExtensions(),
        history(),
        persistentHistoryStateExtension,
        persistentHistoryRuntimeExtension,
    ];
    const state = reconstructState(
        JSON.stringify({ doc: "draft", historyField: { version: 1, effects: "unsupported" } }),
        [],
        extensions,
        savedFields,
        failed,
    );
    expect(state.doc.toString()).toBe("draft");
    expect(failed).toHaveBeenCalled();
});

it("reports snapshot history hydration failures instead of acknowledging the silently reset branch", () => {
    const failed = vi.fn();
    const extensions = [
        annotationExtensions(),
        history(),
        persistentHistoryStateExtension,
        persistentHistoryRuntimeExtension,
    ];
    const before = EditorState.create({ doc: "draft", extensions }).update({
        changes: { from: 0, insert: "a" },
    }).state;
    const snapshot = before.toJSON(savedFields);
    snapshot.historyField.effects.done = [];
    const state = reconstructState(JSON.stringify(snapshot), [], extensions, savedFields, failed);
    expect(state.doc.toString()).toBe("adraft");
    expect(failed).toHaveBeenCalled();
});

it.each(["unsupported", { version: 2, effects: { done: [], undone: [] } }])(
    "reports an unsupported snapshot history format",
    (historyField) => {
        const failed = vi.fn();
        const extensions = [
            annotationExtensions(),
            history(),
            persistentHistoryStateExtension,
            persistentHistoryRuntimeExtension,
        ];
        const state = reconstructState(
            JSON.stringify({ doc: "draft", historyField }),
            [],
            extensions,
            savedFields,
            failed,
        );
        expect(state.doc.toString()).toBe("draft");
        expect(failed).toHaveBeenCalled();
    },
);

it("retains the documented compatibility reset for recognizable legacy CodeMirror history", () => {
    const failed = vi.fn();
    const extensions = [
        annotationExtensions(),
        history(),
        persistentHistoryStateExtension,
        persistentHistoryRuntimeExtension,
    ];
    const state = reconstructState(
        JSON.stringify({ doc: "draft", historyField: { done: [], undone: [] } }),
        [],
        extensions,
        savedFields,
        failed,
    );
    expect(state.doc.toString()).toBe("draft");
    expect(failed).not.toHaveBeenCalled();
});
