<script lang="ts">
/**
 * /authorship — Writing-provenance playback.
 *
 * Gated on the `authorship-provenance` flag. The gate fails closed, so a user
 * who lands here by URL or by an accelerator that slipped through gets the
 * unavailable state rather than an unreviewed authorship report.
 */
import { authorshipEnabled } from "$lib/featureFlags.svelte";
import { goToEditor } from "$lib/navigation";
import PlaybackViewer from "$lib/provenance/PlaybackViewer.svelte";
import { ArrowLeft } from "lucide-svelte";
</script>

{#if $authorshipEnabled}
    <PlaybackViewer />
{:else}
    <div
        class="h-screen w-full flex flex-col items-center justify-center gap-3 px-8 text-center bg-[#f5f5f0]"
    >
        <h1 class="text-base font-medium text-black/70">Authorship report is unavailable</h1>
        <p class="max-w-md text-sm text-black/50">
            This feature is still in development and is not enabled on your account.
        </p>
        <button
            type="button"
            class="mt-1 inline-flex items-center gap-1.5 rounded-md border border-black/[0.08] bg-white px-3 py-1.5 text-sm text-black/70 shadow-sm hover:bg-black/[0.03]"
            onclick={() => goToEditor()}
        >
            <ArrowLeft size={16} />
            Back to editor
        </button>
    </div>
{/if}
