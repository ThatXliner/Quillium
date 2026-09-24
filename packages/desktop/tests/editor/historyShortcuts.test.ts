import { editorHistoryShortcuts } from "$lib/editor/historyShortcuts";
import { annotations } from "$lib/editor/plugins/annotations";
import {
    addAnnotation,
    annotationField,
    collapseRevision,
    createNewRevision,
    deleteRevisionVersion,
    removeAnnotation,
    setActiveRevisionVersion,
    updateRevisionVersionLabel,
    updateThread,
} from "$lib/editor/plugins/annotations/annotationField";
import { createNewAnnotation, makeVersion } from "$lib/editor/plugins/annotations/models";
import { history, redo, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, type Extension, Prec, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { afterEach, expect, it, vi } from "vitest";

let view: EditorView;
let shell: HTMLDivElement;
afterEach(() => {
    view?.destroy();
    document.body.innerHTML = "";
});

function setup(extra: Extension = []) {
    shell = document.createElement("div");
    shell.className = "editor-shell";
    document.body.appendChild(shell);
    view = new EditorView({
        parent: shell,
        state: EditorState.create({
            doc: "hello",
            extensions: [
                annotations(),
                history(),
                editorHistoryShortcuts,
                keymap.of(
                    ["Ctrl", "Meta"].flatMap((mod) => [
                        { key: `${mod}-z`, run: undo },
                        { key: `${mod}-Shift-z`, run: redo },
                        { key: `${mod}-y`, run: redo },
                    ]),
                ),
                extra,
            ],
        }),
    });
    const versions = [makeVersion({ doc: "hello" }), makeVersion({ doc: "other" })];
    const revision = {
        ...createNewAnnotation({}, EditorSelection.single(0, 5), "revision"),
        activeVersionId: versions[0].id,
        versions,
    };
    view.dispatch({
        effects: addAnnotation.of(revision),
        annotations: Transaction.addToHistory.of(false),
    });
    return revision;
}
function press(target: Element, options: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", {
        key: "z",
        metaKey: true,
        bubbles: true,
        cancelable: true,
        ...options,
    });
    target.dispatchEvent(event);
    return event;
}
function snapshot() {
    return { doc: view.state.doc.toString(), annotations: view.state.field(annotationField) };
}

it.each([
    "delete inactive",
    "delete active",
    "collapse",
    "create version",
    "switch",
    "rename",
    "thread",
    "remove comment",
])("undoes and redoes %s from a control", (action) => {
    const revision = setup();
    const comment = {
        ...createNewAnnotation(
            view.state.field(annotationField),
            EditorSelection.single(0, 5),
            "comment",
        ),
        status: "active" as const,
        thread: [{ message: "note", author: "Writer", time: 1 }],
    };
    view.dispatch({
        effects: addAnnotation.of(comment),
        annotations: Transaction.addToHistory.of(false),
    });
    const before = snapshot();
    switch (action) {
        case "delete inactive":
            view.dispatch(deleteRevisionVersion(view.state, revision.id, revision.versions[1].id));
            break;
        case "delete active":
            view.dispatch(deleteRevisionVersion(view.state, revision.id, revision.versions[0].id));
            break;
        case "collapse":
            view.dispatch(collapseRevision(view.state, revision.id));
            break;
        case "create version":
            view.dispatch(createNewRevision(view.state, revision.id));
            break;
        case "switch":
            view.dispatch(
                setActiveRevisionVersion(view.state, revision.id, revision.versions[1].id),
            );
            break;
        case "rename":
            view.dispatch(
                updateRevisionVersionLabel(
                    view.state,
                    revision.id,
                    revision.versions[0].id,
                    "Named",
                ),
            );
            break;
        case "thread":
            view.dispatch({
                effects: updateThread.of({ annotationId: comment.id, newThread: [] }),
            });
            break;
        case "remove comment":
            view.dispatch({ effects: removeAnnotation.of(comment) });
            break;
    }
    const after = snapshot();
    expect(after).not.toEqual(before);
    const button = document.createElement("button");
    shell.appendChild(button);
    button.focus();
    expect(press(button).defaultPrevented).toBe(true);
    expect(snapshot()).toEqual(before);
    expect(press(button, { shiftKey: true }).defaultPrevented).toBe(true);
    expect(snapshot()).toEqual(after);
});

it.each(["body", "dialog", "editor"])("routes one undo and redo from %s", (where) => {
    setup();
    view.dispatch({ changes: { from: 5, insert: "!" } });
    view.dispatch({
        changes: { from: 6, insert: "?" },
        annotations: Transaction.userEvent.of("input"),
    });
    let target: Element = document.body;
    if (where === "dialog") {
        const dialog = document.createElement("dialog");
        dialog.setAttribute("data-editor-history", "");
        target = document.createElement("button");
        dialog.appendChild(target);
        document.body.appendChild(dialog);
    } else if (where === "editor") target = view.contentDOM;
    press(target, { metaKey: false, ctrlKey: true });
    expect(view.state.doc.toString()).toBe("hello!");
    press(target, { key: "y", metaKey: false, ctrlKey: true });
    expect(view.state.doc.toString()).toBe("hello!?");
});

it.each([
    "input",
    "textarea",
    "select",
    "contenteditable",
    "unrelated dialog",
    "outside",
    "readonly",
    "handled",
    "alt",
    "composing",
])("leaves %s alone", (kind) => {
    setup(kind === "readonly" ? EditorState.readOnly.of(true) : []);
    view.dispatch({ changes: { from: 5, insert: "!" } });
    const target = document.createElement(
        ["input", "textarea", "select"].includes(kind) ? kind : "button",
    );
    shell.appendChild(target);
    if (kind === "contenteditable") target.setAttribute("contenteditable", "true");
    if (kind === "outside") document.body.appendChild(target);
    if (kind === "unrelated dialog") {
        const dialog = document.createElement("dialog");
        shell.appendChild(dialog);
        dialog.appendChild(target);
    }
    if (kind === "handled") target.addEventListener("keydown", (e) => e.preventDefault());
    press(target, { altKey: kind === "alt", isComposing: kind === "composing" });
    expect(view.state.doc.toString()).toBe("hello!");
});

it("uses the installed higher-priority history handler", () => {
    const collabUndo = vi.fn(() => true);
    setup(Prec.highest(keymap.of([{ key: "Meta-z", run: collabUndo }])));
    view.dispatch({ changes: { from: 5, insert: "!" } });
    press(document.body);
    expect(collabUndo).toHaveBeenCalledOnce();
    expect(view.state.doc.toString()).toBe("hello!");
});

it("removes the window listener when destroyed", () => {
    const handler = vi.fn(() => true);
    setup(Prec.highest(keymap.of([{ key: "Meta-z", run: handler }])));
    view.destroy();
    press(document.body);
    expect(handler).not.toHaveBeenCalled();
});
