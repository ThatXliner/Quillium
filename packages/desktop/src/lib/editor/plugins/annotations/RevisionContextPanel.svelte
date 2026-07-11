<!--
    RevisionContextPanel.svelte — Desktop data adapter for the shared revision
    context viewport. Desktop retains lazy document loading; presentation,
    masking, centering, and scroll behavior live in @quillium/share.
-->
<script lang="ts">
import type { ModalEntry } from "$lib/stores";
import {
    RevisionContextPanel as RevisionContextPanelView,
    type RevisionContextViewLayer,
} from "@quillium/share";
import { type Annotation, annotationField } from ".";

const { crumbs, refreshKey }: { crumbs: ModalEntry[]; refreshKey: unknown } = $props();

const CHUNK = 300;
let contextBefore = $state(CHUNK);
let contextAfter = $state(CHUNK);

const contextLayers = $derived.by((): RevisionContextViewLayer[] => {
    void refreshKey;
    const layers: RevisionContextViewLayer[] = [];
    for (let index = 0; index < crumbs.length; index++) {
        const crumb = crumbs[index];
        if (crumb.type !== "revision") continue;
        const parentState = crumb.parentView.state;
        const revision = parentState.field(annotationField)[crumb.revisionId] as
            | Annotation<"revision">
            | undefined;
        if (!revision) continue;

        const document = parentState.doc;
        const from = revision.selection.main.from;
        const to = revision.selection.main.to;
        const isOuter = index === 0;
        const beforeStart = isOuter ? Math.max(0, from - contextBefore) : 0;
        const afterEnd = isOuter ? Math.min(document.length, to + contextAfter) : document.length;
        layers.push({
            before: document.sliceString(beforeStart, from),
            revision: document.sliceString(from, to),
            after: document.sliceString(to, afterEnd),
            hasMoreBefore: isOuter && beforeStart > 0,
            hasMoreAfter: isOuter && afterEnd < document.length,
        });
    }
    return layers;
});
</script>

<RevisionContextPanelView
    layers={contextLayers}
    centerKey={refreshKey}
    onLoadMoreBefore={() => (contextBefore += CHUNK)}
    onLoadMoreAfter={() => (contextAfter += CHUNK)}
/>
