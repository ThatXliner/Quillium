<!--
    PreviewContent.svelte — The content half of the history preview.

    Renders the viewed tab's document content at the selected coordinate inside a
    REAL read-only CodeMirror editor (same extensions/theme/font/width as the
    actual editor and locked-draft view), with track-changes decorations on top:
    additions highlighted green, deletions injected as red strikethrough widgets
    (vs. the same draft's immediately-previous version). Building it from the
    editor's own pipeline is what makes the preview look identical to editing.

    Props:
      currentStateJson — serialized EditorState of the version to show, or null
      previousText     — plain text of the previous version (diff baseline)
      loading          — true while content is being fetched
      hasContent       — false when the viewed tab has no content at this point
      bannerText       — optional note shown above the content (structural coord)
-->
<script lang="ts">
import { getExtensions, savedFields } from "$lib/editor/extensions";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { docTextFromStateJson } from "./diff";
import { diffDecorations, diffTheme } from "./diffDecorations";

const {
    currentStateJson,
    previousText,
    loading,
    hasContent,
    bannerText = null,
}: {
    currentStateJson: string | null;
    previousText: string;
    loading: boolean;
    hasContent: boolean;
    bannerText?: string | null;
} = $props();

let previewEl = $state<HTMLDivElement | undefined>();
let previewView: EditorView | undefined;

const hasChanges = $derived(hasContent && docTextFromStateJson(currentStateJson) !== previousText);

// Mount/remount a read-only editor from the current version's state, with the
// track-changes overlay. Re-runs when the element binds or the inputs change.
$effect(() => {
    if (!previewEl || loading || !hasContent) return;

    previewView?.destroy();

    const current = docTextFromStateJson(currentStateJson);
    const extensions = [
        // Same stack the editor and locked-draft / library previews use, so the
        // typography and layout match exactly.
        ...getExtensions({ persist: false, history: false }),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        diffTheme,
        diffDecorations(previousText, current),
    ];

    let state: EditorState;
    const json = currentStateJson;
    if (json && json !== "{}") {
        try {
            state = EditorState.fromJSON(JSON.parse(json), { extensions }, savedFields);
        } catch {
            state = EditorState.create({ extensions });
        }
    } else {
        state = EditorState.create({ extensions });
    }

    previewView = new EditorView({ state, parent: previewEl });

    return () => {
        previewView?.destroy();
    };
});
</script>

<div class="w-full flex flex-col items-center gap-3">
    {#if bannerText}
        <div
            class="w-[816px] max-w-full rounded-lg border border-black/[0.08] bg-blue-50/60
                   px-4 py-2 text-xs text-black/60"
        >
            {bannerText}
        </div>
    {/if}

    {#if loading}
        <div class="flex items-center justify-center w-full py-20 text-black/30 text-sm">
            Loading…
        </div>
    {:else if !hasContent}
        <div
            class="w-[816px] max-w-full min-h-[40vh] bg-white rounded-lg shadow-xl
                   flex items-center justify-center text-sm text-black/35"
        >
            This tab has no content at this point.
        </div>
    {:else}
        {#if hasChanges}
            <div class="w-[816px] max-w-full flex items-center gap-4 text-[11px] text-black/45 px-1">
                <span class="flex items-center gap-1.5">
                    <span class="inline-block w-3 h-3 rounded-sm bg-green-200 border border-green-300"></span>
                    Added
                </span>
                <span class="flex items-center gap-1.5">
                    <span class="inline-block w-3 h-3 rounded-sm bg-red-200 border border-red-300"></span>
                    Removed
                </span>
                <span class="text-black/30">vs. previous version</span>
            </div>
        {/if}

        <div
            class="version-preview w-[816px] max-w-full min-h-[40vh] bg-white rounded-lg shadow-xl
                   py-3 px-1 select-text"
            bind:this={previewEl}
        ></div>
    {/if}
</div>

<style>
    :global(.version-preview .cm-cursor) {
        display: none !important;
    }
</style>
