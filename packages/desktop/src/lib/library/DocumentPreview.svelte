<!--
    DocumentPreview.svelte — Read-only CodeMirror preview for library panel.
    Loads and displays full document content with formatting.
-->
<script lang="ts">
import { loadDocumentState, resolveActiveDraftId } from "$lib/db";
import { getExtensions } from "$lib/editor/extensions";
import { reconstructState } from "$lib/editor/replay";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import "$lib/editor/plugins/annotations/default.css";

interface Props {
    docId: string | null;
}

const { docId }: Props = $props();

let previewEl = $state<HTMLDivElement>();
let previewView: EditorView | undefined;
let loading = $state(false);
let error = $state<string | null>(null);

$effect(() => {
    const id = docId;
    if (!id || !previewEl) {
        previewView?.destroy();
        previewView = undefined;
        return;
    }

    loading = true;
    error = null;

    loadPreview(id, previewEl)
        .then((view) => {
            previewView?.destroy();
            previewView = view;
            loading = false;
        })
        .catch((e) => {
            console.error("[DocumentPreview] Failed to load:", e);
            error = "Failed to load preview";
            loading = false;
        });

    return () => {
        previewView?.destroy();
        previewView = undefined;
    };
});

async function loadPreview(id: string, parent: HTMLDivElement): Promise<EditorView> {
    const activeDraftId = await resolveActiveDraftId(id);
    if (!activeDraftId) {
        throw new Error("No draft found");
    }

    const loaded = await loadDocumentState(id, activeDraftId);
    const extensions = [
        ...getExtensions({ persist: false, history: false }),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
    ];

    const state = reconstructState(loaded.snapshotStateJson, loaded.eventsSince, extensions);
    return new EditorView({ state, parent });
}
</script>

<div class="relative h-full w-full overflow-hidden">
    {#if loading}
        <div class="absolute inset-0 flex items-center justify-center bg-gray-50/80">
            <div class="w-5 h-5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin"></div>
        </div>
    {/if}
    {#if error}
        <div class="absolute inset-0 flex items-center justify-center bg-gray-50">
            <p class="text-sm text-red-400">{error}</p>
        </div>
    {/if}
    <div
        bind:this={previewEl}
        class="h-full w-full overflow-y-auto [&_.cm-editor]:h-full [&_.cm-scroller]:!overflow-y-auto [&_.cm-content]:pb-8 [&_.cm-editor]:!outline-none [&_.cm-cursor]:hidden [&_.cm-selectionBackground]:!bg-transparent"
    ></div>
</div>
