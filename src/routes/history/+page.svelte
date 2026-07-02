<script lang="ts">
import VersionHistory from "$lib/editor/VersionHistory.svelte";
import { Toaster } from "svelte-sonner";
</script>

<VersionHistory />
<!-- VersionHistory reports restore/preview failures via toast. -->
<Toaster position="bottom-right" />
