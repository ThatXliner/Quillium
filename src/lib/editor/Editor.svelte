<script lang="ts">
    import { EditorState } from "@codemirror/state";
    import { EditorView } from "@codemirror/view";
    import { invoke } from "@tauri-apps/api/core";
    import { onMount } from "svelte";
    import { getExtensions, savedFields } from "./extensions";
    import {
        editorView,
        annotations,
        documentContent,
        selectedText,
        activeAnnotation,
    } from "$lib/stores";
    import "./plugins/annotations/default.css";
    import type { ViewUpdate } from "@codemirror/view";
    import StatusBar from "./StatusBar.svelte";
    import Annotations from "./plugins/annotations/Annotations.svelte";
    import type { ListenerOptions } from "./listeners";
    import { annotationField } from "./plugins/annotations";
    import { getActiveAnnotation } from "./plugins/annotations/utils";

    let element = $state<HTMLDivElement>();
    let stats = $state<{
        words: number;
        chars: number;
        selWords: number;
        selChars: number;
    }>({
        words: 0,
        chars: 0,
        selWords: 0,
        selChars: 0,
    });

    function getWordCount(doc: string): number {
        return doc.trim().split(/\s+/).filter(Boolean).length;
    }

    const getExtensionOptions: ListenerOptions = {
        updateListener(update: ViewUpdate) {

            const doc = update.state.doc.toString();
            const newWords = getWordCount(doc);

            const selection = update.state.selection.main;
            const selText = selection.empty
                ? ""
                : update.state.sliceDoc(selection.from, selection.to);

            stats = {
                words: newWords,
                chars: doc.length,
                selWords: selText ? getWordCount(selText) : 0,
                selChars: selText.length,
            };
            $annotations = Object.values(update.state.field(annotationField));
            $activeAnnotation = getActiveAnnotation($editorView.state);

            // Sync document content and selection for AI chat
            $documentContent = doc;
            $selectedText = selText;
        },
    };

    const fromSave = invoke("load").then((d: unknown) => {
        const data = d as string | null;
        let state: EditorState;
        if (data) {
            state = EditorState.fromJSON(
                JSON.parse(data),
                { extensions: getExtensions(getExtensionOptions) },
                savedFields,
            );
        } else {
            state = EditorState.create({
                doc: "Hello World",
                extensions: getExtensions(getExtensionOptions),
            });
        }
        const doc = state.doc.toString();
        stats = {
            words: getWordCount(doc),
            chars: doc.length,
            selWords: 0,
            selChars: 0,
        };
        return state;
    });

    onMount(() => {
        // Must be inside onMount
        // since element may not be defined yet
        fromSave.then((state) => {
            $editorView = new EditorView({
                state,
                parent: element,
            });
        });
    });
</script>

<div class="w-full h-full overflow-y-auto relative">
    <div class="sticky top-4 z-50"><StatusBar {...stats} /></div>

    {#await fromSave then}
        <div
            id="editor-document"
            class="mx-auto w-[816px] min-h-[calc(100vh-4rem)] mt-12 mb-12 bg-white rounded-lg shadow-xl py-3 px-1"
            bind:this={element}
        ></div>
    {/await}

    <Annotations />
</div>

<style>
    :global(.cm-editor.cm-focused) {
        outline: none;
    }
    :global(.cm-content) {
        font-family:
            "SF Pro Text",
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
        font-size: 18px;
    }
    :global(.cm-editor) {
        z-index: 0 !important;
    }
    :global(.cm-scroller) {
        overflow: visible !important;
    }
    :global(.cm-content) {
        text-indent: 2em;
    }
</style>
