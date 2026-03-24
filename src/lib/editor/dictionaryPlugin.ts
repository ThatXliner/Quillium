/**
 * dictionaryPlugin.ts — CodeMirror keymap for the dictionary popover.
 *
 * Registers Cmd-b (⌘B on Mac) as a shortcut to open the dictionary
 * popover for the currently selected word. If nothing is selected or
 * the selection is multi-word, the command is a no-op.
 */
import { keymap, type EditorView } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { dictionaryTrigger } from "$lib/stores";

function openDictionary(view: EditorView): boolean {
    const sel = view.state.selection.main;
    if (sel.empty) return false;

    const word = view.state.sliceDoc(sel.from, sel.to).trim();
    // Only trigger for single words (no whitespace, reasonable length)
    if (!word || /\s/.test(word) || word.length > 60) return false;

    const fromCoords = view.coordsAtPos(sel.from);
    const toCoords = view.coordsAtPos(sel.to);
    if (!fromCoords || !toCoords) return false;

    const x = (fromCoords.left + toCoords.right) / 2;
    const y = Math.max(fromCoords.bottom, toCoords.bottom) + 8;

    dictionaryTrigger.set({ word, selectionFrom: sel.from, selectionTo: sel.to, x, y });
    return true;
}

export const dictionaryExtension = Prec.high(keymap.of([{ key: "Mod-b", run: openDictionary }]));
