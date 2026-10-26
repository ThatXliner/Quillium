<script lang="ts">
import ThreadMessage from "./cards/ThreadMessage.svelte";
import { parsePassageLink } from "./passageLink";
import type { SerializedThreadMessage } from "./types";

let { message, truncate = false }: { message: SerializedThreadMessage; truncate?: boolean } =
    $props();
const passage = $derived(parsePassageLink(message.message));
</script>

<ThreadMessage message={{ ...message, message: passage.text }} {truncate} />
{#if passage.link && !truncate}
    <p class="ml-9 mt-1 text-xs text-black/60" title={passage.link.quote}>
        Supporting passage: “{passage.link.quote.slice(0, 160)}{passage.link.quote.length > 160 ? "…" : ""}”
    </p>
{/if}
