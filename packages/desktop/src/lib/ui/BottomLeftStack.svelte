<!--
    BottomLeftStack.svelte — Fixed bottom-left corner container.

    Owns the bottom-left viewport corner. Children stack vertically
    from the bottom up via flex-col-reverse. When AutoAI expands or
    a new item is added, existing items are pushed up smoothly.
-->
<script lang="ts">
import { type Snippet } from "svelte";

const { children }: { children: Snippet } = $props();
</script>

<div class="fixed bottom-6 left-6 z-40 flex flex-col-reverse items-start gap-4">
    {@render children()}
</div>
