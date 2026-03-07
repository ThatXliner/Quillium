<script lang="ts">
    /**
     * Editor.svelte — Main editor component and application entry point
     * for the writing surface.
     *
     * Role: Bootstraps a CodeMirror 6 EditorView, wires it into
     * Svelte stores, and orchestrates persistence (load/save via Tauri).
     *
     * Key dependencies:
     *   - CodeMirror 6 (EditorState, EditorView) — core editing engine
     *   - Tauri invoke("load") — restores serialised editor state from
     *     the Rust backend on startup
     *   - extensions.ts — assembles the full CodeMirror extension stack
     *   - listeners.ts — persistence & change-reaction listeners
     *   - $lib/stores — Svelte stores that expose editor state to the
     *     rest of the UI (AI sidebar, annotation panel, status bar)
     *
     * Interactions:
     *   - On every editor update the `updateListener` callback syncs
     *     document content, selection, annotations, and writing stats
     *     into Svelte stores so sibling components can react.
     *   - The Annotations panel and AI sidebar read from those stores;
     *     they never touch the EditorView directly.
     */
    import { EditorState } from "@codemirror/state";
    import { EditorView } from "@codemirror/view";
    import { invoke } from "@tauri-apps/api/core";
    import { onMount } from "svelte";
    import posthog from "posthog-js";
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

    // ── Local UI state ──────────────────────────────────────────────
    // `element` is the DOM node CodeMirror mounts into (bound in the
    // template). `stats` holds live writing metrics displayed in the
    // StatusBar; it is updated on every editor transaction.
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

    /**
     * Extracts the currently selected text from an editor update.
     * Returns an empty string when nothing is selected.
     */
    function extractSelectedText(update: ViewUpdate): string {
        const selection = update.state.selection.main;
        return selection.empty
            ? ""
            : update.state.sliceDoc(selection.from, selection.to);
    }

    /**
     * Computes a fresh WritingStats snapshot from the current
     * document text and selection text.
     */
    function computeWritingStats(
        doc: string,
        selText: string,
    ) {
        return {
            words: getWordCount(doc),
            chars: doc.length,
            selWords: selText ? getWordCount(selText) : 0,
            selChars: selText.length,
        };
    }

    /**
     * Pushes the latest annotation and document state from
     * CodeMirror into the global Svelte stores so sibling
     * components (AI sidebar, annotation panel) stay in sync.
     */
    function syncStoresToEditorState(
        update: ViewUpdate,
        doc: string,
        selText: string,
    ) {
        $annotations = Object.values(
            update.state.field(annotationField),
        );
        $activeAnnotation = getActiveAnnotation($editorView.state);
        $documentContent = doc;
        $selectedText = selText;
    }

    // ── Update listener ─────────────────────────────────────────────
    // Fires after every CodeMirror transaction. Responsible for:
    //   1. Recomputing writing statistics (word/char counts).
    //   2. Syncing annotation state from the CodeMirror StateField
    //      into the Svelte `$annotations` store.
    //   3. Syncing document content and selection into stores so the
    //      AI sidebar has access to current context.
    // Triggers: any document change, selection change, or annotation
    // transaction.
    // Downstream effects: StatusBar re-renders, Annotations panel
    // updates, AI sidebar receives fresh context.
    const getExtensionOptions: ListenerOptions = {
        updateListener(update: ViewUpdate) {
            const doc = update.state.doc.toString();
            const selText = extractSelectedText(update);

            stats = computeWritingStats(doc, selText);
            syncStoresToEditorState(update, doc, selText);
        },
    };

    // ── State restoration ───────────────────────────────────────────
    // On module init we ask the Tauri backend for any previously
    // saved editor state. If found, we deserialise it (including
    // history and annotation fields); otherwise we create a fresh
    // EditorState. The resulting promise (`fromSave`) is awaited
    // both in the template (to defer rendering) and in onMount (to
    // attach the EditorView once the DOM is ready).
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

    /**
     * Reloads the editor from the Tauri backend's saved state.
     * Used by the debug panel after writing a scenario to disk —
     * ensures the live EditorView gets the full extension stack
     * (including annotation decorations and the update listener)
     * rather than a bare setState() call.
     */
    export async function reload() {
        const data = await invoke("load") as string | null;
        if (!data || !$editorView) return;
        const state = EditorState.fromJSON(
            JSON.parse(data),
            { extensions: getExtensions(getExtensionOptions) },
            savedFields,
        );
        $editorView.setState(state);
        const doc = state.doc.toString();
        stats = {
            words: getWordCount(doc),
            chars: doc.length,
            selWords: 0,
            selChars: 0,
        };
    }

    onMount(() => {
        // Must be inside onMount since element may not be defined yet
        fromSave.then((state) => {
            $editorView = new EditorView({
                state,
                parent: element,
            });
            posthog.capture("app_session_started", {
                word_count: getWordCount(state.doc.toString()),
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
        font-family: var(--doc-font-family);
        font-size: var(--doc-font-size);
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
