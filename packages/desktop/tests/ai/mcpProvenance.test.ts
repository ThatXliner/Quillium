import { createMcpEditorSession } from "$lib/ai/mcpEditor";
import type { EventRecord } from "$lib/db/types";
import { buildEventPayload } from "$lib/editor/listeners";
import { persistHistoryFacet, persistentHistoryExtension } from "$lib/editor/persistentHistory";
import { annotations } from "$lib/editor/plugins/annotations";
import {
    addAnnotation,
    aiEditProvenance,
    annotationField,
    revisionInternalEdit,
    revisionProvenance,
} from "$lib/editor/plugins/annotations/annotationField";
import { createNewAnnotation, makeVersion } from "$lib/editor/plugins/annotations/models";
import { buildTextOrigin } from "$lib/provenance/textOrigin";
import { history, redo, undo } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { expect, it } from "vitest";

it.each(["", "Before. "])(
    "keeps active-branch dictation separately attributed after %j",
    (prefix) => {
        const ai = {
            requestId: "ai-before",
            task: "local-rewrite" as const,
            provider: "test",
            model: "test",
            createdAt: 1,
        };
        const version = makeVersion({
            doc: "Existing AI wording.",
            provenance: "ai",
            aiProvenance: ai,
        });
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
        view.dispatch({
            changes: { from: 0, insert: prefix + version.doc },
            annotations: [
                revisionInternalEdit.of(true),
                revisionProvenance.of("ai"),
                aiEditProvenance.of([ai]),
            ],
        });
        view.dispatch({
            effects: addAnnotation.of({
                ...createNewAnnotation(
                    view.state.field(annotationField),
                    EditorSelection.single(prefix.length, prefix.length + version.doc.length),
                    "revision",
                ),
                status: "active",
                thread: [],
                versions: [version],
                activeVersionId: version.id,
            }),
        });
        const identity = { documentId: "doc", tabId: "tab", draftId: "draft" };
        const session = createMcpEditorSession(() => ({ rootView: view, identity, metadata: {} }));
        try {
            expect(buildTextOrigin(events).spans).toEqual([
                { from: 0, to: prefix.length + version.doc.length, origin: "ai" },
            ]);
            view.dispatch({ selection: { anchor: prefix.length + 3 } });
            const ctx = session.handle("get_editor_context", {
                target: { ...identity, revisionPath: [{ revisionId: 0, versionId: version.id }] },
            });
            const result = session.handle("apply_editorial_action", {
                contextId: ctx.contextId,
                requestId: "human-raw",
                action: "insert_dictation",
                position: version.doc.length,
                text: " Human dictation.",
                label: "Dictation",
                threadMessage: "Raw words",
            });
            expect(result.ok).toBe(true);
            expect(view.state.selection.main.head).toBe(prefix.length + 3);
            expect(buildTextOrigin(events)).toEqual({
                text: `${prefix}Existing AI wording. Human dictation.`,
                spans: [
                    { from: 0, to: prefix.length + version.doc.length, origin: "ai" },
                    {
                        from: prefix.length + version.doc.length,
                        to: prefix.length + 37,
                        origin: "human",
                    },
                ],
            });
            expect(undo(view)).toBe(true);
            expect(buildTextOrigin(events)).toEqual({
                text: prefix + version.doc,
                spans: [{ from: 0, to: prefix.length + version.doc.length, origin: "ai" }],
            });
            expect(redo(view)).toBe(true);
            expect(buildTextOrigin(events).spans).toEqual([
                { from: 0, to: prefix.length + version.doc.length, origin: "ai" },
                {
                    from: prefix.length + version.doc.length,
                    to: prefix.length + 37,
                    origin: "human",
                },
            ]);
        } finally {
            session.dispose();
            view.destroy();
        }
    },
);
