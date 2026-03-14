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
} from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { lintKeymap } from "@codemirror/lint";
import { search, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import {
    EditorView,
    dropCursor,
    highlightSpecialChars,
    keymap,
    type KeyBinding,
} from "@codemirror/view";
import { annotationField } from "./plugins/annotations";
import { annotations } from "./plugins/annotations";
import { type ListenerOptions, listeners } from "./listeners";

// Fields that are serialised to JSON on save and restored on load.
// Adding a field here means it survives across application restarts.
export const savedFields = { historyField, annotationField };
// Nested editors delegate undo/redo to the parent, so they don't own
// a history stack. Only annotationField is persisted in version blobs.
//
// NOTE: We intentionally do NOT recursively serialize the full EditorView
// state for nested annotation data (e.g. annotations inside a revision
// version). Doing so would require deep serialization of arbitrarily nested
// EditorState trees, which is overly complex and unnecessary — the annotation
// content (doc text + nested annotationField) is all we need to restore a
// version faithfully. Cursor position is stored separately as a plain integer
// (VersionState.cursorPos) and restored after the view is recreated.
export const nestedSavedFields = { annotationField };

const editorKeymap: KeyBinding[] = [
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...completionKeymap,
    ...lintKeymap,
    indentWithTab,
] as unknown as KeyBinding[];

const nestedEditorKeymap: KeyBinding[] = [
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...completionKeymap,
    ...lintKeymap,
    indentWithTab,
] as unknown as KeyBinding[];

export const getExtensions = (options?: ListenerOptions) => {
    const withHistory = options?.history !== false;
    return [
        highlightSpecialChars(),
        // Default is 500 milliseconds
        // but I find that too long
        ...(withHistory ? [history({ newGroupDelay: 250 })] : []),
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
    ];
};
