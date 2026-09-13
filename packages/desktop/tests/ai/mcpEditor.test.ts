import {
    activateEditorialView,
    editorialTargetBookmarkField,
    registerNestedEditorialView,
    unregisterEditorialView,
} from "$lib/ai/editorialTarget";
import { createMcpEditorSession } from "$lib/ai/mcpEditor";
import {
    annotationField,
    invertedAnnotationFieldEffects,
} from "$lib/editor/plugins/annotations/annotationField";
import { history, redo, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, expect, it } from "vitest";

const views: EditorView[] = [];
const sessions: ReturnType<typeof createMcpEditorSession>[] = [];
afterEach(() => {
    for (const session of sessions) session.dispose();
    for (const view of views) {
        unregisterEditorialView(view);
        view.destroy();
    }
    sessions.length = views.length = 0;
});
function editor(text = "First passage. Second passage.", readOnly = false) {
    const view = new EditorView({
        state: EditorState.create({
            doc: text,
            extensions: [
                annotationField,
                editorialTargetBookmarkField,
                invertedAnnotationFieldEffects,
                history(),
                EditorState.readOnly.of(readOnly),
            ],
        }),
    });
    views.push(view);
    return view;
}
function setup(view = editor()) {
    const identity = { documentId: "doc", tabId: "tab", draftId: "draft" };
    const session = createMcpEditorSession(() => ({
        rootView: view,
        identity,
        metadata: { tabLabel: "Leadership", brief: "Keep my voice" },
    }));
    sessions.push(session);
    return { view, identity, session, read: () => session.handle("get_editor_context", {}) };
}
it("reads live unsaved edits and selection rather than the document index", () => {
    const { view, read } = setup();
    expect(read().text).toBe("First passage. Second passage.");
    view.dispatch({
        changes: { from: 0, to: 5, insert: "Fresh" },
        selection: { anchor: 0, head: 13 },
    });
    expect(read()).toMatchObject({
        text: "Fresh passage. Second passage.",
        selection: { text: "Fresh passage", from: 0, to: 13 },
        tabLabel: "Leadership",
        source: "live-editor",
    });
});
it.each(["comment", "suggestion", "revision"])(
    "creates an undoable %s without replacing prose",
    (action) => {
        const { view, session, read } = setup();
        const contextId = read().contextId;
        const payload =
            action === "comment"
                ? { comment: "Explain this claim." }
                : action === "suggestion"
                  ? { replacements: [{ text: "Opening passage." }] }
                  : {
                        versions: [{ label: "Alternative", text: "Opening passage." }],
                        threadMessage: "A different opening.",
                    };
        expect(
            session.handle("apply_editorial_action", {
                contextId,
                action,
                targetText: "First passage.",
                ...payload,
            }).ok,
        ).toBe(true);
        expect(view.state.doc.toString()).toBe("First passage. Second passage.");
        expect(Object.values(view.state.field(annotationField))).toHaveLength(1);
        expect(undo(view)).toBe(true);
        expect(Object.values(view.state.field(annotationField))).toHaveLength(0);
        expect(redo(view)).toBe(true);
        expect(Object.values(view.state.field(annotationField))).toHaveLength(1);
    },
);
it("rejects stale prose, wrong drafts and repeated requests", () => {
    const { view, session, read, identity } = setup();
    const action = { action: "comment", targetText: "First passage.", comment: "Explain this." };
    const stale = read().contextId;
    view.dispatch({ changes: { from: view.state.doc.length, insert: " Edit" } });
    expect(
        session.handle("apply_editorial_action", { contextId: stale, ...action }).error,
    ).toBeTruthy();
    const wrongDraft = read().contextId;
    identity.draftId = "other";
    expect(
        session.handle("apply_editorial_action", { contextId: wrongDraft, ...action }).error,
    ).toBe("draft-changed");
    const current = read().contextId;
    expect(session.handle("apply_editorial_action", { contextId: current, ...action }).ok).toBe(
        true,
    );
    expect(
        session.handle("apply_editorial_action", { contextId: current, ...action }).error,
    ).toBeTruthy();
});
it("rejects actions outside the captured selection and locked drafts", () => {
    const { view, session, read } = setup();
    view.dispatch({ selection: { anchor: 0, head: 14 } });
    expect(
        session.handle("apply_editorial_action", {
            contextId: read().contextId,
            action: "comment",
            targetText: "Second passage.",
            comment: "No",
        }).error,
    ).toBeTruthy();
    const locked = setup(editor("Locked", true));
    expect(
        locked.session.handle("apply_editorial_action", {
            contextId: locked.read().contextId,
            action: "comment",
            targetText: "Locked",
            comment: "No",
        }).error,
    ).toBeTruthy();
});
it("rejects a missing revision branch and falls back after that view becomes inactive", () => {
    const { view: root, read } = setup();
    const nested = editor("First passage.");
    let current = true;
    registerNestedEditorialView({
        view: nested,
        parentView: root,
        revisionId: 1,
        versionId: "version-a",
        isCurrent: () => current,
    });
    activateEditorialView(nested);
    expect(() => read()).toThrow("Revision context changed");
    current = false;
    expect(read().text).toBe(root.state.doc.toString());
});
it("rejects malformed actions", () => {
    const { session, read } = setup();
    expect(
        session.handle("apply_editorial_action", {
            contextId: read().contextId,
            action: "revision",
            targetText: "First",
            versions: [],
        }).error,
    ).toBeTruthy();
});

it("does not execute an action delivered after the native request timed out", () => {
    const { session, read, view } = setup();
    expect(
        session.handle(
            "apply_editorial_action",
            {
                contextId: read().contextId,
                action: "comment",
                targetText: "First passage.",
                comment: "Late feedback",
            },
            Date.now() - 1,
        ).error,
    ).toBeTruthy();
    expect(Object.values(view.state.field(annotationField))).toHaveLength(0);
});
