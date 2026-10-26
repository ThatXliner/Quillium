import { AnnotationIdMap } from "$lib/collab/annotationSchema";
import { roleContext } from "$lib/collab/roleContext";
import Thread from "$lib/editor/plugins/annotations/Thread.svelte";
import { annotationField } from "$lib/editor/plugins/annotations/annotationField";
import {
    commentDraftScope,
    commentDraftScopeBridge,
    getDraft,
    getNestedCommentDraftScope,
    setDraft,
} from "$lib/editor/plugins/annotations/drafts.svelte";
import { makeVersion } from "$lib/editor/plugins/annotations/models";
import { createNestedEditorState } from "$lib/editor/plugins/annotations/nestedEditor";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

const views: EditorView[] = [];
const documents: Y.Doc[] = [];
afterEach(() => {
    cleanup();
    for (const view of views.splice(0)) view.destroy();
    for (const doc of documents.splice(0)) doc.destroy();
});

function editor(scope: object = {}, extra: Extension = []): EditorView {
    const view = new EditorView({
        parent: document.body,
        state: EditorState.create({
            doc: "Writing",
            extensions: [
                annotationField,
                commentDraftScope.of(scope),
                commentDraftScopeBridge,
                extra,
            ],
        }),
    });
    views.push(view);
    return view;
}

function roomContext(doc = new Y.Doc(), mapName = "annotations") {
    if (!documents.includes(doc)) documents.push(doc);
    return roleContext.of({
        role: "commenter",
        text: doc.getText("document"),
        annotations: doc.getMap<Y.Map<unknown>>(mapName),
        ids: new AnnotationIdMap(),
        scope: [],
        prepareComment: () => async () => {},
    });
}

describe("composer draft ownership", () => {
    it("uses each Live Room annotation map as its own scope", () => {
        const doc = new Y.Doc();
        const root = editor({}, roomContext(doc));
        const nested = editor({}, roomContext(doc, "nested"));
        const sameNestedModal = editor({}, roomContext(doc, "nested"));
        setDraft(root, 0, "Root room reply");
        setDraft(nested, 0, "Nested room reply");
        expect(getDraft(root, 0)).toBe("Root room reply");
        expect(getDraft(sameNestedModal, 0)).toBe("Nested room reply");
    });
    it("isolates equal annotation IDs in unrelated editor scopes", () => {
        const root = editor();
        const nested = editor(getNestedCommentDraftScope(root, 10, "version-a"));
        setDraft(root, 0, "Root private reply");
        setDraft(nested, 0, "Nested private reply");
        expect(getDraft(root, 0)).toBe("Root private reply");
        expect(getDraft(nested, 0)).toBe("Nested private reply");
    });

    it("shares inline and modal drafts only for the same parent revision version", () => {
        const parent = editor();
        const version = makeVersion({ doc: "Writing" });
        function nested(versionState = version): EditorView {
            const view = new EditorView({
                parent: document.body,
                state: createNestedEditorState(versionState, () => {}, parent, 10),
            });
            views.push(view);
            return view;
        }
        const inline = nested();
        const modal = nested();
        const otherVersion = nested(makeVersion({ doc: "Writing" }));
        setDraft(inline, 0, "Resize-safe reply");
        expect(getDraft(modal, 0)).toBe("Resize-safe reply");
        expect(getDraft(otherVersion, 0)).toBe("");
    });

    it("updates a mounted composer across same-view join, leave and a different room", async () => {
        const session = new Compartment();
        const view = editor({}, session.of([]));
        const component = render(Thread, {
            props: {
                thread: [],
                updateThread: vi.fn(),
                annotationId: 0,
                view,
                commentThread: true,
            },
        });
        const input = component.getByPlaceholderText("Reply…") as HTMLTextAreaElement;
        await fireEvent.input(input, { target: { value: "Private local reply" } });
        const firstRoom = roomContext();
        view.dispatch({ effects: session.reconfigure(firstRoom) });
        await vi.waitFor(() => expect(input.value).toBe(""));
        await fireEvent.input(input, { target: { value: "Private room reply" } });
        view.dispatch({ effects: session.reconfigure([]) });
        await vi.waitFor(() => expect(input.value).toBe("Private local reply"));
        view.dispatch({ effects: session.reconfigure(firstRoom) });
        await vi.waitFor(() => expect(input.value).toBe("Private room reply"));
        view.dispatch({ effects: session.reconfigure(roomContext()) });
        await vi.waitFor(() => expect(input.value).toBe(""));
    });

    it("changes local draft scope when the same editor loads a new state", () => {
        const view = editor();
        setDraft(view, 0, "Previous draft reply");
        view.setState(
            EditorState.create({
                doc: "Other draft",
                extensions: [commentDraftScope.of({}), commentDraftScopeBridge],
            }),
        );
        expect(getDraft(view, 0)).toBe("");
    });
});
