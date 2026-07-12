<script lang="ts">
/** Revision-specific adapter retained as the stable public component API. */
import ContextViewport from "./ContextViewport.svelte";
import type { RevisionContextViewLayer } from "./types";

let {
    layers,
    centerKey,
    onLoadMoreBefore,
    onLoadMoreAfter,
}: {
    layers: readonly RevisionContextViewLayer[];
    centerKey?: unknown;
    onLoadMoreBefore?: () => void;
    onLoadMoreAfter?: () => void;
} = $props();
</script>

<ContextViewport
    {layers}
    variant="revision"
    targetLabel="revision"
    {centerKey}
    {onLoadMoreBefore}
    {onLoadMoreAfter}
/>
