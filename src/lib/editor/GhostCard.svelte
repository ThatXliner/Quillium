<script lang="ts">
import { onMount, onDestroy } from "svelte";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getExtensions, savedFields } from "./extensions";
import { replayEvents } from "./replay";
import { loadDocumentState, listDrafts } from "$lib/db";
import "./plugins/annotations/default.css";

const { docId, width = 240 } = $props<{ docId: string; width?: number }>();

// The CM view renders at this full width, then gets scaled down.
const FULL_WIDTH = 816;
const scale = width / FULL_WIDTH;

let container = $state<HTMLDivElement>();
let view: EditorView | null = null;

const previewExtensions = [
    ...getExtensions(),
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
];

async function buildPreview() {
    if (!container) return;
    const drafts = await listDrafts(docId);
    if (drafts.length === 0) return;
    const draft = drafts.find((d) => d.isActive) ?? drafts[0];
    const loaded = await loadDocumentState(docId, draft.id);

    let state: EditorState;
    if (loaded.snapshotStateJson && loaded.snapshotStateJson !== "{}") {
        try {
            state = EditorState.fromJSON(
                JSON.parse(loaded.snapshotStateJson),
                { extensions: previewExtensions },
                savedFields,
            );
        } catch {
            state = EditorState.create({ extensions: previewExtensions });
        }
    } else {
        state = EditorState.create({ extensions: previewExtensions });
    }

    if (loaded.eventsSince.length > 0) {
        state = replayEvents(state, loaded.eventsSince);
    }

    view = new EditorView({ state, parent: container });
}

onMount(() => { buildPreview(); });
onDestroy(() => { view?.destroy(); view = null; });
</script>

<!--
    Outer div is the visible box (width x whatever height the parent sets).
    Inner div is full FULL_WIDTH, scaled down with transform-origin top-left.
    overflow:hidden clips the scaled content cleanly.
-->
<div class="absolute inset-0 overflow-hidden rounded-lg pointer-events-none">
    <div
        bind:this={container}
        class="py-3 px-1"
        style="
            width: {FULL_WIDTH}px;
            transform: scale({scale});
            transform-origin: top left;
        "
    ></div>
</div>
