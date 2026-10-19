import { editorHistoryShortcuts } from "$lib/editor/historyShortcuts";
import { annotations } from "$lib/editor/plugins/annotations";
import Revision from "$lib/editor/plugins/annotations/Revision.svelte";
import { addAnnotation, annotationField } from "$lib/editor/plugins/annotations/annotationField";
import { createNewAnnotation, makeVersion } from "$lib/editor/plugins/annotations/models";
import { history, historyKeymap } from "@codemirror/commands";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("$lib/posthog", () => ({ default: { capture: vi.fn() } }));
let view: EditorView;
afterEach(() => {
    cleanup();
    view?.destroy();
    document.body.innerHTML = "";
});

it.each(["inactive", "active", "last", "whole revision"])(
    "undoes and redoes deletion: %s",
    async (which) => {
        const shell = document.createElement("div");
        shell.className = "editor-shell";
        document.body.appendChild(shell);
        view = new EditorView({
            parent: shell,
            state: EditorState.create({
                doc: "hello",
                extensions: [
                    annotations(),
                    editorHistoryShortcuts,
                    history(),
                    keymap.of(historyKeymap),
                ],
            }),
        });
        const versions = [makeVersion({ doc: "hello" }), makeVersion({ doc: "alternative" })];
        if (which === "last") versions.pop();
        const revision = {
            ...createNewAnnotation({}, EditorSelection.single(0, 5), "revision"),
            activeVersionId: versions[0].id,
            versions,
        };
        view.dispatch({
            effects: addAnnotation.of(revision),
            annotations: Transaction.addToHistory.of(false),
        });
        const rendered = render(Revision, {
            target: shell,
            props: {
                revision,
                isActive: false,
                view,
                nested: false,
                updateThread: vi.fn(),
            },
        });
        const button =
            which === "whole revision"
                ? rendered.getByRole("button", {
                      name: "Collapse revision and preserve nested annotations",
                  })
                : rendered.getByTitle(`Delete version ${which === "inactive" ? 2 : 1}`);
        button.focus();
        await fireEvent.click(button);
        const deleted = view.state.field(annotationField)[revision.id];
        expect(deleted).not.toEqual(revision);
        button.dispatchEvent(
            new KeyboardEvent("keydown", {
                key: "z",
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
        expect(view.state.field(annotationField)[revision.id]).toEqual(revision);
        button.dispatchEvent(
            new KeyboardEvent("keydown", {
                key: "y",
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
        expect(view.state.field(annotationField)[revision.id]).toEqual(deleted);
    },
);
