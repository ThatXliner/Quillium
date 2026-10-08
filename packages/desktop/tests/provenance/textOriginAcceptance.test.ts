/** Exercise the real suggestion command, event capture, and origin reconstruction. */
import type { EventRecord } from "$lib/db/types";
import { buildEventPayload } from "$lib/editor/listeners";
import { persistHistoryFacet, persistentHistoryExtension } from "$lib/editor/persistentHistory";
import { annotations } from "$lib/editor/plugins/annotations";
import {
    addAnnotation,
    annotationField,
    applySuggestion,
    removeAnnotation,
    setActiveRevisionVersion,
} from "$lib/editor/plugins/annotations/annotationField";
import {
    activeVersion,
    createNewAnnotation,
    isAnnotationOfType,
    makeVersion,
} from "$lib/editor/plugins/annotations/models";
import { translateAndDispatch } from "$lib/editor/plugins/annotations/nestedEditor";
import { buildTextOrigin } from "$lib/provenance/textOrigin";
import { history, redo, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { expect, it } from "vitest";

it("tracks accepted AI suggestion wording through edits, undo/redo and event-log reopening", () => {
    const events: EventRecord[] = [];
    const view = new EditorView({
        state: EditorState.create({
            extensions: [
                persistHistoryFacet.of(true),
                persistentHistoryExtension,
                history(),
                annotations(),
                EditorView.updateListener.of((update) => {
                    const payload = buildEventPayload(update);
                    if (payload)
                        events.push({
                            id: events.length,
                            createdAt: events.length,
                            eventType: payload.type,
                            payload: JSON.stringify(payload),
                        });
                }),
            ],
        }),
        parent: document.body,
    });
    try {
        view.dispatch({
            changes: { from: 0, insert: "Hello world" },
            annotations: Transaction.userEvent.of("input.type"),
        });
        const suggestion = {
            ...createNewAnnotation(
                view.state.field(annotationField),
                EditorSelection.single(0, 5),
                "suggestion",
            ),
            replacements: [{ text: "Hi" }],
            aiProvenance: {
                requestId: "test-request",
                task: "local-rewrite" as const,
                provider: "openai",
                model: "test",
                createdAt: 1,
            },
        };
        view.dispatch({ effects: addAnnotation.of(suggestion) });
        expect(buildTextOrigin(events).spans).toEqual([{ from: 0, to: 11, origin: "human" }]);
        view.dispatch(applySuggestion(view.state, suggestion.id, 0));
        expect(buildTextOrigin(events)).toEqual({
            text: "Hi world",
            spans: [
                { from: 0, to: 2, origin: "ai" },
                { from: 2, to: 8, origin: "human" },
            ],
        });
        view.dispatch({
            changes: { from: 0, to: 2, insert: "Hey" },
            annotations: Transaction.userEvent.of("input.type"),
        });
        expect(buildTextOrigin(events).spans[0].origin).toBe("edited-ai");
        undo(view);
        expect(buildTextOrigin(events).spans[0]).toEqual({ from: 0, to: 2, origin: "ai" });
        undo(view);
        expect(buildTextOrigin(events).spans).toEqual([{ from: 0, to: 11, origin: "human" }]);
        redo(view);
        expect(buildTextOrigin(events).spans[0].origin).toBe("ai");
        const reopened = buildTextOrigin(JSON.parse(JSON.stringify(events)));
        expect(reopened.text).toBe(view.state.doc.toString());
        expect(reopened.spans[0].origin).toBe("ai");
        const rejected = { ...suggestion, id: 1, selection: EditorSelection.single(3, 8) };
        view.dispatch({ effects: addAnnotation.of(rejected) });
        view.dispatch({ effects: removeAnnotation.of(rejected) });
        expect(buildTextOrigin(events)).toEqual(reopened);
    } finally {
        view.destroy();
    }
});

it("restores human wording when selecting an untouched human revision version", () => {
    const events: EventRecord[] = [];
    const view = new EditorView({
        state: EditorState.create({
            doc: "Original",
            extensions: [
                persistHistoryFacet.of(true),
                persistentHistoryExtension,
                history(),
                annotations(),
                EditorView.updateListener.of((update) => {
                    const payload = buildEventPayload(update);
                    if (payload)
                        events.push({
                            id: events.length,
                            createdAt: events.length,
                            eventType: payload.type,
                            payload: JSON.stringify(payload),
                        });
                }),
            ],
        }),
        parent: document.body,
    });
    try {
        const human = makeVersion({ doc: "Original", provenance: "human" });
        const ai = makeVersion({ doc: "Generated", provenance: "ai" });
        const revision = {
            ...createNewAnnotation(
                view.state.field(annotationField),
                EditorSelection.single(0, 8),
                "revision",
            ),
            activeVersionId: human.id,
            versions: [human, ai],
        };
        view.dispatch({ effects: addAnnotation.of(revision) });
        view.dispatch(setActiveRevisionVersion(view.state, revision.id, ai.id));
        expect(buildTextOrigin(events, "Original").spans[0].origin).toBe("ai");
        view.dispatch(setActiveRevisionVersion(view.state, revision.id, human.id));
        expect(buildTextOrigin(events, "Original")).toEqual({
            text: "Original",
            spans: [{ from: 0, to: 8, origin: "human" }],
        });
        undo(view);
        expect(buildTextOrigin(events, "Original").spans[0].origin).toBe("ai");
        redo(view);
        expect(buildTextOrigin(events, "Original").spans[0].origin).toBe("human");
    } finally {
        view.destroy();
    }
});

it("preserves accepted AI suggestion origin through nested parent dispatch", () => {
    const events: EventRecord[] = [];
    const parent = new EditorView({
        state: EditorState.create({
            doc: "Hello world",
            extensions: [
                persistHistoryFacet.of(true),
                persistentHistoryExtension,
                history(),
                annotations(),
                EditorView.updateListener.of((update) => {
                    const payload = buildEventPayload(update);
                    if (payload)
                        events.push({
                            id: events.length,
                            createdAt: events.length,
                            eventType: payload.type,
                            payload: JSON.stringify(payload),
                        });
                }),
            ],
        }),
        parent: document.body,
    });
    const version = makeVersion({ doc: "Hello world", provenance: "human" });
    const revision = {
        ...createNewAnnotation(
            parent.state.field(annotationField),
            EditorSelection.single(0, 11),
            "revision",
        ),
        activeVersionId: version.id,
        versions: [version],
    };
    parent.dispatch({ effects: addAnnotation.of(revision) });
    const nested = new EditorView({
        state: EditorState.create({
            doc: "Hello world",
            extensions: [
                annotations(),
                EditorView.updateListener.of((update) => {
                    translateAndDispatch(update, parent, revision.id);
                }),
            ],
        }),
        parent: document.body,
    });
    try {
        const suggestion = {
            ...createNewAnnotation(
                nested.state.field(annotationField),
                EditorSelection.single(0, 5),
                "suggestion",
            ),
            replacements: [{ text: "Hi" }],
            aiProvenance: {
                requestId: "nested-request",
                task: "local-rewrite" as const,
                provider: "openai",
                model: "test",
                createdAt: 1,
            },
        };
        nested.dispatch({ effects: addAnnotation.of(suggestion) });
        nested.dispatch(applySuggestion(nested.state, suggestion.id, 0));
        expect(buildTextOrigin(events, "Hello world")).toEqual({
            text: "Hi world",
            spans: [
                { from: 0, to: 2, origin: "ai" },
                { from: 2, to: 8, origin: "unknown" },
            ],
        });
        const updated = parent.state.field(annotationField)[revision.id];
        expect(isAnnotationOfType(updated, "revision") && activeVersion(updated).provenance).toBe(
            "mixed",
        );
        expect(JSON.parse(events.at(-1)!.payload).provenance.aiGenerations).toEqual([
            suggestion.aiProvenance,
        ]);
        nested.dispatch({
            changes: { from: 8, insert: "!" },
            annotations: Transaction.userEvent.of("input.type"),
        });
        undo(parent);
        expect(buildTextOrigin(events, "Hello world").text).toBe("Hi world");
        expect(buildTextOrigin(events, "Hello world").spans[0].origin).toBe("ai");
        undo(parent);
        expect(buildTextOrigin(events, "Hello world").text).toBe("Hello world");
        redo(parent);
        expect(buildTextOrigin(events, "Hello world").spans[0].origin).toBe("ai");
    } finally {
        nested.destroy();
        parent.destroy();
    }
});

it("does not upgrade mixed AI wording when selecting a nested revision version", () => {
    const events: EventRecord[] = [];
    const parent = new EditorView({
        state: EditorState.create({
            doc: "Original",
            extensions: [
                persistHistoryFacet.of(true),
                persistentHistoryExtension,
                history(),
                annotations(),
                EditorView.updateListener.of((update) => {
                    const payload = buildEventPayload(update);
                    if (payload)
                        events.push({
                            id: events.length,
                            createdAt: events.length,
                            eventType: payload.type,
                            payload: JSON.stringify(payload),
                        });
                }),
            ],
        }),
        parent: document.body,
    });
    const outerVersion = makeVersion({ doc: "Original", provenance: "human" });
    const outer = {
        ...createNewAnnotation(
            parent.state.field(annotationField),
            EditorSelection.single(0, 8),
            "revision",
        ),
        activeVersionId: outerVersion.id,
        versions: [outerVersion],
    };
    parent.dispatch({ effects: addAnnotation.of(outer) });
    const nested = new EditorView({
        state: EditorState.create({
            doc: "Original",
            extensions: [
                annotations(),
                EditorView.updateListener.of((update) => {
                    translateAndDispatch(update, parent, outer.id);
                }),
            ],
        }),
        parent: document.body,
    });
    try {
        const original = makeVersion({ doc: "Original", provenance: "human" });
        const mixed = makeVersion({
            doc: "AI with writer edits",
            provenance: "mixed",
            aiProvenance: {
                requestId: "mixed-request",
                task: "local-rewrite" as const,
                provider: "openai",
                model: "test",
                createdAt: 1,
            },
        });
        const inner = {
            ...createNewAnnotation(
                nested.state.field(annotationField),
                EditorSelection.single(0, 8),
                "revision",
            ),
            activeVersionId: original.id,
            versions: [original, mixed],
        };
        nested.dispatch({ effects: addAnnotation.of(inner) });
        nested.dispatch(setActiveRevisionVersion(nested.state, inner.id, mixed.id));
        const result = buildTextOrigin(events, "Original");
        expect(result.text).toBe("AI with writer edits");
        expect(result.spans.some((span) => span.origin === "ai")).toBe(false);
        const updated = parent.state.field(annotationField)[outer.id];
        expect(isAnnotationOfType(updated, "revision") && activeVersion(updated).provenance).toBe(
            "mixed",
        );
    } finally {
        nested.destroy();
        parent.destroy();
    }
});
