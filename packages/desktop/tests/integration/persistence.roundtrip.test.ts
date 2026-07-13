import type { EventRecord } from "$lib/db/types";
import { savedFields } from "$lib/editor/extensions";
import { buildEventPayload } from "$lib/editor/listeners";
import {
    persistHistoryFacet,
    persistentHistoryExtension,
    persistentHistoryRuntimeExtension,
    persistentHistoryStateExtension,
} from "$lib/editor/persistentHistory";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import { addAnnotation, annotationField } from "$lib/editor/plugins/annotations/annotationField";
import {
    activeVersionIndex,
    createNewAnnotation,
    isAnnotationOfType,
    makeVersion,
} from "$lib/editor/plugins/annotations/models";
import {
    createVersionGroup,
    versionGroupField,
} from "$lib/editor/plugins/annotations/versionGroupField";
import { reconstructState } from "$lib/editor/replay";
import { history, isolateHistory, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { Compartment, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

function createView(doc: string, persistHistory = true) {
    const state = EditorState.create({
        doc,
        extensions: [
            persistHistoryFacet.of(persistHistory),
            persistentHistoryExtension,
            history(),
            annotationExtensions(),
        ],
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return new EditorView({ state, parent });
}

let view: EditorView | undefined;
let restoredView: EditorView | undefined;

afterEach(() => {
    view?.destroy();
    restoredView?.destroy();
    view = undefined;
    restoredView = undefined;
});

describe("persistence round-trip integration", () => {
    it("round-trips annotation effects through undo and redo", () => {
        view = createView("hello");
        const builtVersions = [makeVersion({ doc: "hello" })];
        const revision = {
            ...createNewAnnotation(
                view.state.field(annotationField),
                EditorSelection.single(0, 5),
                "revision",
            ),
            activeVersionId: builtVersions[0].id,
            versions: builtVersions,
        };
        view.dispatch({ effects: [addAnnotation.of(revision)] });

        const saved = view.state.toJSON(savedFields);
        expect(saved.historyField).toMatchObject({ version: 1 });
        const restored = EditorState.fromJSON(
            saved,
            { extensions: [persistentHistoryExtension, history(), annotationExtensions()] },
            savedFields,
        );
        const parent = document.createElement("div");
        document.body.appendChild(parent);
        restoredView = new EditorView({ state: restored, parent });

        expect(undoDepth(restoredView.state)).toBe(1);
        expect(restoredView.state.field(annotationField)[revision.id]).toBeDefined();
        expect(undo(restoredView)).toBe(true);
        expect(restoredView.state.field(annotationField)[revision.id]).toBeUndefined();
        expect(redo(restoredView)).toBe(true);
        expect(restoredView.state.field(annotationField)[revision.id]).toEqual(revision);
    });

    it("round-trips both populated undo and redo branches", () => {
        view = createView("Hello world");

        const builtVersions = [makeVersion({ doc: "world", label: "Original" })];
        const revision = {
            ...createNewAnnotation(
                view.state.field(annotationField),
                EditorSelection.single(6, 11),
                "revision",
            ),
            activeVersionId: builtVersions[0].id,
            versions: builtVersions,
        };

        view.dispatch(view.state.update({ effects: [addAnnotation.of(revision)] }));
        view.dispatch({ changes: { from: 0, insert: "Draft: " } });
        expect(undo(view)).toBe(true);

        expect(view.state.doc.toString()).toBe("Hello world");
        expect(undoDepth(view.state)).toBe(1);
        expect(redoDepth(view.state)).toBe(1);

        const saved = view.state.toJSON(savedFields);
        const restored = EditorState.fromJSON(
            saved,
            { extensions: [persistentHistoryExtension, history(), annotationExtensions()] },
            savedFields,
        );

        const parent = document.createElement("div");
        document.body.appendChild(parent);
        restoredView = new EditorView({ state: restored, parent });

        expect(restoredView.state.doc.toString()).toBe("Hello world");
        const annotations = Object.values(restoredView.state.field(annotationField));
        expect(annotations).toHaveLength(1);
        expect(isAnnotationOfType(annotations[0], "revision")).toBe(true);
        if (!isAnnotationOfType(annotations[0], "revision")) return;
        expect(annotations[0].versions[0]?.doc).toBe("world");
        // The active-version pointer survives the round-trip (still version 0).
        expect(activeVersionIndex(annotations[0])).toBe(0);

        expect(redo(restoredView)).toBe(true);
        expect(restoredView.state.doc.toString()).toBe("Draft: Hello world");
        expect(undo(restoredView)).toBe(true);
        expect(restoredView.state.doc.toString()).toBe("Hello world");
        expect(undo(restoredView)).toBe(true);
        expect(restoredView.state.field(annotationField)[revision.id]).toBeUndefined();
    });

    it("preserves comment annotation selections across serialize/deserialize", () => {
        view = createView("Alpha Beta Gamma");

        const comment = {
            ...createNewAnnotation(
                view.state.field(annotationField),
                EditorSelection.single(6, 10),
                "comment",
            ),
            thread: [{ message: "Check wording", author: "Reviewer", time: 1 }],
        };

        view.dispatch(view.state.update({ effects: [addAnnotation.of(comment)] }));

        const saved = view.state.toJSON(savedFields);
        const restored = EditorState.fromJSON(
            saved,
            { extensions: [persistentHistoryExtension, history(), annotationExtensions()] },
            savedFields,
        );

        const annotations = Object.values(restored.field(annotationField));
        expect(annotations).toHaveLength(1);
        expect(isAnnotationOfType(annotations[0], "comment")).toBe(true);
        if (!isAnnotationOfType(annotations[0], "comment")) return;

        const { from, to } = annotations[0].selection.main;
        expect(restored.sliceDoc(from, to)).toBe("Beta");
        expect(annotations[0].thread[0]?.message).toBe("Check wording");
    });

    it("fails closed to fresh history for legacy or unknown effect payloads", () => {
        view = createView("hello");
        const comment = createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(0, 5),
            "comment",
        );
        view.dispatch({ effects: addAnnotation.of(comment) });

        const unknown = structuredClone(view.state.toJSON(savedFields));
        const historyJson = unknown.historyField as {
            effects: { done: Array<Array<{ type: string }>> };
        };
        historyJson.effects.done[0][0].type = "future.unsupportedEffect";

        const restored = EditorState.fromJSON(
            unknown,
            { extensions: [persistentHistoryExtension, history(), annotationExtensions()] },
            savedFields,
        );
        expect(restored.doc.toString()).toBe("hello");
        expect(restored.field(annotationField)[comment.id]).toBeDefined();
        expect(undoDepth(restored)).toBe(0);

        const legacy = { ...unknown, historyField: { done: [], undone: [] } };
        const legacyRestored = EditorState.fromJSON(
            legacy,
            { extensions: [persistentHistoryExtension, history(), annotationExtensions()] },
            savedFields,
        );
        expect(legacyRestored.field(annotationField)[comment.id]).toBeDefined();
        expect(undoDepth(legacyRestored)).toBe(0);
    });

    it("keeps in-session undo but erases it from session-only snapshots", () => {
        view = createView("hello", false);
        const comment = createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(0, 5),
            "comment",
        );
        view.dispatch({ effects: addAnnotation.of(comment) });

        expect(undo(view)).toBe(true);
        expect(view.state.field(annotationField)[comment.id]).toBeUndefined();
        expect(redo(view)).toBe(true);
        expect(view.state.field(annotationField)[comment.id]).toBeDefined();

        const saved = view.state.toJSON(savedFields);
        expect(saved.historyField).toBeNull();
        const restored = EditorState.fromJSON(
            saved,
            {
                extensions: [
                    persistHistoryFacet.of(false),
                    persistentHistoryExtension,
                    history(),
                    annotationExtensions(),
                ],
            },
            savedFields,
        );

        expect(restored.field(annotationField)[comment.id]).toBeDefined();
        expect(undoDepth(restored)).toBe(0);
        expect(redoDepth(restored)).toBe(0);
    });

    it("clears persistent snapshot history before applying a legacy event tail", () => {
        view = createView("abc");
        const comment = createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(0, 1),
            "comment",
        );
        view.dispatch({ effects: addAnnotation.of(comment) });
        view.dispatch({ changes: { from: 3, insert: "1" } });
        expect(undoDepth(view.state)).toBeGreaterThan(0);

        const snapshot = JSON.stringify(view.state.toJSON(savedFields));
        const legacyTail: EventRecord[] = [
            {
                id: 1,
                eventType: "doc_change",
                createdAt: 1,
                payload: JSON.stringify({
                    type: "doc_change",
                    changes: [{ from: 4, to: 4, insert: "!" }],
                    selection: { ranges: [{ anchor: 5, head: 5 }], main: 0 },
                }),
            },
        ];
        const extensions = [
            persistHistoryFacet.of(true),
            persistentHistoryExtension,
            history(),
            annotationExtensions(),
        ];
        const restored = reconstructState(snapshot, legacyTail, extensions);

        expect(restored.doc.toString()).toBe("abc1!");
        expect(restored.field(annotationField)[comment.id]).toBeDefined();
        expect(undoDepth(restored)).toBe(0);
        expect(redoDepth(restored)).toBe(0);
    });

    it("preserves a selection-created undo boundary across a snapshot tail", () => {
        const payloads: object[] = [];
        const extensions = [
            persistHistoryFacet.of(true),
            persistentHistoryExtension,
            history({ newGroupDelay: 250 }),
            annotationExtensions(),
            EditorView.updateListener.of((update) => {
                const payload = buildEventPayload(update);
                if (payload) payloads.push(payload);
            }),
        ];
        const state = EditorState.create({ extensions });
        const parent = document.createElement("div");
        document.body.appendChild(parent);
        view = new EditorView({ state, parent });

        view.dispatch({
            changes: { from: 0, insert: "a" },
            selection: EditorSelection.cursor(1),
            annotations: [Transaction.time.of(1_000), Transaction.userEvent.of("input.type")],
        });
        const snapshot = JSON.stringify(view.state.toJSON(savedFields));
        payloads.length = 0;

        view.dispatch({
            selection: EditorSelection.single(0, 1),
            annotations: [Transaction.time.of(1_050), Transaction.userEvent.of("select")],
        });
        // Return to the snapshot's cursor position. Merely comparing the next
        // transaction's start selection would miss that a live selection
        // boundary still exists; startsNewHistoryGroup must carry that fact.
        view.dispatch({
            selection: EditorSelection.cursor(1),
            annotations: [Transaction.time.of(1_075), Transaction.userEvent.of("select")],
        });
        expect(payloads).toHaveLength(0);
        view.dispatch({
            changes: { from: 0, to: 1, insert: "b" },
            annotations: [Transaction.time.of(1_100), Transaction.userEvent.of("input.type")],
        });

        expect(payloads).toHaveLength(1);
        expect(undoDepth(view.state)).toBe(2);
        const payload = payloads[0] as {
            transactionReplay?: {
                transactions: Array<{
                    startSelection?: unknown;
                    annotations: { startsNewHistoryGroup?: boolean };
                }>;
            };
        };
        expect(payload.transactionReplay?.transactions[0]?.startSelection).toBeDefined();
        expect(payload.transactionReplay?.transactions[0]?.annotations.startsNewHistoryGroup).toBe(
            true,
        );

        const events: EventRecord[] = [
            {
                id: 1,
                eventType: "doc_change",
                payload: JSON.stringify(payloads[0]),
                createdAt: 1,
            },
        ];
        let restored = reconstructState(snapshot, events, extensions);
        expect(restored.doc.toString()).toBe("b");
        expect(undoDepth(restored)).toBe(2);

        expect(
            undo({
                state: restored,
                dispatch: (transaction) => {
                    restored = transaction.state;
                },
            }),
        ).toBe(true);
        expect(restored.doc.toString()).toBe("a");
    });

    it("preserves omitted selection history for post-restart undo and redo cursors", () => {
        const payloads: object[] = [];
        const extensions = [
            persistHistoryFacet.of(true),
            persistentHistoryExtension,
            history({ newGroupDelay: 250 }),
            annotationExtensions(),
            EditorView.updateListener.of((update) => {
                const payload = buildEventPayload(update);
                if (payload) payloads.push(payload);
            }),
        ];
        const state = EditorState.create({ doc: "xy", extensions });
        const parent = document.createElement("div");
        document.body.appendChild(parent);
        view = new EditorView({ state, parent });

        // The explicit post-edit cursor differs from CodeMirror's naturally
        // mapped pre-edit cursor. Selection-only traffic must be retained on
        // this history event so a later redo restores cursor 2, not cursor 0.
        view.dispatch({
            changes: { from: 2, insert: "!" },
            selection: EditorSelection.cursor(2),
            annotations: [Transaction.time.of(1_000), Transaction.userEvent.of("input.type")],
        });
        const snapshot = JSON.stringify(view.state.toJSON(savedFields));
        payloads.length = 0;

        view.dispatch({
            selection: EditorSelection.cursor(1),
            annotations: [Transaction.time.of(1_050), Transaction.userEvent.of("select")],
        });
        expect(payloads).toHaveLength(0);
        view.dispatch({
            changes: { from: 3, insert: "?" },
            selection: EditorSelection.cursor(1),
            annotations: [Transaction.time.of(1_100), Transaction.userEvent.of("input.type")],
        });

        expect(payloads).toHaveLength(1);
        const payload = payloads[0] as {
            transactionReplay?: {
                transactions: Array<{
                    annotations: { doneTopSelectionsAfter?: unknown[] };
                }>;
            };
        };
        expect(
            payload.transactionReplay?.transactions[0]?.annotations.doneTopSelectionsAfter,
        ).toEqual([{ ranges: [{ anchor: 2, head: 2 }], main: 0 }]);

        const restoredEvents: EventRecord[] = [
            {
                id: 1,
                eventType: "doc_change",
                payload: JSON.stringify(payloads[0]),
                createdAt: 1,
            },
        ];
        let restored = reconstructState(snapshot, restoredEvents, extensions);
        const runRestored = (command: typeof undo) => {
            expect(
                command({
                    state: restored,
                    dispatch: (transaction) => {
                        restored = transaction.state;
                    },
                }),
            ).toBe(true);
        };

        for (const command of [undo, undo, redo]) {
            expect(command(view)).toBe(true);
            runRestored(command);
        }
        expect(restored.doc.toString()).toBe(view.state.doc.toString());
        expect(restored.selection.eq(view.state.selection)).toBe(true);
        expect(restored.selection.main.head).toBe(2);
        expect(undoDepth(restored)).toBe(undoDepth(view.state));
        expect(redoDepth(restored)).toBe(redoDepth(view.state));
    });

    it("reconciles CodeMirror's rolling selection window without skipping the next edit", () => {
        const payloads: object[] = [];
        const extensions = [
            persistHistoryFacet.of(true),
            persistentHistoryExtension,
            history({ newGroupDelay: 250 }),
            annotationExtensions(),
            EditorView.updateListener.of((update) => {
                const payload = buildEventPayload(update);
                if (payload) payloads.push(payload);
            }),
        ];
        const state = EditorState.create({ doc: "xy", extensions });
        const parent = document.createElement("div");
        document.body.appendChild(parent);
        view = new EditorView({ state, parent });

        view.dispatch({
            changes: { from: 2, insert: "!" },
            selection: EditorSelection.cursor(2),
            annotations: [Transaction.time.of(1_000), Transaction.userEvent.of("input.type")],
        });
        view.dispatch({
            selection: EditorSelection.cursor(1),
            annotations: [Transaction.time.of(2_000), Transaction.userEvent.of("select")],
        });
        const snapshot = JSON.stringify(view.state.toJSON(savedFields));
        payloads.length = 0;

        // HistEvent keeps a rolling window of 201 selections. Enough omitted
        // cursor traffic removes the selection already present in the
        // snapshot, so the live list is a suffix/window rather than a strict
        // extension of the snapshot list.
        for (let index = 0; index < 205; index++) {
            view.dispatch({
                selection: EditorSelection.cursor(index % 2),
                annotations: [
                    Transaction.time.of(3_000 + index * 1_000),
                    Transaction.userEvent.of("select"),
                ],
            });
        }
        expect(payloads).toHaveLength(0);
        view.dispatch({
            changes: { from: view.state.doc.length, insert: "?" },
            selection: view.state.selection,
            annotations: [Transaction.time.of(300_000), Transaction.userEvent.of("input.type")],
        });

        expect(payloads).toHaveLength(1);
        const payload = payloads[0] as {
            type: string;
            transactionReplay?: {
                transactions: Array<{
                    annotations: { doneTopSelectionsAfter?: unknown[] };
                }>;
            };
        };
        expect(
            payload.transactionReplay?.transactions[0]?.annotations.doneTopSelectionsAfter,
        ).toHaveLength(201);

        const events: EventRecord[] = [
            {
                id: 1,
                eventType: payload.type,
                payload: JSON.stringify(payload),
                createdAt: 1,
            },
        ];
        let restored = reconstructState(snapshot, events, extensions);
        expect(restored.doc.toString()).toBe(view.state.doc.toString());
        expect(restored.doc.toString()).toBe("xy!?");
        expect(undoDepth(restored)).toBe(undoDepth(view.state));

        const runRestored = (command: typeof undo) => {
            expect(
                command({
                    state: restored,
                    dispatch: (transaction) => {
                        restored = transaction.state;
                    },
                }),
            ).toBe(true);
        };
        for (const command of [undo, undo, redo, redo]) {
            expect(command(view)).toBe(true);
            runRestored(command);
            expect(restored.doc.toString()).toBe(view.state.doc.toString());
            expect(restored.selection.eq(view.state.selection)).toBe(true);
            expect(undoDepth(restored)).toBe(undoDepth(view.state));
            expect(redoDepth(restored)).toBe(redoDepth(view.state));
        }
    });

    it("preserves a live joined undo group across a snapshot tail", () => {
        const payloads: object[] = [];
        const extensions = [
            persistHistoryFacet.of(true),
            persistentHistoryExtension,
            history({ newGroupDelay: 250 }),
            annotationExtensions(),
            EditorView.updateListener.of((update) => {
                const payload = buildEventPayload(update);
                if (payload) payloads.push(payload);
            }),
        ];
        const state = EditorState.create({ extensions });
        const parent = document.createElement("div");
        document.body.appendChild(parent);
        view = new EditorView({ state, parent });

        view.dispatch({
            changes: { from: 0, insert: "a" },
            selection: EditorSelection.cursor(1),
            annotations: [Transaction.time.of(1_000), Transaction.userEvent.of("input.type")],
        });
        const snapshot = JSON.stringify(view.state.toJSON(savedFields));
        payloads.length = 0;
        view.dispatch({
            changes: { from: 1, insert: "b" },
            selection: EditorSelection.cursor(2),
            annotations: [Transaction.time.of(1_100), Transaction.userEvent.of("input.type")],
        });

        expect(undoDepth(view.state)).toBe(1);
        const payload = payloads[0] as {
            transactionReplay?: {
                transactions: Array<{
                    annotations: { startsNewHistoryGroup?: boolean };
                }>;
            };
        };
        expect(payload.transactionReplay?.transactions[0]?.annotations.startsNewHistoryGroup).toBe(
            false,
        );

        const events: EventRecord[] = [
            {
                id: 1,
                eventType: "doc_change",
                payload: JSON.stringify(payload),
                createdAt: 1,
            },
        ];
        let restored = reconstructState(snapshot, events, extensions);
        expect(restored.doc.toString()).toBe("ab");
        expect(undoDepth(restored)).toBe(1);
        expect(
            undo({
                state: restored,
                dispatch: (transaction) => {
                    restored = transaction.state;
                },
            }),
        ).toBe(true);
        expect(restored.doc.toString()).toBe("");
    });

    it("preserves a selection boundary when CodeMirror trims the history branch", () => {
        const payloads: object[] = [];
        const extensions = [
            persistHistoryFacet.of(true),
            persistentHistoryExtension,
            history({ minDepth: 1, newGroupDelay: 250 }),
            annotationExtensions(),
            EditorView.updateListener.of((update) => {
                const payload = buildEventPayload(update);
                if (payload) payloads.push(payload);
            }),
        ];
        const state = EditorState.create({ extensions });
        const parent = document.createElement("div");
        document.body.appendChild(parent);
        view = new EditorView({ state, parent });

        for (let index = 0; index < 21; index++) {
            view.dispatch({
                changes: { from: index, insert: "a" },
                selection: EditorSelection.cursor(index + 1),
                annotations: [
                    Transaction.time.of(index * 1_000),
                    Transaction.userEvent.of("input.type"),
                ],
            });
        }
        expect(undoDepth(view.state)).toBe(21);
        const snapshot = JSON.stringify(view.state.toJSON(savedFields));
        payloads.length = 0;

        view.dispatch({
            selection: EditorSelection.single(0, 1),
            annotations: [Transaction.time.of(20_050), Transaction.userEvent.of("select")],
        });
        view.dispatch({
            selection: EditorSelection.cursor(21),
            annotations: [Transaction.time.of(20_075), Transaction.userEvent.of("select")],
        });
        view.dispatch({
            changes: { from: 21, insert: "b" },
            selection: EditorSelection.cursor(22),
            annotations: [Transaction.time.of(20_100), Transaction.userEvent.of("input.type")],
        });

        expect(payloads).toHaveLength(1);
        expect(undoDepth(view.state)).toBe(3);
        const payload = payloads[0] as {
            transactionReplay?: {
                transactions: Array<{
                    annotations: { startsNewHistoryGroup?: boolean };
                }>;
            };
        };
        expect(payload.transactionReplay?.transactions[0]?.annotations.startsNewHistoryGroup).toBe(
            true,
        );

        const events: EventRecord[] = [
            {
                id: 1,
                eventType: "doc_change",
                payload: JSON.stringify(payload),
                createdAt: 1,
            },
        ];
        let restored = reconstructState(snapshot, events, extensions);
        expect(undoDepth(restored)).toBe(3);

        expect(undo(view)).toBe(true);
        expect(
            undo({
                state: restored,
                dispatch: (transaction) => {
                    restored = transaction.state;
                },
            }),
        ).toBe(true);
        expect(restored.doc.toString()).toBe(view.state.doc.toString());
        expect(restored.selection.eq(view.state.selection)).toBe(true);
    });

    it("recreates an omitted empty-branch selection sentinel before history trimming", () => {
        const payloads: object[] = [];
        const extensions = [
            persistHistoryFacet.of(true),
            persistentHistoryExtension,
            history({ minDepth: 1, newGroupDelay: 250 }),
            annotationExtensions(),
            EditorView.updateListener.of((update) => {
                const payload = buildEventPayload(update);
                if (payload) payloads.push(payload);
            }),
        ];
        const state = EditorState.create({ doc: "z", extensions });
        const parent = document.createElement("div");
        document.body.appendChild(parent);
        view = new EditorView({ state, parent });

        const snapshot = JSON.stringify(view.state.toJSON(savedFields));
        view.dispatch({
            selection: EditorSelection.cursor(1),
            annotations: [Transaction.time.of(100), Transaction.userEvent.of("select")],
        });
        expect(payloads).toHaveLength(0);

        for (let index = 0; index < 21; index++) {
            const from = view.state.doc.length;
            view.dispatch({
                changes: { from, insert: "x" },
                selection: EditorSelection.cursor(from + 1),
                annotations: [
                    Transaction.time.of(1_000 + index * 1_000),
                    Transaction.userEvent.of("input.type"),
                ],
            });
        }

        expect(payloads).toHaveLength(21);
        expect(undoDepth(view.state)).toBe(3);
        const firstPayload = payloads[0] as {
            transactionReplay?: {
                transactions: Array<{
                    annotations: { startsNewHistoryGroup?: boolean };
                }>;
            };
        };
        expect(
            firstPayload.transactionReplay?.transactions[0]?.annotations.startsNewHistoryGroup,
        ).toBe(true);

        const events: EventRecord[] = payloads.map((payload, index) => ({
            id: index + 1,
            eventType: (payload as { type: string }).type,
            payload: JSON.stringify(payload),
            createdAt: index + 1,
        }));
        let restored = reconstructState(snapshot, events, extensions);

        expect(restored.doc.toString()).toBe(view.state.doc.toString());
        expect(undoDepth(restored)).toBe(undoDepth(view.state));
        expect(
            undo({
                state: restored,
                dispatch: (transaction) => {
                    restored = transaction.state;
                },
            }),
        ).toBe(true);
        expect(restored.doc.toString()).toBe(`z${"x".repeat(20)}`);
    });

    it.each([false, true])(
        "recreates an omitted empty-branch selection sentinel before redo with persistHistory=%s",
        (persistHistory) => {
            const payloads: object[] = [];
            const extensions = [
                persistHistoryFacet.of(persistHistory),
                persistentHistoryExtension,
                history({ minDepth: 1, newGroupDelay: 250 }),
                annotationExtensions(),
                EditorView.updateListener.of((update) => {
                    const payload = buildEventPayload(update);
                    if (payload) payloads.push(payload);
                }),
            ];
            const state = EditorState.create({ doc: "z", extensions });
            const parent = document.createElement("div");
            document.body.appendChild(parent);
            view = new EditorView({ state, parent });

            view.dispatch({
                changes: { from: 1, insert: "r" },
                selection: EditorSelection.cursor(2),
                annotations: [Transaction.time.of(1_000), Transaction.userEvent.of("input.type")],
            });
            expect(undo(view)).toBe(true);
            expect(view.state.doc.toString()).toBe("z");
            const snapshot = JSON.stringify(view.state.toJSON(savedFields));
            payloads.length = 0;

            // The done branch is empty after undo. This unpersisted movement
            // creates CodeMirror's changeless selection sentinel before redo.
            view.dispatch({
                selection: EditorSelection.cursor(1),
                annotations: [Transaction.time.of(1_050), Transaction.userEvent.of("select")],
            });
            expect(payloads).toHaveLength(0);
            expect(redo(view)).toBe(true);

            for (let index = 0; index < 20; index++) {
                const from = view.state.doc.length;
                view.dispatch({
                    changes: { from, insert: "x" },
                    selection: EditorSelection.cursor(from + 1),
                    annotations: [
                        Transaction.time.of(2_000 + index * 1_000),
                        Transaction.userEvent.of("input.type"),
                    ],
                });
            }

            expect(payloads).toHaveLength(21);
            expect(undoDepth(view.state)).toBe(3);
            const redoPayload = payloads[0] as {
                transactionReplay?: {
                    transactions: Array<{
                        kind: string;
                        fallback?: {
                            annotations: { startsWithSelectionSentinel?: boolean };
                        };
                    }>;
                };
            };
            expect(redoPayload.transactionReplay?.transactions[0]?.kind).toBe("redo");
            expect(
                redoPayload.transactionReplay?.transactions[0]?.fallback?.annotations
                    .startsWithSelectionSentinel,
            ).toBe(true);

            const events: EventRecord[] = payloads.map((payload, index) => ({
                id: index + 1,
                eventType: (payload as { type: string }).type,
                payload: JSON.stringify(payload),
                createdAt: index + 1,
            }));
            const restored = reconstructState(snapshot, events, extensions);

            expect(restored.doc.toString()).toBe(view.state.doc.toString());
            expect(undoDepth(restored)).toBe(persistHistory ? undoDepth(view.state) : 0);
            expect(redoDepth(restored)).toBe(0);
        },
    );

    it.each([false, true])(
        "replays undo, redo, and group-only tails with persistHistory=%s",
        (persistHistory) => {
            const payloads: object[] = [];
            const extensions = [
                persistHistoryFacet.of(persistHistory),
                persistentHistoryExtension,
                history(),
                annotationExtensions(),
                EditorView.updateListener.of((update) => {
                    const payload = buildEventPayload(update);
                    if (payload) payloads.push(payload);
                }),
            ];
            const state = EditorState.create({ doc: "ab", extensions });
            const parent = document.createElement("div");
            document.body.appendChild(parent);
            view = new EditorView({ state, parent });

            const firstVersion = makeVersion({ doc: "a" });
            const secondVersion = makeVersion({ doc: "b" });
            const firstRevision = {
                ...createNewAnnotation(
                    view.state.field(annotationField),
                    EditorSelection.single(0, 1),
                    "revision",
                ),
                activeVersionId: firstVersion.id,
                versions: [firstVersion],
            };
            const secondRevision = {
                ...createNewAnnotation(
                    { [firstRevision.id]: firstRevision },
                    EditorSelection.single(1, 2),
                    "revision",
                ),
                activeVersionId: secondVersion.id,
                versions: [secondVersion],
            };
            view.dispatch({
                effects: [addAnnotation.of(firstRevision), addAnnotation.of(secondRevision)],
            });
            view.dispatch({ changes: { from: 2, insert: "!" } });

            const snapshot = JSON.stringify(view.state.toJSON(savedFields));
            payloads.length = 0;

            expect(undo(view)).toBe(true);
            expect(redo(view)).toBe(true);
            const { spec, groupId } = createVersionGroup("Linked", [
                { revisionId: firstRevision.id, versionId: firstVersion.id },
                { revisionId: secondRevision.id, versionId: secondVersion.id },
            ]);
            view.dispatch(spec);

            expect(payloads.map((payload) => (payload as { type: string }).type)).toEqual([
                "doc_change",
                "doc_change",
                "state_transaction",
            ]);
            const events: EventRecord[] = payloads.map((payload, index) => ({
                id: index,
                eventType: (payload as { type: string }).type,
                payload: JSON.stringify(payload),
                createdAt: index,
            }));
            const restored = reconstructState(snapshot, events, extensions);

            expect(restored.doc.toString()).toBe(view.state.doc.toString());
            expect(restored.toJSON({ annotationField, versionGroupField })).toEqual(
                view.state.toJSON({ annotationField, versionGroupField }),
            );
            expect(restored.field(versionGroupField)[groupId]).toBeDefined();
            expect(undoDepth(restored)).toBe(persistHistory ? undoDepth(view.state) : 0);
            expect(redoDepth(restored)).toBe(persistHistory ? redoDepth(view.state) : 0);

            view.destroy();
            view = undefined;
        },
    );

    it.each([true, false])(
        "clears snapshot history across a history-disabled collaboration tail with persistHistory=%s",
        (persistHistory) => {
            const payloads: object[] = [];
            const historyRuntime = new Compartment();
            const extensions = [
                persistHistoryFacet.of(persistHistory),
                persistentHistoryStateExtension,
                historyRuntime.of([persistentHistoryRuntimeExtension, history()]),
                annotationExtensions(),
                EditorView.updateListener.of((update) => {
                    const payload = buildEventPayload(update);
                    if (payload) payloads.push(payload);
                }),
            ];
            const state = EditorState.create({ doc: "abc", extensions });
            const parent = document.createElement("div");
            document.body.appendChild(parent);
            view = new EditorView({ state, parent });

            view.dispatch({
                changes: { from: 3, insert: "!" },
                annotations: isolateHistory.of("full"),
            });
            expect(undoDepth(view.state)).toBe(1);
            const snapshot = JSON.stringify(view.state.toJSON(savedFields));
            payloads.length = 0;

            // Live collaboration swaps CodeMirror history out for Y.UndoManager.
            // The reconfiguration itself has no semantic state to persist.
            view.dispatch({ effects: historyRuntime.reconfigure([]) });
            expect(payloads).toHaveLength(0);

            const version = makeVersion({ doc: "abc" });
            const revision = {
                ...createNewAnnotation(
                    view.state.field(annotationField),
                    EditorSelection.single(0, 3),
                    "revision",
                ),
                activeVersionId: version.id,
                versions: [version],
            };
            // A local semantic edit has no addToHistory annotation by default,
            // but it cannot enter CM history while the runtime field is absent.
            view.dispatch({ effects: addAnnotation.of(revision) });
            // Simulate the remote Yjs projection that rebases the local revision.
            view.dispatch({
                changes: { from: 0, insert: "R" },
                annotations: Transaction.addToHistory.of(false),
            });

            expect(payloads).toHaveLength(2);
            const localTrace = payloads[0] as {
                transactionReplay?: {
                    transactions: Array<{
                        annotations?: {
                            addToHistory?: boolean;
                            historyRuntimeDisabled?: boolean;
                        };
                    }>;
                };
            };
            expect(localTrace.transactionReplay?.transactions[0]?.annotations).toMatchObject({
                addToHistory: false,
                historyRuntimeDisabled: true,
            });

            // A transaction after leaving collaboration must also replay without
            // history once the tail has crossed the unsafe boundary.
            view.dispatch({
                effects: historyRuntime.reconfigure([persistentHistoryRuntimeExtension, history()]),
            });
            view.dispatch({ changes: { from: view.state.doc.length, insert: "?" } });
            expect(undoDepth(view.state)).toBe(1);
            expect(payloads).toHaveLength(3);

            const events: EventRecord[] = payloads.map((payload, index) => ({
                id: index + 1,
                eventType: (payload as { type: string }).type,
                payload: JSON.stringify(payload),
                createdAt: index + 1,
            }));
            const restored = reconstructState(snapshot, events, extensions);

            expect(restored.doc.toString()).toBe(view.state.doc.toString());
            expect(restored.toJSON({ annotationField, versionGroupField })).toEqual(
                view.state.toJSON({ annotationField, versionGroupField }),
            );
            expect(undoDepth(restored)).toBe(0);
            expect(redoDepth(restored)).toBe(0);
        },
    );

    it("fails closed when an undo trace disagrees with its exact fallback", () => {
        view = createView("abc");
        const comment = createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(0, 1),
            "comment",
        );
        view.dispatch({
            effects: addAnnotation.of(comment),
            annotations: isolateHistory.of("full"),
        });
        view.dispatch({
            changes: { from: 3, insert: "1" },
            annotations: isolateHistory.of("full"),
        });
        view.dispatch({
            changes: { from: 4, insert: "2" },
            annotations: isolateHistory.of("full"),
        });
        expect(undoDepth(view.state)).toBeGreaterThan(1);

        const snapshot = JSON.stringify(view.state.toJSON(savedFields));
        const fallbackChangeSet = view.state.changes({ from: 0, to: 1, insert: "A" }).toJSON();
        const laterChangeSet = view.state.changes({ from: 5, insert: "!" }).toJSON();
        const events: EventRecord[] = [
            {
                id: 1,
                eventType: "state_transaction",
                createdAt: 1,
                payload: JSON.stringify({
                    type: "state_transaction",
                    transactionReplay: {
                        version: 1,
                        transactions: [
                            {
                                kind: "undo",
                                fallback: {
                                    kind: "transaction",
                                    changeSet: fallbackChangeSet,
                                    effects: [],
                                    selection: {
                                        ranges: [{ anchor: 1, head: 4 }],
                                        main: 0,
                                    },
                                    annotations: {
                                        addToHistory: false,
                                        userEvent: "undo",
                                    },
                                },
                            },
                        ],
                    },
                }),
            },
            {
                id: 2,
                eventType: "state_transaction",
                createdAt: 2,
                payload: JSON.stringify({
                    type: "state_transaction",
                    transactionReplay: {
                        version: 1,
                        transactions: [
                            {
                                kind: "transaction",
                                changeSet: laterChangeSet,
                                effects: [],
                                annotations: { addToHistory: true },
                            },
                        ],
                    },
                }),
            },
        ];
        const extensions = [
            persistHistoryFacet.of(true),
            persistentHistoryExtension,
            history(),
            annotationExtensions(),
        ];
        const restored = reconstructState(snapshot, events, extensions);

        expect(restored.doc.toString()).toBe("Abc12!");
        expect(restored.selection.main.anchor).toBe(1);
        expect(restored.selection.main.head).toBe(4);
        expect(restored.field(annotationField)[comment.id]).toBeDefined();
        expect(undoDepth(restored)).toBe(0);
        expect(redoDepth(restored)).toBe(0);
    });

    it("applies the exact transaction but clears history on malformed selection metadata", () => {
        view = createView("abc");
        view.dispatch({
            changes: { from: 3, insert: "1" },
            annotations: isolateHistory.of("full"),
        });
        const snapshot = JSON.stringify(view.state.toJSON(savedFields));
        const events: EventRecord[] = [
            {
                id: 1,
                eventType: "doc_change",
                createdAt: 1,
                payload: JSON.stringify({
                    type: "doc_change",
                    changes: [{ from: 4, to: 4, insert: "!" }],
                    selection: { ranges: [{ anchor: 5, head: 5 }], main: 0 },
                    transactionReplay: {
                        version: 1,
                        transactions: [
                            {
                                kind: "transaction",
                                changeSet: view.state.changes({ from: 4, insert: "!" }).toJSON(),
                                effects: [],
                                annotations: {
                                    addToHistory: true,
                                    doneTopSelectionsAfter: "not-an-array",
                                },
                            },
                        ],
                    },
                }),
            },
        ];
        const extensions = [
            persistHistoryFacet.of(true),
            persistentHistoryExtension,
            history(),
            annotationExtensions(),
        ];
        const restored = reconstructState(snapshot, events, extensions);

        expect(restored.doc.toString()).toBe("abc1!");
        expect(undoDepth(restored)).toBe(0);
        expect(redoDepth(restored)).toBe(0);
    });

    it.each(["undo", "redo"] as const)(
        "applies the exact %s fallback when selection metadata is malformed",
        (kind) => {
            const payloads: object[] = [];
            const extensions = [
                persistHistoryFacet.of(true),
                persistentHistoryExtension,
                history(),
                annotationExtensions(),
                EditorView.updateListener.of((update) => {
                    const payload = buildEventPayload(update);
                    if (payload) payloads.push(payload);
                }),
            ];
            const state = EditorState.create({ doc: "a", extensions });
            const parent = document.createElement("div");
            document.body.appendChild(parent);
            view = new EditorView({ state, parent });

            view.dispatch({
                changes: { from: 1, insert: "b" },
                annotations: isolateHistory.of("full"),
            });
            if (kind === "redo") expect(undo(view)).toBe(true);
            const snapshot = JSON.stringify(view.state.toJSON(savedFields));
            payloads.length = 0;

            expect(kind === "undo" ? undo(view) : redo(view)).toBe(true);
            expect(payloads).toHaveLength(1);
            const liveDoc = view.state.doc.toString();
            const payload = structuredClone(payloads[0]) as {
                type: string;
                transactionReplay: {
                    transactions: Array<{
                        kind: string;
                        fallback?: {
                            annotations: { doneTopSelectionsAfter?: unknown };
                        };
                    }>;
                };
            };
            const entry = payload.transactionReplay.transactions[0];
            expect(entry.kind).toBe(kind);
            expect(entry.fallback).toBeDefined();
            entry.fallback!.annotations.doneTopSelectionsAfter = "not-an-array";

            const events: EventRecord[] = [
                {
                    id: 1,
                    eventType: payload.type,
                    payload: JSON.stringify(payload),
                    createdAt: 1,
                },
            ];
            const restored = reconstructState(snapshot, events, extensions);
            expect(restored.doc.toString()).toBe(liveDoc);
            expect(undoDepth(restored)).toBe(0);
            expect(redoDepth(restored)).toBe(0);
        },
    );

    it("rejects an array-shaped annotation state fallback without erasing annotations", () => {
        view = createView("abc");
        const comment = createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(0, 1),
            "comment",
        );
        view.dispatch({
            effects: addAnnotation.of(comment),
            annotations: isolateHistory.of("full"),
        });
        const snapshot = JSON.stringify(view.state.toJSON(savedFields));
        const events: EventRecord[] = [
            {
                id: 1,
                eventType: "state_transaction",
                createdAt: 1,
                payload: JSON.stringify({
                    type: "state_transaction",
                    stateFallback: {
                        doc: "corrupt",
                        annotations: [],
                        versionGroups: {},
                        selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 },
                    },
                }),
            },
        ];
        const extensions = [
            persistHistoryFacet.of(true),
            persistentHistoryExtension,
            history(),
            annotationExtensions(),
        ];
        const restored = reconstructState(snapshot, events, extensions);

        expect(restored.doc.toString()).toBe("abc");
        expect(restored.field(annotationField)[comment.id]).toBeDefined();
        expect(undoDepth(restored)).toBe(0);
        expect(redoDepth(restored)).toBe(0);
    });
});
