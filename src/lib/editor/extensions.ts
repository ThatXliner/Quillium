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
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { history, historyField, historyKeymap } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { lintKeymap } from "@codemirror/lint";
import { search, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  dropCursor,
  highlightSpecialChars,
  keymap,
} from "@codemirror/view";
import { annotationField } from "./plugins/annotations";
import { annotations } from "./plugins/annotations";
import { type ListenerOptions, listeners } from "./listeners";

// Fields that are serialised to JSON on save and restored on load.
// Adding a field here means it survives across application restarts.
export const savedFields = { historyField, annotationField };

export const getExtensions = (options?: ListenerOptions) => [
  highlightSpecialChars(),
  // Default is 500 milliseconds
  // but I find that too long
  history({ newGroupDelay: 250 }),
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
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    // ...foldKeymap,
    ...completionKeymap,
    ...lintKeymap,
    indentWithTab,
  ]),
  EditorView.lineWrapping,
  EditorView.contentAttributes.of({
    spellcheck: "true",
    autocorrect: "on",
    autocapitalize: "on",
  }),
  listeners(options),
  annotations(),
];
