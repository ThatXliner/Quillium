<!--
    GoLiveButton.svelte -- Top-right collab toggle.

    Per D-56: "Go Live" toggle in top-right area (near AuthButton).
    Per D-57: Live Room mode only -- session ends when owner leaves.
    Per D-58: Snapshot before pulling remote state.
    Per D-59: Manual toggle for owner's own documents.
    Per D-70: Updated for Yjs migration.
-->
<script lang="ts">
import { isAuthenticated, getUser, getSession } from "$lib/auth/auth.svelte";
import { editorView, currentDraftId, lastPersistedEventId } from "$lib/stores";
import { createNamedSnapshot } from "$lib/db";
import { isCollabJoiner } from "$lib/collab/store";
import { savedFields } from "$lib/editor/extensions";
import { enableCollab, disableCollab, relayConfigured, registerDocumentForCollab, ownerLeftSignal, collabState, reconnectAttempt } from "$lib/collab";
import { get } from "svelte/store";
import { toast } from "svelte-sonner";

let isLive = $state(false);
let connecting = $state(false);
let menuOpen = $state(false);
let joinIdInput = $state("");
let prevCollabState = $state<string>("disconnected");

const authenticated = $derived(isAuthenticated());
const canGoLive = $derived(authenticated && relayConfigured);
const currentId = $derived($currentDraftId ?? "");

// React when owner ends the session (ownerLeftSignal is incremented by yjsProvider)
$effect(() => {
    if ($ownerLeftSignal > 0 && isLive) {
        // Provider already disconnected via handleOwnerLeft, just update UI state
        isLive = false;
        // Reset joiner flag -- persistence resumes normally after kick
        isCollabJoiner.set(false);
        toast.error("The owner ended the session");
    }
});

// React to reconnection state changes
$effect(() => {
    const state = $collabState;
    const attempt = $reconnectAttempt;

    // Reconnected successfully
    if (prevCollabState === "reconnecting" && state === "connected") {
        toast.success("Reconnected");
    }

    // Reconnection failed (error state after reconnecting)
    if (prevCollabState === "reconnecting" && state === "error") {
        toast.error("Connection lost. Please go live again to reconnect.");
        isLive = false;
    }

    // Started reconnecting (first attempt)
    if (prevCollabState !== "reconnecting" && state === "reconnecting" && attempt === 1) {
        toast("Connection lost, reconnecting...");
    }

    prevCollabState = state;
});

function copyId() {
    navigator.clipboard.writeText(currentId);
    toast.success("Document ID copied");
}

async function joinById() {
    const id = joinIdInput.trim();
    if (!id) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        toast.error("Invalid document ID format");
        return;
    }

    connecting = true;
    menuOpen = false;
    try {
        const view = get(editorView);
        const user = getUser();
        const session = getSession();
        if (!view || !user || !session) {
            throw new Error("Missing required state");
        }

        // Disconnect current session if live
        if (isLive) {
            disableCollab(view);
            isLive = false;
        }

        // Switch to shared document ID (skip sync_documents registration -- owner already did that)
        currentDraftId.set(id);

        // Mark this client as an ephemeral joiner BEFORE connecting so the
        // persistence listener skips Yjs-driven document updates. Joiners in
        // Live Room mode don't own the document -- the owner's local store is
        // authoritative, so we don't write the shared ID to our event log.
        isCollabJoiner.set(true);

        // Connect as joiner -- relay's content becomes source of truth
        await enableCollab(view, id, user.id, false);

        joinIdInput = "";
        isLive = true;
        toast.success("Joined shared document");
    } catch (err) {
        console.error("[collab] Failed to join:", err);
        // Reset joiner flag on failure so normal persistence resumes
        isCollabJoiner.set(false);
        const message = err instanceof Error && err.message.includes("relay")
            ? "Couldn't connect to relay server"
            : "Failed to join document";
        toast.error(message);
    } finally {
        connecting = false;
    }
}

async function handleToggle() {
    if (isLive) {
        // Go offline
        const view = get(editorView);
        if (view) {
            disableCollab(view);
        }
        isLive = false;
        // Reset joiner flag -- persistence resumes normally after disconnect
        isCollabJoiner.set(false);
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

            // Register document with relay's sync_documents table (auto-creates if missing)
            await registerDocumentForCollab(draftId, user.id, "Untitled");

            // Per D-50: clientID is user.id for per-user undo
            // Version comes from relay's initial state
            await enableCollab(view, draftId, user.id);

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
    <div class="relative flex items-center gap-1">
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
        <button
            onclick={() => (menuOpen = !menuOpen)}
            title="Sharing options"
            class="w-8 h-8 rounded-full text-black/50 bg-white/50 backdrop-blur-md hover:text-black/70 hover:bg-white/60 shadow-md transition-colors text-xs"
        >
            ⋯
        </button>

        {#if menuOpen}
            <div class="absolute top-10 right-0 z-50 w-80 p-3 bg-white rounded-lg shadow-xl border border-black/5 space-y-3 text-xs">
                <div>
                    <div class="font-medium text-black/70 mb-1">This document's ID</div>
                    <div class="flex gap-1">
                        <input
                            readonly
                            value={currentId}
                            class="flex-1 px-2 py-1 bg-black/5 rounded font-mono text-[10px] text-black/70"
                        />
                        <button
                            onclick={copyId}
                            class="px-2 py-1 bg-black/5 rounded hover:bg-black/10"
                        >
                            Copy
                        </button>
                    </div>
                </div>
                <div class="border-t border-black/5 pt-3">
                    <div class="font-medium text-black/70 mb-1">Join by document ID</div>
                    <form
                        onsubmit={(e) => {
                            e.preventDefault();
                            joinById();
                        }}
                        class="flex gap-1"
                    >
                        <input
                            bind:value={joinIdInput}
                            placeholder="Paste UUID..."
                            class="flex-1 px-2 py-1 bg-black/5 rounded font-mono text-[10px]"
                        />
                        <button
                            type="submit"
                            class="px-2 py-1 bg-black/5 rounded hover:bg-black/10"
                        >
                            Join
                        </button>
                    </form>
                </div>
            </div>
        {/if}
    </div>
{/if}
