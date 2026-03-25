<!--
    GhostCard.svelte — A scaled-down read-only CodeMirror preview of a draft.

    Mounts a real EditorView (read-only, no listeners, no persistence) inside
    a fixed-size container, then CSS-scales it down so it looks like a
    miniature version of the actual document — same font, same decorations.
-->
<script lang="ts">
import { onMount, onDestroy } from "svelte";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getExtensions, savedFields } from "./extensions";
import { replayEvents } from "./replay";
import { loadDocumentState, listDrafts } from "$lib/db";
import "./plugins/annotations/default.css";

const { docId } = $props<{ docId: string }>();

let container = $state<HTMLDivElement>();
let view: EditorView | null = null;

const previewExtensions = [
    ...getExtensions(), // no listeners, no persistence
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
];

async function buildPreview() {
    if (!container) return;

    // Resolve the active draft.
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
    The ghost card is the same width as the main editor card (816px), just
    physically offset behind it. We mount a full-size EditorView and let
    overflow:hidden clip it — the visible sliver matches the main card's layout.
-->
<!-- py-3 px-1 matches the main editor card's wrapper padding -->
<div class="absolute inset-0 overflow-hidden rounded-lg pointer-events-none py-3 px-1">
    <div bind:this={container} class="w-full h-full"></div>
</div>
