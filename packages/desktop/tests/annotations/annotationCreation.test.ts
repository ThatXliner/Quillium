// annotationCreation.test.ts — Creation policies shared by commands, modals, and AI tools.
import {
    annotations,
    createAnnotation,
    createComment,
    createCommentCommand,
    createRevision,
    createSuggestion,
} from "$lib/editor/plugins/annotations";
import { annotationField } from "$lib/editor/plugins/annotations/annotationField";
import {
    type AiGenerationProvenance,
    isAnnotationOfType,
} from "$lib/editor/plugins/annotations/models";
import { annotationEventBus } from "$lib/events/annotationEventBus";
import posthog from "$lib/posthog";
import { updateSettings } from "$lib/settings.svelte";
import { history, redo, undo } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/posthog", () => ({ default: { capture: vi.fn() } }));

const aiProvenance: AiGenerationProvenance = {
    requestId: "creation-test",
    task: "local-rewrite",
    provider: "test",
    model: "test",
    createdAt: 1,
};
let view: EditorView;
const unsubs: (() => void)[] = [];
function createView(): EditorView {
    view = new EditorView({
        state: EditorState.create({
            doc: "hello world",
            selection: EditorSelection.single(0, 5),
            extensions: [history(), annotations()],
        }),
    });
    return view;
}

afterEach(() => {
    view?.destroy();
    for (const unsub of unsubs.splice(0)) unsub();
    annotationEventBus.clearPendingSelections();
    updateSettings({ autoVersionOnRevisionCreate: true, selectTextInNestedEditor: true });
    vi.clearAllMocks();
});

describe("annotation creation policies", () => {
    it("allows active AI feedback while a human comment is pending", () => {
        createView();
        expect(createCommentCommand(view)).toBe(true);
        const alert = vi.fn();
        unsubs.push(annotationEventBus.on("pending-comment-alert", alert));
        expect(createCommentCommand(view)).toBe(true);
        expect(alert).toHaveBeenCalledOnce();
        expect(createComment({ view, targetText: "world", comment: "Note", aiProvenance })).toBe(
            true,
        );
        const [pending, active] = Object.values(view.state.field(annotationField));
        expect(pending.status).toBe("pending");
        expect(active).toMatchObject({
            status: "active",
            aiProvenance,
            thread: [{ author: "AI", message: "Note" }],
        });
        expect(active.selection.main.from).toBe(6);
        expect(view.state.selection.main.to).toBe(5);
    });

    it.each([false, true])(
        "creates modal revisions with auto-version %s and undoable contained comments",
        (autoVersion) => {
            createView();
            updateSettings({ autoVersionOnRevisionCreate: autoVersion });
            createComment({ view, targetText: "hello", comment: "Keep this" });
            const focus = vi.fn();
            unsubs.push(annotationEventBus.on("pending-nested-editor-selection", focus));
            expect(
                createAnnotation({
                    state: view.state,
                    dispatch: (transaction) => view.dispatch(transaction),
                    creation: { source: "human", type: "revision", nested: true },
                }),
            ).toBe(true);
            const [revision] = Object.values(view.state.field(annotationField));
            if (!isAnnotationOfType(revision, "revision")) throw new Error("Expected revision");
            expect(revision.versions[0]).toMatchObject({
                doc: "hello",
                annotationField: { 0: { thread: [{ message: "Keep this" }] } },
            });
            expect(revision.versions).toHaveLength(autoVersion ? 2 : 1);
            expect(revision.activeVersionId).toBe(revision.versions[autoVersion ? 1 : 0].id);
            expect(view.state.doc.toString()).toBe(autoVersion ? " world" : "hello world");
            expect(focus).toHaveBeenCalledWith(
                expect.objectContaining({ from: 0, to: autoVersion ? 0 : 5, focus: true }),
            );
            expect(posthog.capture).toHaveBeenCalledWith("annotation_created", {
                type: "revision",
                auto_version: autoVersion,
                nested: true,
            });
            expect(undo(view)).toBe(true);
            expect(view.state.doc.toString()).toBe("hello world");
            expect(Object.values(view.state.field(annotationField))).toEqual([
                expect.objectContaining({
                    thread: [{ message: "Keep this", author: "AI", time: expect.any(Number) }],
                }),
            ]);
            expect(redo(view)).toBe(true);
            expect(Object.values(view.state.field(annotationField))).toEqual([revision]);
        },
    );

    it("keeps the original active for AI revisions despite the human auto-version preference", () => {
        createView();
        updateSettings({ autoVersionOnRevisionCreate: true });
        createComment({ view, targetText: "hello", comment: "Keep this" });
        expect(
            createRevision({
                view,
                targetText: "hello",
                versions: [{ label: "Shorter", text: "hi" }],
                threadMessage: "Try this",
                author: "Reader",
                aiProvenance,
            }),
        ).toBe(true);
        const [revision] = Object.values(view.state.field(annotationField));
        if (!isAnnotationOfType(revision, "revision")) throw new Error("Expected revision");
        expect(revision.activeVersionId).toBe(revision.versions[0].id);
        expect(revision.versions[0]).toMatchObject({
            label: "Original",
            doc: "hello",
            annotationField: { 0: { thread: [{ message: "Keep this" }] } },
        });
        expect(revision.versions[1]).toMatchObject({ doc: "hi", provenance: "ai", aiProvenance });
        expect(revision).toMatchObject({
            aiProvenance,
            thread: [{ author: "Reader", message: "Try this" }],
        });
        expect(view.state.doc.toString()).toBe("hello world");
        expect(view.state.selection.main.to).toBe(5);
        expect(posthog.capture).not.toHaveBeenCalled();
        expect(undo(view)).toBe(true);
        expect(Object.values(view.state.field(annotationField))[0].thread[0].message).toBe(
            "Keep this",
        );
    });

    it("normalizes AI suggestion replacements and keeps an omitted thread empty", () => {
        createView();
        expect(
            createSuggestion({
                state: view.state,
                dispatch: (transaction) => view.dispatch(transaction),
                targetText: "world",
                replacements: ["earth", { text: "everyone", rationale: "inclusive" }],
                author: "Reader",
                aiProvenance,
            }),
        ).toBe(true);
        const [suggestion] = Object.values(view.state.field(annotationField));
        expect(suggestion).toMatchObject({
            replacements: [{ text: "earth" }, { text: "everyone", rationale: "inclusive" }],
            thread: [],
            author: "Reader",
            aiProvenance,
        });
        expect(suggestion.selection.main.from).toBe(6);
    });
});
