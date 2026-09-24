import { StructureHistory } from "$lib/editor/structureHistory";
import { history, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { afterEach, expect, it, vi } from "vitest";

let view: EditorView;
let unlisten: (() => void) | undefined;
afterEach(() => {
    unlisten?.();
    view?.destroy();
    document.body.innerHTML = "";
});
function setup(readOnly = false) {
    let documentId = "doc";
    let draftId = "draft";
    const error = vi.fn();
    const structural = new StructureHistory(() => ({ documentId, draftId, view }), error);
    const shell = document.createElement("div");
    shell.className = "editor-shell";
    document.body.appendChild(shell);
    view = new EditorView({
        parent: shell,
        state: EditorState.create({
            doc: "hello",
            extensions: [
                history(),
                keymap.of(historyKeymap),
                EditorState.readOnly.of(readOnly),
                EditorView.updateListener.of((update) => structural.observe(update)),
            ],
        }),
    });
    structural.loaded();
    unlisten = structural.listen();
    const entry = {
        undo: vi.fn().mockResolvedValue(undefined),
        redo: vi.fn().mockResolvedValue(undefined),
    };
    structural.record("doc", entry);
    return {
        structural,
        entry,
        error,
        changeDraft: () => {
            draftId = "another";
            structural.loaded();
        },
        changeDocument: () => {
            documentId = "other";
            structural.loaded();
        },
    };
}
function key(target: EventTarget = view.contentDOM, redo = false) {
    const event = new KeyboardEvent("keydown", {
        key: redo ? "y" : "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
}

it("undoes newer typing, deletion, and older typing in order, then redoes them", async () => {
    const { structural, entry } = setup();
    // Replace the initial boundary with one between two adjacent typing events.
    await structural.undo();
    view.dispatch({ changes: { from: 5, insert: " before" }, userEvent: "input.type" });
    structural.record("doc", entry);
    view.dispatch({ changes: { from: 12, insert: " after" }, userEvent: "input.type" });
    entry.undo.mockClear();
    key();
    expect(view.state.doc.toString()).toBe("hello before");
    expect(entry.undo).not.toHaveBeenCalled();
    key();
    await vi.waitFor(() => expect(entry.undo).toHaveBeenCalledOnce());
    key();
    expect(view.state.doc.toString()).toBe("hello");
    key(view.contentDOM, true);
    expect(view.state.doc.toString()).toBe("hello before");
    key(view.contentDOM, true);
    await vi.waitFor(() => expect(entry.redo).toHaveBeenCalledOnce());
    key(view.contentDOM, true);
    expect(view.state.doc.toString()).toBe("hello before after");
});

it("restores a deletion even when the surviving draft is locked", async () => {
    const { entry } = setup(true);
    key();
    await vi.waitFor(() => expect(entry.undo).toHaveBeenCalledOnce());
});

it("shares the toast entry with keyboard undo and ignores stale duplicate callbacks", async () => {
    const { structural, entry } = setup();
    key();
    await vi.waitFor(() => expect(entry.undo).toHaveBeenCalledOnce());
    expect(await structural.undo(entry)).toBe(false);
    expect(entry.undo).toHaveBeenCalledOnce();
});

it("retains a failed restore for retry", async () => {
    const { structural, entry, error } = setup();
    entry.undo.mockRejectedValueOnce(new Error("offline"));
    await structural.undo();
    expect(error).toHaveBeenCalledOnce();
    await structural.undo();
    expect(entry.undo).toHaveBeenCalledTimes(2);
});

it("ignores duplicate shortcuts during asynchronous restore", async () => {
    const { entry } = setup();
    let finish!: () => void;
    entry.undo.mockImplementation(
        () =>
            new Promise<void>((resolve) => {
                finish = resolve;
            }),
    );
    key();
    key();
    expect(entry.undo).toHaveBeenCalledOnce();
    finish();
    await Promise.resolve();
});

it("drops structural redo after a new text edit", async () => {
    const { structural, entry } = setup();
    await structural.undo();
    view.dispatch({ changes: { from: 5, insert: "!" } });
    expect(await structural.redo()).toBe(false);
    expect(entry.redo).not.toHaveBeenCalled();
});

it("never restores an old document through a stale toast or keyboard", async () => {
    const { structural, entry, changeDocument } = setup();
    changeDocument();
    key();
    expect(await structural.undo(entry)).toBe(false);
    expect(entry.undo).not.toHaveBeenCalled();
});

it.each(["input", "textarea", "unrelated dialog", "outside"])(
    "does not steal undo from %s",
    (kind) => {
        const { entry } = setup();
        const target = document.createElement(
            kind === "input" || kind === "textarea" ? kind : "button",
        );
        document.body.appendChild(target);
        if (kind === "unrelated dialog") {
            const dialog = document.createElement("dialog");
            document.body.appendChild(dialog);
            dialog.appendChild(target);
        }
        expect(key(target).defaultPrevented).toBe(false);
        expect(entry.undo).not.toHaveBeenCalled();
    },
);

it("rebases the content boundary when another draft loads", async () => {
    const { changeDraft, entry } = setup();
    const next = EditorState.create({
        doc: "other",
        extensions: [history(), keymap.of(historyKeymap)],
    });
    view.setState(next);
    view.dispatch({ changes: { from: 5, insert: " old" } });
    changeDraft();
    key();
    await vi.waitFor(() => expect(entry.undo).toHaveBeenCalledOnce());
    expect(view.state.doc.toString()).toBe("other old");
});

it("preserves typing boundaries through a reload of the same draft", async () => {
    const { structural, entry } = setup();
    view.dispatch({ changes: { from: 5, insert: "!" }, userEvent: "input.type" });
    structural.loaded();
    key();
    expect(view.state.doc.toString()).toBe("hello");
    expect(entry.undo).not.toHaveBeenCalled();
    key();
    await vi.waitFor(() => expect(entry.undo).toHaveBeenCalledOnce());
});

it("leaves CodeMirror search fields to their native undo", () => {
    const { entry } = setup();
    const input = document.createElement("input");
    view.dom.appendChild(input);
    key(input);
    expect(entry.undo).not.toHaveBeenCalled();
});

it("does not intercept a live editor that replaced CodeMirror history", () => {
    const { entry } = setup();
    view.setState(EditorState.create({ doc: "live" }));
    expect(key().defaultPrevented).toBe(false);
    expect(entry.undo).not.toHaveBeenCalled();
});

it("keeps the deletion boundary after CodeMirror trims old history", async () => {
    const { structural, entry } = setup();
    await structural.undo();
    for (let i = 0; i < 150; i++) {
        view.dispatch({
            changes: { from: view.state.doc.length, insert: "a" },
            userEvent: "input",
        });
    }
    structural.record("doc", entry);
    entry.undo.mockClear();
    for (let i = 0; i < 60; i++) {
        view.dispatch({
            changes: { from: view.state.doc.length, insert: "b" },
            userEvent: "input",
        });
    }
    for (let i = 0; i < 60; i++) {
        key();
        expect(entry.undo).not.toHaveBeenCalled();
    }
    expect(view.state.doc.toString()).toBe(`hello${"a".repeat(150)}`);
    key();
    await vi.waitFor(() => expect(entry.undo).toHaveBeenCalledOnce());
});

it("restores a deletion after the same draft reloads with fresh content history", async () => {
    const { structural, entry } = setup();
    await structural.undo();
    view.dispatch({ changes: { from: 5, insert: "!" } });
    structural.record("doc", entry);
    entry.undo.mockClear();
    view.setState(
        EditorState.create({
            doc: "hello!",
            extensions: [history(), keymap.of(historyKeymap), EditorState.readOnly.of(true)],
        }),
    );
    structural.loaded();
    key();
    await vi.waitFor(() => expect(entry.undo).toHaveBeenCalledOnce(), { timeout: 100 });
});

it("invalidates toast callbacks when the editor session is disposed", async () => {
    const { structural, entry } = setup();
    unlisten?.();
    expect(await structural.undo(entry)).toBe(false);
    expect(entry.undo).not.toHaveBeenCalled();
});

it("does not resurrect redo when typing occurs during a pending restore", async () => {
    const { structural, entry } = setup();
    let finish!: () => void;
    entry.undo.mockImplementation(
        () =>
            new Promise<void>((resolve) => {
                finish = resolve;
            }),
    );
    const pending = structural.undo();
    view.dispatch({ changes: { from: 5, insert: "!" } });
    finish();
    await pending;
    expect(await structural.redo()).toBe(false);
});

it("does not recreate a disposed session when a pending restore completes", async () => {
    const { structural, entry } = setup();
    let finish!: () => void;
    entry.undo.mockImplementation(
        () =>
            new Promise<void>((resolve) => {
                finish = resolve;
            }),
    );
    const pending = structural.undo();
    unlisten?.();
    finish();
    await pending;
    expect(await structural.redo()).toBe(false);
});

it("does not run an older toast out of structural order", async () => {
    const { structural, entry } = setup();
    const latest = {
        undo: vi.fn().mockResolvedValue(undefined),
        redo: vi.fn().mockResolvedValue(undefined),
    };
    structural.record("doc", latest);
    expect(await structural.undo(entry)).toBe(false);
    expect(entry.undo).not.toHaveBeenCalled();
    await structural.undo();
    await structural.undo(entry);
    expect(latest.undo).toHaveBeenCalledOnce();
    expect(entry.undo).toHaveBeenCalledOnce();
});

it("keeps structural redo reachable when a reload drops content redo", async () => {
    const { structural, entry } = setup();
    await structural.undo();
    view.dispatch({ changes: { from: 5, insert: "!" } });
    structural.record("doc", entry);
    await structural.undo();
    key(); // undo the older prose
    view.setState(
        EditorState.create({ doc: "hello", extensions: [history(), keymap.of(historyKeymap)] }),
    );
    structural.loaded();
    key(view.contentDOM, true);
    await vi.waitFor(() => expect(entry.redo).toHaveBeenCalledOnce());
});
