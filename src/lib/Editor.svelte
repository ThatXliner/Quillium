<script lang="ts">
    import { EditorState } from "@codemirror/state";
    import {
        EditorView,
        keymap,
        highlightSpecialChars,
        drawSelection,
        highlightActiveLine,
        dropCursor,
        rectangularSelection,
        crosshairCursor,
        lineNumbers,
        highlightActiveLineGutter,
    } from "@codemirror/view";
    import { onMount } from "svelte";
    import {
        defaultHighlightStyle,
        syntaxHighlighting,
        indentOnInput,
        bracketMatching,
        foldGutter,
        foldKeymap,
    } from "@codemirror/language";
    import {
        defaultKeymap,
        history,
        historyKeymap,
    } from "@codemirror/commands";
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
    const theme = EditorView.baseTheme({
        "&.cm-focused": { outline: "none" },
        "&": { "font-family": "Arial" },
    });
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
    class="mx-6 mt-12 bg-white rounded-lg shadow-xl h-screen p-3"
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
</style>
