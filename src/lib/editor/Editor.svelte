<script lang="ts">
    import { EditorState } from "@codemirror/state";
    import { EditorView } from "@codemirror/view";
    import { invoke } from "@tauri-apps/api/core";
    import { onMount } from "svelte";
    import { getExtensions, savedFields } from "./extensions";
    import { editorView, annotations, activeComment } from "$lib/stores";
    import "./plugins/annotations/default.css";
    import { historyField } from "@codemirror/commands";
    import type { ViewUpdate } from "@codemirror/view";
    import StatusBar from "./StatusBar.svelte";
    import type { ListenerOptions } from "./listeners";
    import { annotationField } from "./plugins/annotations";
    import { getActiveAnnotation } from "./plugins/annotations/utils";

    let element = $state<HTMLDivElement>();
    let stats = $state<{
        words: number;
        wpm: number;
        chars: number;
    }>({
        words: 0,
        wpm: 0,
        chars: 0,
    });
    // I don't think these need to be annotated with $state
    // because they're not being used in the UI
    const firstRenderTime = Date.now();
    let firstRenderWords = 0;
    function getWPM(newWords: number) {
        return (
            (newWords - firstRenderWords) /
            ((Date.now() - firstRenderTime) / 1000 / 60)
        );
    }
    function getWordCount(doc: string) {
        return doc.split(" ").filter((x) => x).length;
    }
    const getExtensionOptions: ListenerOptions = {
        updateListener(update: ViewUpdate) {
            const doc = update.state.doc.toString();
            const newWords = getWordCount(doc);
            stats = {
                words: newWords,
                wpm: getWPM(newWords),
                chars: doc.length,
            };
            $annotations = update.state.field(annotationField);
            $activeComment = getActiveAnnotation($editorView.state, "comment");
        },
    };

    const loop = () => {
        stats.wpm = getWPM(stats.words);
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    const fromSave = invoke("load").then((d: unknown) => {
        const data = d as string | null;
        let state: EditorState;
        if (data && false) {
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
            wpm: 0,
            chars: doc.length,
        };
        firstRenderWords = stats.words;
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

<div class="w-full">
    <div class="sticky top-4 z-50"><StatusBar {...stats} /></div>

    {#await fromSave then}
        <div
            class="mx-auto w-[816px] h-fit mt-12 bg-white rounded-lg shadow-xl py-3 px-1"
            bind:this={element}
        ></div>
    {/await}
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
        position: absolute;
    }
    :global(.cm-content) {
        text-indent: 2em;
    }
</style>
