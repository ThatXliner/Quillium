import { dev } from "$app/environment";
import { appSettings } from "$lib/settings.svelte";
/**
 * extensions.ts — Assembles the full CodeMirror 6 extension stack.
 *
 * Role: Single source of truth for every CodeMirror extension used
 * by the editor. Called once at startup (from Editor.svelte) to
 * produce the extension array passed to EditorState.create() or
 * EditorState.fromJSON().
 *
 * Key dependencies:
 *   - @codemirror/* packages — core editing capabilities
 *   - ./plugins/annotations — annotation StateField + decorations
 *   - ./listeners — persistence & change-reaction listeners
 *
 * Interactions:
 *   - Editor.svelte calls `getExtensions(options)` and feeds the
 *     result into an EditorState.
 *   - `savedFields` is used by both serialisation (save) and
 *     deserialisation (load) to persist history and annotations
 *     across sessions.
 */
import {
    autocompletion,
    closeBrackets,
    closeBracketsKeymap,
    completionKeymap,
} from "@codemirror/autocomplete";
import {
    defaultKeymap,
    history,
    historyField,
    historyKeymap,
    indentWithTab,
    redo,
    undo,
} from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import {
    EditorView,
    type KeyBinding,
    dropCursor,
    highlightSpecialChars,
    keymap,
} from "@codemirror/view";
import { collabCompartment } from "$lib/collab";
import { dictionaryExtension } from "./dictionaryPlugin";
import { harperExtension } from "./harper/harperLinter";
import { type ListenerOptions, listeners } from "./listeners";
import { annotationField } from "./plugins/annotations";
import { annotations } from "./plugins/annotations";

// Fields that are serialised to JSON on save and restored on load.
// Adding a field here means it survives across application restarts.
export const savedFields = { historyField, annotationField };
// Nested editors delegate undo/redo to the parent, so they don't own
// a history stack. Only annotationField is persisted in version blobs
// (for nested annotations created inside a modal).
export const nestedSavedFields = { annotationField };

const editorKeymap: KeyBinding[] = [
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...(dev
        ? [
              {
                  key: "Ctrl-z",
                  run: undo,
              },
              {
                  key: "Meta-z",
                  run: undo,
              },
              {
                  key: "Ctrl-Shift-z",
                  run: redo,
              },
              {
                  key: "Meta-Shift-z",
                  run: redo,
              },
          ]
        : []),
    ...historyKeymap,
    ...completionKeymap,
    indentWithTab,
    {
        key: "Mod-Shift-r",
        run() {
            window.dispatchEvent(new CustomEvent("quillium:manual-review"));
            return true;
        },
    },
] as unknown as KeyBinding[];

const nestedEditorKeymap: KeyBinding[] = [
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...completionKeymap,
    indentWithTab,
] as unknown as KeyBinding[];

export const harperCompartment = new Compartment();
// Wraps history() so enableCollab(asOwner=false) can reconfigure it to []
// (joiner peer has no CM history; undo via Y.UndoManager instead). See JOINER-01.
export const historyCompartment = new Compartment();

export const getExtensions = (options?: ListenerOptions) => {
    const withHistory = options?.history !== false;
    return [
        highlightSpecialChars(),
        // Default is 500 milliseconds
        // but I find that too long
        ...(withHistory ? [historyCompartment.of(history({ newGroupDelay: 250 }))] : []),
        // Will re-enable for multi-selection support
        // drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        search(),
        // rectangularSelection(),
        // highlightSelectionMatches(),
        keymap.of(withHistory ? editorKeymap : nestedEditorKeymap),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
            spellcheck: "true",
            autocorrect: "on",
            autocapitalize: "on",
        }),
        listeners(options),
        annotations(),
        dictionaryExtension,
        ...(withHistory
            ? [harperCompartment.of(appSettings.grammarCheckEnabled ? harperExtension() : [])]
            : []),
        // Collab extension (initially disabled, reconfigured on "Go Live" per D-51)
        collabCompartment.of([]),
    ];
};
