import { dev } from "$app/environment";
import { editorialTargetBookmarkField, editorialTargetViewTracker } from "$lib/ai/editorialTarget";
import { collabCompartment } from "$lib/collab";
import { appEventBus } from "$lib/events/appEventBus";
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
 *     deserialisation (load) to persist annotations across sessions.
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
    historyKeymap,
    indentWithTab,
    redo,
    undo,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
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
import { editorHistoryShortcuts } from "./historyShortcuts";
import { dictionaryExtension } from "./dictionaryPlugin";
import { harperExtension } from "./harper/harperLinter";
import { type ListenerOptions, listeners } from "./listeners";
import { markdownFormattingKeymap } from "./markdownFormatting";
import {
    persistHistoryFacet,
    persistentHistoryField,
    persistentHistoryRuntimeExtension,
    persistentHistoryStateExtension,
} from "./persistentHistory";
import { annotationField } from "./plugins/annotations";
import { annotations } from "./plugins/annotations";
import { versionGroupField } from "./plugins/annotations";
import { richMarkdownExtension } from "./richMarkdown";

// Fields that are serialised to JSON on save and restored on load.
// persistentHistoryField wraps CodeMirror's history JSON with tagged Quillium
// StateEffects, keeping cross-restart undo lossless for annotations and versions.
export const savedFields = {
    historyField: persistentHistoryField,
    annotationField,
    versionGroupField,
};
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
            appEventBus.emit({ type: "manual-review" });
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
export const languageCompartment = new Compartment();
// Wraps history() so live collaboration can reconfigure it to []. Every peer
// uses the scoped Y.UndoManager while live; CodeMirror history is rebuilt empty
// when collaboration ends.
export const historyCompartment = new Compartment();

export function getEditorLanguageExtension(mode = appSettings.editorMode) {
    return mode === "markdown" ? markdown() : [];
}

export const getExtensions = (options?: ListenerOptions) => {
    const withHistory = options?.history !== false;
    const persistHistory = options?.persistHistory ?? true;
    return [
        highlightSpecialChars(),
        // Read-only previews and nested editors omit history entirely. Mark
        // them non-persistent too so event replay never attempts an undo/redo
        // command against a state that has no history field installed.
        persistHistoryFacet.of(withHistory && persistHistory),
        // Default is 500 milliseconds
        // but I find that too long
        ...(withHistory
            ? [
                  persistentHistoryStateExtension,
                  editorHistoryShortcuts,
                  historyCompartment.of([
                      persistentHistoryRuntimeExtension,
                      history({ newGroupDelay: 250 }),
                  ]),
              ]
            : []),
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
        languageCompartment.of(getEditorLanguageExtension()),
        editorialTargetBookmarkField,
        editorialTargetViewTracker,
        richMarkdownExtension(),
        markdownFormattingKeymap,
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
