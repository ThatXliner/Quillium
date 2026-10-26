import { activateEditorialView, unregisterEditorialView } from "$lib/ai/editorialTarget";
import { registerMcpModalView } from "$lib/ai/mcpContext";
import { createMcpEditorSession } from "$lib/ai/mcpEditor";
import { annotationField, annotations, createRevision } from "$lib/editor/plugins/annotations";
import { NestedEditorController } from "$lib/editor/plugins/annotations/NestedEditorController";
import {
    activeVersion,
    activeVersionIndex,
    isAnnotationOfType,
} from "$lib/editor/plugins/annotations/models";
import type { ModalEntry } from "$lib/stores";
import { history, redo, undo } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { expect, it } from "vitest";

it("targets the open two-level modal despite root focus, persists nested feedback, and preserves root undo", () => {
    const root = new EditorView({
        state: EditorState.create({
            doc: "Before. A nested passage. After.",
            extensions: [history({ newGroupDelay: 0 }), annotations()],
        }),
    });
    const cleanups: Array<() => void> = [];
    const modals: ModalEntry[] = [];
    const session = createMcpEditorSession(() => ({
        rootView: root,
        identity: { documentId: "doc", tabId: "tab", draftId: "draft" },
        metadata: {},
        modals,
    }));
    function open(parent: EditorView, from: number, to: number) {
        expect(
            createRevision({
                view: parent,
                editorSelection: EditorSelection.single(from, to),
                versions: [{ label: "Alternative", text: "Alternative wording" }],
                threadMessage: "Explore this passage",
            }),
        ).toBe(true);
        const revision = Object.values(parent.state.field(annotationField)).find((value) =>
            isAnnotationOfType(value, "revision"),
        );
        if (!revision || !isAnnotationOfType(revision, "revision"))
            throw new Error("Missing revision");
        const controller = new NestedEditorController(parent, revision.id, {}, "flush", root);
        controller.create(
            document.createElement("div"),
            activeVersion(revision),
            activeVersionIndex(revision),
        );
        const view = controller.editor;
        if (!view) throw new Error("Missing nested editor");
        const unregister = registerMcpModalView(parent, revision.id, view);
        cleanups.push(() => {
            unregister();
            controller.destroy();
        });
        modals.push({
            type: "revision",
            parentView: parent,
            revisionId: revision.id,
            label: "Passage",
        });
        return { view, revision };
    }
    try {
        const first = open(root, 8, 25);
        const second = open(first.view, 2, 8);
        activateEditorialView(root);
        const context = session.handle("get_editor_context", {});
        expect(context.text).toBe(second.view.state.doc.toString());
        expect(context.surface).toMatchObject({ kind: "revision-modal", activeModalDepth: 1 });
        expect(context.revisionPath).toHaveLength(2);
        expect(context.revisionPath).toMatchObject([
            {
                versions: expect.arrayContaining([
                    {
                        id: expect.any(String),
                        label: "Alternative",
                        active: false,
                        text: "Alternative wording",
                    },
                ]),
            },
            {},
        ]);
        const original = root.state.doc.toString();
        const outcome = session.handle("apply_editorial_action", {
            contextId: context.contextId,
            action: "comment",
            targetText: second.view.state.doc.toString(),
            comment: "Clarify the nested claim.",
        });
        expect(outcome.ok).toBe(true);
        expect(root.state.doc.toString()).toBe(original);
        expect(JSON.stringify(root.state.toJSON({ annotationField }))).toContain(
            "Clarify the nested claim.",
        );
        expect(undo(root)).toBe(true);
        expect(JSON.stringify(root.state.toJSON({ annotationField }))).not.toContain(
            "Clarify the nested claim.",
        );
        expect(redo(root)).toBe(true);
        expect(JSON.stringify(root.state.toJSON({ annotationField }))).toContain(
            "Clarify the nested claim.",
        );
        const captured = session.handle("get_editor_context", {});
        modals.pop();
        expect(
            session.handle("apply_editorial_action", {
                contextId: captured.contextId,
                action: "comment",
                targetText: "nested",
                comment: "Late",
            }).error,
        ).toBeTruthy();
    } finally {
        session.dispose();
        for (const cleanup of cleanups.reverse()) cleanup();
        unregisterEditorialView(root);
        root.destroy();
    }
});
