<script lang="ts">
import ThreadMessage from "./cards/ThreadMessage.svelte";
import type { SerializedThreadMessage } from "./types";

let { message, truncate = false }: { message: SerializedThreadMessage; truncate?: boolean } =
    $props();
</script>

<ThreadMessage {message} {truncate} />
