/**
 * dictionaryPlugin.ts — CodeMirror keymap for the dictionary popover.
 *
 * Registers Cmd-d (⌘D on Mac) as a shortcut to open the dictionary
 * popover for the currently selected word. If nothing is selected or
 * the selection is multi-word, the command is a no-op.
 */
import { dev } from "$app/environment";
import { appEventBus } from "$lib/events/appEventBus";
import posthog from "$lib/posthog";
import { Prec } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import { extractDictionaryWord } from "./dictionaryUtils";

function openDictionary(view: EditorView): boolean {
    const sel = view.state.selection.main;
    if (sel.empty) return false;

    const raw = view.state.sliceDoc(sel.from, sel.to);
    const result = extractDictionaryWord(raw, sel.from);
    if (!result) return false;

    const { word, selectionFrom, selectionTo } = result;

    const fromCoords = view.coordsAtPos(selectionFrom);
    const toCoords = view.coordsAtPos(selectionTo);
    if (!fromCoords || !toCoords) return false;

    const x = (fromCoords.left + toCoords.right) / 2;
    const y = Math.max(fromCoords.bottom, toCoords.bottom) + 8;

    appEventBus.emit({ type: "dictionary-open", word, selectionFrom, selectionTo, x, y });
    posthog.capture("dictionary_opened");
    return true;
}

export const dictionaryExtension = Prec.high(
    keymap.of([
        { key: "Mod-d", run: openDictionary },
        ...(dev
            ? [
                  { key: "Ctrl-d", run: openDictionary },
                  { key: "Meta-d", run: openDictionary },
              ]
            : []),
    ]),
);
