import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import { mount, unmount } from "svelte";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history } from "@codemirror/commands";

import { annotationField, addAnnotation } from "$lib/editor/plugins/annotations/annotationField";
import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import {
    createNewAnnotation,
    isAnnotationOfType,
    makeVersion,
} from "$lib/editor/plugins/annotations/models";
import Revision from "$lib/editor/plugins/annotations/Revision.svelte";
import RevisionModal from "$lib/editor/plugins/annotations/RevisionModal.svelte";
import { modalStack, type NestedEditorCommand } from "$lib/stores";
import { annotationEventBus } from "$lib/events/annotationEventBus";
import { appSettings } from "$lib/settings.svelte";

function createView(doc: string) {
    const state = EditorState.create({
        doc,
        extensions: [history({ newGroupDelay: 0 }), annotationExtensions()],
    });
    const el = document.createElement("div");
    document.body.appendChild(el);
    return new EditorView({ state, parent: el });
}

function addRevision(view: EditorView, from: number, to: number, doc: string) {
    const v0 = makeVersion({ doc });
    const annotation = {
        ...createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(from, to),
            "revision",
        ),
        activeVersionId: v0.id,
        versions: [v0],
    };
    view.dispatch(view.state.update({ effects: [addAnnotation.of(annotation)] }));
    return annotation.id;
}

function publishNestedCommand(command: NestedEditorCommand, sourceView: EditorView) {
    annotationEventBus.emit({
        type: "nested-annotation-create",
        command,
        sourceView,
    });
}

let views: EditorView[] = [];
let components: { destroy: () => void }[] = [];

beforeEach(() => {
    modalStack.clear();
});

afterEach(() => {
    appSettings.showNestedEditor = true;
    for (const c of components) c.destroy();
    components = [];
    for (const v of views) v.destroy();
    views = [];
    modalStack.clear();
});

// TODO: enable client-side component mounting in Vitest (Svelte 5).
// These tests encode the expected modal-stack behavior and should be
// un-skipped once the runner is wired to use the client renderer.
describe.skip("nested annotation creation routing", () => {
    it("Revision.svelte pushes a modal with pending command when no modal is open", async () => {
        const view = createView("hello world");
        views.push(view);
        const revisionId = addRevision(view, 0, 5, "hello");
        const revision = view.state.field(annotationField)[revisionId];
        expect(isAnnotationOfType(revision, "revision")).toBe(true);
        if (!isAnnotationOfType(revision, "revision")) return;

        const target = document.createElement("div");
        document.body.appendChild(target);
        const comp = mount(Revision, {
            target,
            props: {
                revision,
                isActive: true,
                view,
                remove: () => {},
                updateThread: () => {},
            },
        });
        components.push({ destroy: () => void unmount(comp) });

        publishNestedCommand(
            {
                revisionId,
                type: "revision",
                selectionFrom: 1,
                selectionTo: 3,
            },
            view,
        );

        await Promise.resolve();

        const stack = get(modalStack);
        expect(stack).toHaveLength(1);
        const entry = stack[0];
        expect(entry.type).toBe("revision");
        if (entry.type === "revision") {
            expect(entry.revisionId).toBe(revisionId);
            expect(entry.pendingNestedCommand).toEqual({
                type: "revision",
                selectionFrom: 1,
                selectionTo: 3,
            });
        }
    });

    it("RevisionModal respects showNestedEditor=true and does not push a child modal", async () => {
        appSettings.showNestedEditor = true;
        const view = createView("hello world");
        views.push(view);
        const revisionId = addRevision(view, 0, 5, "hello");

        modalStack.push({
            type: "revision",
            revisionId,
            parentView: view,
            label: "Revision",
        });

        const target = document.createElement("div");
        document.body.appendChild(target);
        const modal = mount(RevisionModal, {
            target,
            props: { revisionId, view, stackIndex: 0 },
        });
        components.push({ destroy: () => void unmount(modal) });

        publishNestedCommand(
            {
                revisionId,
                type: "revision",
                selectionFrom: 0,
                selectionTo: 2,
            },
            view,
        );

        await Promise.resolve();

        const stack = get(modalStack);
        // Still only the parent modal
        expect(stack).toHaveLength(1);
    });

    it("RevisionModal pushes a child modal when showNestedEditor=false", async () => {
        appSettings.showNestedEditor = false;
        const view = createView("hello world");
        views.push(view);
        const revisionId = addRevision(view, 0, 5, "hello");

        modalStack.push({
            type: "revision",
            revisionId,
            parentView: view,
            label: "Revision",
        });

        const target = document.createElement("div");
        document.body.appendChild(target);
        const modal = mount(RevisionModal, {
            target,
            props: { revisionId, view, stackIndex: 0 },
        });
        components.push({ destroy: () => void unmount(modal) });

        publishNestedCommand(
            {
                revisionId,
                type: "revision",
                selectionFrom: 0,
                selectionTo: 2,
            },
            view,
        );

        await Promise.resolve();

        const stack = get(modalStack);
        expect(stack).toHaveLength(2);
        const top = stack[1];
        expect(top.type).toBe("revision");
        if (top.type === "revision") {
            expect(top.parentView).toBeTruthy();
        }
    });
});
