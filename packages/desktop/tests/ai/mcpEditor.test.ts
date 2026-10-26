import {
    activateEditorialView,
    editorialTargetBookmarkField,
    registerNestedEditorialView,
    unregisterEditorialView,
} from "$lib/ai/editorialTarget";
import { resolveMcpBranch } from "$lib/ai/mcpBranch";
import { createMcpEditorSession } from "$lib/ai/mcpEditor";
import { createRevision } from "$lib/editor/plugins/annotations";
import {
    annotationField,
    invertedAnnotationFieldEffects,
} from "$lib/editor/plugins/annotations/annotationField";
import { isAnnotationOfType } from "$lib/editor/plugins/annotations/models";
import { history, redo, undo } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
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

function explicitContext(
    session: ReturnType<typeof createMcpEditorSession>,
    revisionPath: Array<{ revisionId: number; versionId: string }> = [],
) {
    return session.handle("get_editor_context", {
        target: {
            documentId: "doc",
            tabId: "tab",
            draftId: "draft",
            revisionPath,
        },
    });
}
function revision(view: EditorView, id = 0) {
    const annotation = view.state.field(annotationField)[id];
    if (!isAnnotationOfType(annotation, "revision")) throw new Error("Expected a revision");
    return annotation;
}
it("inserts verbatim human dictation in one version, returns identities and replays a receipt", () => {
    const { view, session } = setup(editor("Before. After."));
    const raw = " Um, I was really very excited to start. ";
    const action = {
        contextId: explicitContext(session).contextId,
        requestId: "dictation-1",
        action: "insert_dictation",
        position: 7,
        text: raw,
        label: "Dictation",
        threadMessage: "Raw wording",
    };
    const response = session.handle("apply_editorial_action", action);
    expect(response).toMatchObject({
        ok: true,
        created: [{ annotationId: 0, versions: [{ text: raw }] }],
    });
    expect(view.state.doc.toString()).toBe(`Before.${raw} After.`);
    expect(revision(view).versions).toHaveLength(1);
    expect(revision(view).versions[0]).toMatchObject({ doc: raw, provenance: "human" });
    expect(session.handle("apply_editorial_action", action)).toMatchObject({
        ok: true,
        replayed: true,
    });
    expect(
        session.handle("apply_editorial_action", { ...action, text: "Changed" }).error,
    ).toBeTruthy();
    expect(
        session.handle("apply_editorial_action", {
            ...action,
            contextId: explicitContext(session).contextId,
        }),
    ).toMatchObject({ previousResult: response });
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("Before. After.");
    expect(Object.values(view.state.field(annotationField))).toHaveLength(0);
    expect(redo(view)).toBe(true);
    expect(revision(view).versions[0].doc).toBe(raw);
});
it("wraps existing dictation and adds a version without activating it", () => {
    const { session, view } = setup(editor("I was really very excited. Then I waited."));
    expect(
        session.handle("apply_editorial_action", {
            contextId: explicitContext(session).contextId,
            requestId: "wrap-1",
            action: "wrap_dictation",
            targetText: view.state.doc.toString(),
            label: "Dictation",
            threadMessage: "Your words",
        }).ok,
    ).toBe(true);
    const original = revision(view).activeVersionId;
    const before = view.state.toJSON({ annotationField });
    expect(
        session.handle("apply_editorial_action", {
            contextId: explicitContext(session).contextId,
            requestId: "extend-1",
            action: "add_version",
            revisionId: 0,
            label: "Alternative",
            text: "I was excited.",
            threadMessage: "A shorter alternative",
        }).ok,
    ).toBe(true);
    expect(revision(view).activeVersionId).toBe(original);
    expect(revision(view).versions).toHaveLength(2);
    expect(revision(view).versions[1]).toMatchObject({
        provenance: "ai",
        aiProvenance: { requestId: "extend-1" },
    });
    expect(undo(view)).toBe(true);
    expect(view.state.toJSON({ annotationField })).toEqual(before);
    expect(redo(view)).toBe(true);
    expect(revision(view).versions).toHaveLength(2);
});
it("addresses inactive nested versions with scoped IDs, persisted readback and parent undo", () => {
    const { session, view } = setup(editor("Unchanged opening."));
    session.handle("apply_editorial_action", {
        contextId: explicitContext(session).contextId,
        requestId: "wrap-outer",
        action: "wrap_dictation",
        targetText: "Unchanged opening.",
        label: "Original",
        threadMessage: "Original",
    });
    session.handle("apply_editorial_action", {
        contextId: explicitContext(session).contextId,
        requestId: "extend-outer",
        action: "add_version",
        revisionId: 0,
        label: "Dictation",
        text: "I was really very excited. Then I waited.",
        threadMessage: "Alternative",
    });
    const original = revision(view).activeVersionId;
    const path = [{ revisionId: 0, versionId: revision(view).versions[1].id }];
    const before = view.state.toJSON({ annotationField });
    const result = session.handle("apply_editorial_action", {
        contextId: explicitContext(session, path).contextId,
        requestId: "nested-1",
        action: "revision",
        targetText: "really very ",
        versions: [{ label: "Cut", text: "" }],
        threadMessage: "Remove emphasis",
    });
    expect(result).toMatchObject({ ok: true, created: [{ annotationId: 0 }] });
    expect(view.state.doc.toString()).toBe("Unchanged opening.");
    expect(revision(view).activeVersionId).toBe(original);
    const nested = explicitContext(session, path);
    expect(nested).toMatchObject({
        text: "I was really very excited. Then I waited.",
        annotations: {
            0: { versions: [{ doc: "really very " }, { doc: "" }] },
        },
    });
    const saved = view.state.toJSON({ annotationField });
    expect(undo(view)).toBe(true);
    expect(view.state.toJSON({ annotationField })).toEqual(before);
    expect(redo(view)).toBe(true);
    expect(view.state.toJSON({ annotationField })).toEqual(saved);
    const restored = EditorState.fromJSON(
        saved,
        { extensions: [annotationField] },
        { annotationField },
    );
    const reopened = new EditorView({ state: restored });
    views.push(reopened);
    const fresh = setup(reopened);
    expect(explicitContext(fresh.session, path)).toMatchObject({ annotations: nested.annotations });
    const deeper = [
        ...path,
        {
            revisionId: 0,
            versionId: revisionFromState(resolveMcpBranch(view.state, path)?.state ?? view.state)
                .versions[0].id,
        },
    ];
    expect(explicitContext(session, deeper).text).toBe("really very ");
});
function revisionFromState(state: EditorState) {
    const annotation = state.field(annotationField)[0];
    if (!isAnnotationOfType(annotation, "revision")) throw new Error("Expected nested revision");
    return annotation;
}
it("rejects explicit stale branches, invalid paths, wrong drafts and locked writes", () => {
    const { session, view } = setup();
    expect(
        session.handle("get_editor_context", {
            target: { documentId: "other", tabId: "tab", draftId: "draft", revisionPath: [] },
        }).error,
    ).toBeTruthy();
    expect(explicitContext(session, [{ revisionId: 999, versionId: "gone" }]).error).toBeTruthy();
    const contextId = explicitContext(session).contextId;
    view.dispatch({ changes: { from: 0, insert: "Changed. " } });
    expect(
        session.handle("apply_editorial_action", {
            contextId,
            requestId: "stale-insertion",
            action: "insert_dictation",
            position: 0,
            text: "Dictation",
            label: "Dictation",
            threadMessage: "Raw",
        }).error,
    ).toBeTruthy();
    const locked = setup(editor("Locked", true));
    expect(
        locked.session.handle("apply_editorial_action", {
            contextId: explicitContext(locked.session).contextId,
            requestId: "locked-insertion",
            action: "insert_dictation",
            position: 0,
            text: "Dictation",
            label: "Dictation",
            threadMessage: "Raw",
        }).error,
    ).toBeTruthy();
});

it("explains blank Original at the low-level empty-range creation boundary", () => {
    const { view, session } = setup(editor("Existing text."));
    expect(
        createRevision({
            view,
            editorSelection: EditorSelection.single(0),
            versions: [{ label: "Inserted wording", text: "New prose." }],
            threadMessage: "Insert",
        }),
    ).toBe(true);
    expect(revision(view).versions[0].doc).toBe("");
    expect(revision(view).activeVersionId).toBe(revision(view).versions[0].id);
    expect(view.state.doc.toString()).toBe("Existing text.");
    expect(
        session.handle("apply_editorial_action", {
            contextId: explicitContext(session).contextId,
            action: "revision",
            targetText: "",
            versions: [{ label: "Alternative", text: "New prose." }],
            threadMessage: "Insert",
        }).error,
    ).toBeTruthy();
});

it("inserts dictation through an inactive AI version with mixed provenance and root undo", () => {
    const { session, view } = setup(editor("Original."));
    session.handle("apply_editorial_action", {
        contextId: explicitContext(session).contextId,
        requestId: "raw-outer",
        action: "wrap_dictation",
        targetText: "Original.",
        label: "Original",
        threadMessage: "Original",
    });
    session.handle("apply_editorial_action", {
        contextId: explicitContext(session).contextId,
        requestId: "ai-alternative",
        action: "add_version",
        revisionId: 0,
        label: "AI",
        text: "Alternative.",
        threadMessage: "Alternative",
    });
    const alternative = revision(view).versions[1];
    const path = [{ revisionId: 0, versionId: alternative.id }];
    const before = view.state.toJSON({ annotationField });
    expect(
        session.handle("apply_editorial_action", {
            contextId: explicitContext(session, path).contextId,
            requestId: "nested-raw",
            action: "insert_dictation",
            position: 12,
            text: " Raw dictation.",
            label: "Dictation",
            threadMessage: "Raw words",
        }).ok,
    ).toBe(true);
    expect(revision(view).versions[1]).toMatchObject({
        doc: "Alternative. Raw dictation.",
        provenance: "mixed",
    });
    expect(explicitContext(session, path)).toMatchObject({
        text: "Alternative. Raw dictation.",
        annotations: {
            0: { versions: [{ doc: " Raw dictation.", provenance: "human" }] },
        },
    });
    expect(view.state.doc.toString()).toBe("Original.");
    expect(undo(view)).toBe(true);
    expect(view.state.toJSON({ annotationField })).toEqual(before);
    expect(redo(view)).toBe(true);
    expect(revision(view).versions[1].provenance).toBe("mixed");
});

it("rejects wrapping a passage that only partly contains an existing comment", () => {
    const { session, view } = setup(editor("First passage. Second passage."));
    session.handle("apply_editorial_action", {
        contextId: explicitContext(session).contextId,
        action: "comment",
        targetText: "passage. Second",
        comment: "Spans both sentences",
    });
    const before = view.state.toJSON({ annotationField });
    expect(
        session.handle("apply_editorial_action", {
            contextId: explicitContext(session).contextId,
            requestId: "partial-wrap",
            action: "wrap_dictation",
            targetText: "First passage.",
            label: "Dictation",
            threadMessage: "Keep wording",
        }),
    ).toEqual({ ok: false, error: "annotation-conflict" });
    expect(view.state.toJSON({ annotationField })).toEqual(before);
});
