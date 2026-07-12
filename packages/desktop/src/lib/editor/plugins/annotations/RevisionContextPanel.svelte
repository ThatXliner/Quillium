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
import { annotationField, isAnnotationOfType } from ".";

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
        const revision = parentState.field(annotationField)[crumb.revisionId];
        if (!revision || !isAnnotationOfType(revision, "revision")) continue;

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

const contextIdentity = $derived.by((): string => {
    void refreshKey;
    return crumbs
        .filter((crumb) => crumb.type === "revision")
        .map((crumb) => {
            const annotation = crumb.parentView.state.field(annotationField)[crumb.revisionId];
            const activeVersionId =
                annotation && isAnnotationOfType(annotation, "revision")
                    ? annotation.activeVersionId
                    : "";
            return `${crumb.revisionId}:${activeVersionId}`;
        })
        .join("/");
});

$effect(() => {
    void contextIdentity;
    contextBefore = CHUNK;
    contextAfter = CHUNK;
});
</script>

<RevisionContextPanelView
    layers={contextLayers}
    centerKey={contextIdentity}
    onLoadMoreBefore={() => (contextBefore += CHUNK)}
    onLoadMoreAfter={() => (contextAfter += CHUNK)}
/>
