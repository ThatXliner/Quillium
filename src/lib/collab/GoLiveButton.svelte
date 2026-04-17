<!--
    GoLiveButton.svelte -- Top-right collab toggle.

    Per D-56: "Go Live" toggle in top-right area (near AuthButton).
    Per D-57: Live Room mode only -- session ends when owner leaves.
    Per D-58: Snapshot before pulling remote state.
    Per D-59: Manual toggle for owner's own documents.
-->
<script lang="ts">
import { isAuthenticated, getUser, getSession } from "$lib/auth/auth.svelte";
import { editorView, currentDraftId, lastPersistedEventId } from "$lib/stores";
import { createNamedSnapshot } from "$lib/db";
import { savedFields } from "$lib/editor/extensions";
import { enableCollab, disableCollab, relayConfigured } from "$lib/collab";
import { get } from "svelte/store";
import { toast } from "svelte-sonner";

let isLive = $state(false);
let connecting = $state(false);

const authenticated = $derived(isAuthenticated());
const canGoLive = $derived(authenticated && relayConfigured);

async function handleToggle() {
    if (isLive) {
        // Go offline
        const view = get(editorView);
        if (view) {
            disableCollab(view);
        }
        isLive = false;
        toast.success("Session ended");
    } else {
        // Go live -- snapshot first (D-58)
        connecting = true;
        try {
            const view = get(editorView);
            const draftId = get(currentDraftId);
            const eventId = get(lastPersistedEventId);
            const user = getUser();
            const session = getSession();

            if (!view || !draftId || !user || !session) {
                throw new Error("Missing required state");
            }

            // Per D-58: Snapshot before pulling remote state
            const stateJson = JSON.stringify(view.state.toJSON(savedFields));
            await createNamedSnapshot(draftId, stateJson, eventId, "Before going live (auto)");

            // Per D-50: clientID is user.id for per-user undo
            // startVersion 0 for new sessions (relay will send full state)
            await enableCollab(view, draftId, 0, user.id);

            isLive = true;
            toast.success("You're live!");
        } catch (err) {
            console.error("[collab] Failed to go live:", err);
            const message = err instanceof Error && err.message.includes("relay")
                ? "Couldn't connect to relay server"
                : "Failed to go live";
            toast.error(message);
        } finally {
            connecting = false;
        }
    }
}
</script>

{#if canGoLive}
    <button
        onclick={handleToggle}
        disabled={connecting}
        class="px-4 py-2 text-xs font-medium rounded-full shadow-md transition-colors
            {isLive
                ? 'bg-green-500 text-white hover:bg-green-600'
                : 'text-black/50 bg-white/50 backdrop-blur-md hover:text-black/70 hover:bg-white/60'}"
    >
        {#if connecting}
            Connecting...
        {:else if isLive}
            Live
        {:else}
            Go Live
        {/if}
    </button>
{/if}
