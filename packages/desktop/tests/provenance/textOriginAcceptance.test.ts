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
import { createNewAnnotation, makeVersion } from "$lib/editor/plugins/annotations/models";
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
