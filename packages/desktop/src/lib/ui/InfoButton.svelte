<!-- InfoButton.svelte — Opens help for a nearby setting or action. -->
<script lang="ts">
import { InfoIcon } from "lucide-svelte";

const { title, onclick }: { title: string; onclick: () => void } = $props();
</script>

<button
    type="button"
    aria-label={`About ${title.toLowerCase()}`}
    aria-haspopup="dialog"
    title={`About ${title.toLowerCase()}`}
    {onclick}
    class="flex size-6 shrink-0 items-center justify-center rounded-full text-black/50 hover:text-black/70 hover:bg-black/5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
>
    <InfoIcon size={12} aria-hidden="true" />
</button>
