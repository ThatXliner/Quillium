import {
    EditorState,
    StateField,
    StateEffect,
    Transaction,
    type Extension
} from "@codemirror/state";
import { EditorView, keymap, type KeyBinding } from "@codemirror/view";

interface HistoryNode {
    doc: string;
    parent: HistoryNode | null;
    children: HistoryNode[];
}

const pushHistoryEffect = StateEffect.define<HistoryNode>();
const moveHistoryEffect = StateEffect.define<HistoryNode>();

const treeHistoryField = StateField.define<{
    current: HistoryNode;
}>({
    create(state) {
        const root = { doc: state.doc.toString(), parent: null, children: [] };
        return { current: root };
    },
    update(value, transaction) {
        const push = transaction.effects.find(e => e.is(pushHistoryEffect));
        const move = transaction.effects.find(e => e.is(moveHistoryEffect));

        if (push) {
            const newNode = push.value;
            newNode.parent = value.current;
            value.current.children.push(newNode);
            return { current: newNode };
        }

        if (move) {
            return { current: move.value };
        }

        return value;
    }
});
const undo = (view: EditorView) => {
    undoTree(view);
    return true;
};
const redo = (view: EditorView) => {
    redoTree(view);
    return true;
};
export const historyKeymap: readonly KeyBinding[] = [
    {key: "Mod-z", run: undo, preventDefault: true},
    {key: "Mod-y", mac: "Mod-Shift-z", run: redo, preventDefault: true},
    {linux: "Ctrl-Shift-z", run: redo, preventDefault: true},
    // {key: "Mod-u", run: undoSelection, preventDefault: true},
    // {key: "Alt-u", mac: "Mod-Shift-u", run: redoSelection, preventDefault: true}
  ]

export function undoTree(view: EditorView) {
    const state = view.state;
    const { current } = state.field(treeHistoryField);
    const parent = current.parent;
    if (parent) {
        view.dispatch({
            changes: { from: 0, to: state.doc.length, insert: parent.doc },
            effects: moveHistoryEffect.of(parent)
        });
    }
}

export function redoTree(view: EditorView, childIndex = 0) {
    const state = view.state;
    const { current } = state.field(treeHistoryField);
    const child = current.children[childIndex];
    if (child) {
        view.dispatch({
            changes: { from: 0, to: state.doc.length, insert: child.doc },
            effects: moveHistoryEffect.of(child)
        });
    }
}

export function treeHistoryExtension(): Extension {
    return [
        treeHistoryField,
        EditorView.updateListener.of(update => {
            if (update.docChanged) {
                const currentDoc = update.state.doc.toString();
                const newNode: HistoryNode = {
                    doc: currentDoc,
                    parent: null,
                    children: []
                };
                update.view.dispatch({
                    effects: pushHistoryEffect.of(newNode)
                });
            }
        }),
        keymap.of(historyKeymap)
    ];
}