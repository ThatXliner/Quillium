<script lang="ts">
    import { EditorState } from "@codemirror/state";
    import {
        EditorView,
        keymap,
        highlightSpecialChars,
        drawSelection,
        dropCursor,
        rectangularSelection,
    } from "@codemirror/view";
    import { onMount } from "svelte";
    import {
        defaultHighlightStyle,
        syntaxHighlighting,
        bracketMatching,
    } from "@codemirror/language";
    import {
        defaultKeymap,
        history,
        historyKeymap,
    } from "@codemirror/commands";
    import { exists, BaseDirectory } from "@tauri-apps/plugin-fs";
    // when using `"withGlobalTauri": true`, you may use
    // const { exists, BaseDirectory } = window.__TAURI__.fs;

    // Check if the `$APPDATA/avatar.png` file exists
    // await exists("avatar.png", { baseDir: BaseDirectory.AppData });
    // import {
    //     searchKeymap,
    //     highlightSelectionMatches,
    // } from "@codemirror/search";
    import {
        autocompletion,
        completionKeymap,
        closeBrackets,
        closeBracketsKeymap,
    } from "@codemirror/autocomplete";
    import { lintKeymap } from "@codemirror/lint";

    let element: HTMLDivElement;
    // const theme = EditorView.baseTheme({
    //     "&.cm-focused": { outline: "none" },
    //     "&": { "font-family": "Arial" },
    // });
    const extensions = [
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        // highlightSelectionMatches(),
        keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            // ...searchKeymap,
            ...historyKeymap,
            // ...foldKeymap,
            ...completionKeymap,
            ...lintKeymap,
        ]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
            spellcheck: "true",
            autocorrect: "on",
            autocapitalize: "on",
        }),
    ];
    onMount(() => {
        let startState = EditorState.create({
            doc: "Hello World",
            extensions: extensions,
        });

        let view = new EditorView({
            state: startState,
            parent: element,
        });
    });
</script>

<div
    class="mx-auto w-[816px] h-[1056px] mt-12 bg-white rounded-lg shadow-xl p-3"
    bind:this={element}
></div>

<style>
    :global(.cm-editor.cm-focused) {
        outline: none;
    }
    :global(.cm-content) {
        font-family:
            Arial,
            Helvetica,
            system-ui,
            -apple-system,
            BlinkMacSystemFont,
            "Segoe UI",
            Roboto,
            Oxygen,
            Ubuntu,
            Cantarell,
            "Open Sans",
            "Helvetica Neue",
            sans-serif;
        letter-spacing: 0.05em; /* Adjust spacing between characters */
        line-height: 1.5; /* Improve vertical spacing */
    }
    :global(.cm-content) {
        text-indent: 2em;
    }
</style>
