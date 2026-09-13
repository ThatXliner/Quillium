import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { cleanup, render } from "@testing-library/svelte";
import { tick } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Annotations from "$lib/editor/plugins/annotations/Annotations.svelte";
import { annotationField } from "$lib/editor/plugins/annotations/annotationField";
import {
    type Annotation,
    type Annotations as AnnotationMap,
    makeVersion,
} from "$lib/editor/plugins/annotations/models";
import { type AppSettings, appSettings } from "$lib/settings.svelte";
import { annotations } from "$lib/stores";

vi.mock("$lib/posthog", () => ({ default: { capture: vi.fn() } }));

const views: EditorView[] = [];
const mutableAppSettings = appSettings as AppSettings;
let previousAiEnabled: boolean;

beforeEach(() => {
    previousAiEnabled = mutableAppSettings.aiEnabled;
    mutableAppSettings.aiEnabled = true;
});

afterEach(() => {
    cleanup();
    for (const view of views) view.destroy();
    views.length = 0;
    annotations.set(undefined);
    mutableAppSettings.aiEnabled = previousAiEnabled;
});

function createView(): EditorView {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({
        state: EditorState.create({
            doc: "A passage with an existing annotation.",
            extensions: [annotationField],
        }),
        parent: host,
    });
    views.push(view);
    return view;
}

function comment(id: number): Annotation<"comment"> {
    return {
        _type: "comment",
        id,
        selection: EditorSelection.single(2, 9),
        thread: [{ message: "Existing note", author: "Writer", time: 1 }],
        status: "active",
    };
}

function revision(id: number): Annotation<"revision"> {
    const version = makeVersion({ doc: "passage", label: "Original" });
    return {
        _type: "revision",
        id,
        selection: EditorSelection.single(2, 9),
        thread: [{ message: "AI revision", author: "AI", time: 2 }],
        status: "active",
        activeVersionId: version.id,
        versions: [version],
    };
}

describe("floating annotation rendering", () => {
    it("keeps a mounted card bound to its annotation while AI replaces the map", async () => {
        const view = createView();
        const initial: AnnotationMap = { 0: comment(0) };
        const replacement: AnnotationMap = { 1: revision(1) };
        annotations.set(initial);
        const ui = render(Annotations, {
            props: {
                view,
                activeAnnotationData: null,
                layout: "floating",
            },
        });
        const mountedCard = ui.container.querySelector<HTMLElement>("[data-annotation-id='0']");
        expect(mountedCard).not.toBeNull();
        const errors: unknown[] = [];
        const captureError = (event: ErrorEvent) => {
            errors.push(event.error);
            event.preventDefault();
        };
        window.addEventListener("error", captureError);

        try {
            annotations.set(replacement);
            mountedCard?.click();
            await tick();

            expect(errors).toEqual([]);
            expect(ui.container.querySelector("[data-annotation-id='0']")).toBeNull();
            expect(ui.container.querySelector("[data-annotation-id='1']")).not.toBeNull();
        } finally {
            window.removeEventListener("error", captureError);
        }
    });
});
