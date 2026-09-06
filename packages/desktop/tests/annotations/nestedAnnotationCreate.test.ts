import { history } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { mount, tick, unmount } from "svelte";
import { get } from "svelte/store";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { annotations as annotationExtensions } from "$lib/editor/plugins/annotations";
import Revision from "$lib/editor/plugins/annotations/Revision.svelte";
import RevisionModal from "$lib/editor/plugins/annotations/RevisionModal.svelte";
import { addAnnotation, annotationField } from "$lib/editor/plugins/annotations/annotationField";
import {
    activeVersion,
    createNewAnnotation,
    isAnnotationOfType,
    makeVersion,
} from "$lib/editor/plugins/annotations/models";
import { annotationEventBus } from "$lib/events/annotationEventBus";
import { appSettings, updateSettings } from "$lib/settings.svelte";
import { type NestedEditorCommand, modalAnnotationStores, modalStack } from "$lib/stores";

const browserApiRestorers: (() => void)[] = [];

function installMissingMethod(target: object, name: string, implementation: unknown): void {
    if (typeof (target as Record<string, unknown>)[name] === "function") return;
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    Object.defineProperty(target, name, { configurable: true, value: implementation });
    browserApiRestorers.push(() => {
        if (descriptor) Object.defineProperty(target, name, descriptor);
        else Reflect.deleteProperty(target, name);
    });
}

beforeAll(() => {
    installMissingMethod(
        HTMLDialogElement.prototype,
        "showModal",
        function (this: HTMLDialogElement) {
            this.open = true;
        },
    );
    installMissingMethod(HTMLDialogElement.prototype, "close", function (this: HTMLDialogElement) {
        this.open = false;
    });
    installMissingMethod(Element.prototype, "animate", () => {
        const animation = {
            cancel: vi.fn(),
            currentTime: 0,
            effect: null,
            onfinish: null,
            playState: "finished",
        } as unknown as Animation;
        queueMicrotask(() => animation.onfinish?.call(animation, {} as AnimationPlaybackEvent));
        return animation;
    });
});

afterAll(() => {
    for (const restore of browserApiRestorers.reverse()) restore();
});

function createView(doc: string) {
    const state = EditorState.create({
        doc,
        extensions: [history({ newGroupDelay: 0 }), annotationExtensions()],
    });
    const el = document.createElement("div");
    document.body.appendChild(el);
    containers.push(el);
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
let components: { destroy: () => Promise<void> }[] = [];
let containers: HTMLElement[] = [];
let initialShowNestedEditor = appSettings.showNestedEditor;

beforeEach(() => {
    initialShowNestedEditor = appSettings.showNestedEditor;
    modalStack.clear();
    annotationEventBus.clearPendingSelections();
});

afterEach(async () => {
    for (const component of [...components].reverse()) await component.destroy();
    await tick();
    for (const v of views) v.destroy();
    modalStack.clear();
    annotationEventBus.clearPendingSelections();
    for (const container of containers) container.remove();
    Reflect.deleteProperty(window, "__modalEditors__");
    updateSettings({ showNestedEditor: initialShowNestedEditor });
    components = [];
    views = [];
    containers = [];
});

describe("nested annotation creation routing", () => {
    it("Revision.svelte pushes a modal with pending command when no modal is open", async () => {
        const view = createView("hello world");
        views.push(view);
        const revisionId = addRevision(view, 0, 5, "hello");
        const revision = view.state.field(annotationField)[revisionId];
        expect(isAnnotationOfType(revision, "revision")).toBe(true);
        if (!isAnnotationOfType(revision, "revision")) return;

        const target = document.createElement("div");
        document.body.appendChild(target);
        containers.push(target);
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
        components.push({ destroy: () => unmount(comp) });

        // Effects register event listeners asynchronously.
        await tick();

        publishNestedCommand(
            {
                revisionId,
                type: "revision",
                selectionFrom: 1,
                selectionTo: 3,
            },
            view,
        );

        await tick();

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
        updateSettings({ showNestedEditor: true });
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
        containers.push(target);
        const modal = mount(RevisionModal, {
            target,
            props: { revisionId, view, stackIndex: 0 },
        });
        components.push({ destroy: () => unmount(modal) });

        // Effects register event listeners and build the modal editor asynchronously.
        await tick();

        expect(Object.values(get(modalAnnotationStores)[0] ?? {})).toHaveLength(0);

        publishNestedCommand(
            {
                revisionId,
                type: "revision",
                selectionFrom: 0,
                selectionTo: 2,
            },
            view,
        );

        await tick();

        const stack = get(modalStack);
        // Still only the parent modal
        expect(stack).toHaveLength(1);
        const nestedAnnotations = Object.values(get(modalAnnotationStores)[0] ?? {});
        expect(nestedAnnotations).toHaveLength(1);
        const nestedAnnotation = nestedAnnotations[0];
        expect(nestedAnnotation).toBeDefined();
        if (!nestedAnnotation) return;
        expect(isAnnotationOfType(nestedAnnotation, "revision")).toBe(true);
        if (isAnnotationOfType(nestedAnnotation, "revision")) {
            expect(nestedAnnotation.selection.main.from).toBe(0);
            expect(nestedAnnotation.selection.main.to).toBe(0);
            expect(nestedAnnotation.versions).toHaveLength(2);
            expect(nestedAnnotation.versions[0].doc).toBe("he");
            expect(activeVersion(nestedAnnotation).doc).toBe("");
        }
    });

    it("RevisionModal pushes a child modal when showNestedEditor=false", async () => {
        updateSettings({ showNestedEditor: false });
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
        containers.push(target);
        const modal = mount(RevisionModal, {
            target,
            props: { revisionId, view, stackIndex: 0 },
        });
        components.push({ destroy: () => unmount(modal) });

        // Effects register event listeners and build the modal editor asynchronously.
        await tick();

        publishNestedCommand(
            {
                revisionId,
                type: "revision",
                selectionFrom: 0,
                selectionTo: 2,
            },
            view,
        );

        await tick();

        const stack = get(modalStack);
        expect(stack).toHaveLength(2);
        const top = stack[1];
        expect(top.type).toBe("revision");
        if (top.type === "revision") {
            expect(top.parentView).toBeTruthy();
            expect(top.parentView).not.toBe(view);
            const nestedRevision = top.parentView.state.field(annotationField)[top.revisionId];
            expect(isAnnotationOfType(nestedRevision, "revision")).toBe(true);
            if (isAnnotationOfType(nestedRevision, "revision")) {
                expect(nestedRevision.selection.main.from).toBe(0);
                expect(nestedRevision.selection.main.to).toBe(0);
                expect(nestedRevision.versions).toHaveLength(2);
                expect(nestedRevision.versions[0].doc).toBe("he");
                expect(activeVersion(nestedRevision).doc).toBe("");
            }
        }
    });
});
