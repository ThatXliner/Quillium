<script lang="ts">
    import { onMount } from "svelte";
    import { X, RotateCcw, BookmarkPlus, Clock, Pencil } from "lucide-svelte";
    import { get } from "svelte/store";
    import {
        currentDraftId,
        editorView,
        lastPersistedEventId,
    } from "$lib/stores";
    import {
        listSnapshots,
        labelSnapshot,
        restoreToSnapshot,
        createNamedSnapshot,
    } from "$lib/db";
    import { savedFields } from "$lib/editor/extensions";
    import type { SnapshotMeta } from "$lib/db/types";

    const { onclose, onrestore }: { onclose: () => void; onrestore: () => void } = $props();

    let snapshots = $state<SnapshotMeta[]>([]);
    let loading = $state(true);
    let checkpointLabel = $state("");
    let savingCheckpoint = $state(false);
    let confirmingRestoreId = $state<number | null>(null);
    let editingLabelId = $state<number | null>(null);
    let editingLabelText = $state("");
    let dialog: HTMLDialogElement;

    onMount(() => {
        dialog.showModal();
        loadSnapshots();
    });

    async function loadSnapshots() {
        loading = true;
        const draftId = get(currentDraftId);
        if (!draftId) { loading = false; return; }
        snapshots = await listSnapshots(draftId);
        loading = false;
    }

    async function saveCheckpoint() {
        const draftId = get(currentDraftId);
        const view = get(editorView);
        const eventId = get(lastPersistedEventId);
        if (!draftId || !view || eventId < 0 || !checkpointLabel.trim()) return;
        savingCheckpoint = true;
        try {
            const stateJson = JSON.stringify(view.state.toJSON(savedFields));
            await createNamedSnapshot(draftId, stateJson, eventId, checkpointLabel.trim());
            checkpointLabel = "";
            await loadSnapshots();
        } finally {
            savingCheckpoint = false;
        }
    }

    async function handleRestore(snapshot: SnapshotMeta) {
        if (confirmingRestoreId !== snapshot.id) {
            confirmingRestoreId = snapshot.id;
            return;
        }
        const draftId = get(currentDraftId);
        if (!draftId) return;
        await restoreToSnapshot(draftId, snapshot.id);
        onrestore();
    }

    async function commitLabelEdit(snapshot: SnapshotMeta) {
        if (editingLabelText.trim()) {
            await labelSnapshot(snapshot.id, editingLabelText.trim());
            await loadSnapshots();
        }
        editingLabelId = null;
    }

    function formatDate(ms: number): string {
        const d = new Date(ms);
        return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
            + " at "
            + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    }

    function handleBackdropClick(e: MouseEvent) {
        if (e.target === dialog) onclose();
    }
</script>

<dialog
    bind:this={dialog}
    onclick={handleBackdropClick}
    onclose={onclose}
    class="m-auto rounded-2xl bg-white/95 backdrop-blur-md shadow-2xl border border-black/[0.07]
           w-[480px] max-h-[80vh] p-0 overflow-hidden
           open:flex open:flex-col
           backdrop:bg-black/20 backdrop:backdrop-blur-sm"
>
    <!-- Header -->
    <div class="flex items-center justify-between px-5 py-4 border-b border-black/[0.06]">
        <div class="flex items-center gap-2 text-black/80">
            <Clock size={16} />
            <span class="text-sm font-semibold">Version History</span>
        </div>
        <button
            onclick={onclose}
            class="w-7 h-7 rounded-full flex items-center justify-center text-black/40
                   hover:text-black/70 hover:bg-black/5 transition-colors"
        >
            <X size={14} />
        </button>
    </div>

    <!-- Save checkpoint -->
    <div class="px-5 py-3 border-b border-black/[0.06] bg-blue-50/40">
        <p class="text-xs text-black/50 mb-2">Save a named checkpoint of the current state</p>
        <div class="flex gap-2">
            <input
                type="text"
                bind:value={checkpointLabel}
                placeholder="Checkpoint name…"
                onkeydown={(e) => e.key === "Enter" && saveCheckpoint()}
                class="flex-1 text-sm px-3 py-1.5 rounded-lg border border-black/[0.1]
                       bg-white/80 placeholder:text-black/30 focus:outline-none
                       focus:ring-2 focus:ring-blue-400/40"
            />
            <button
                onclick={saveCheckpoint}
                disabled={savingCheckpoint || !checkpointLabel.trim()}
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
                       bg-blue-500 text-white hover:bg-blue-600 transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed"
            >
                <BookmarkPlus size={13} />
                Save
            </button>
        </div>
    </div>

    <!-- Snapshot list -->
    <div class="flex-1 overflow-y-auto">
        {#if loading}
            <div class="flex items-center justify-center py-12 text-black/30 text-sm">
                Loading…
            </div>
        {:else if snapshots.length === 0}
            <div class="flex flex-col items-center justify-center py-12 gap-2 text-center px-8">
                <Clock size={28} class="text-black/20" />
                <p class="text-sm text-black/50">No checkpoints yet.</p>
                <p class="text-xs text-black/35">
                    Checkpoints are saved automatically every 50 edits or 2 minutes.
                </p>
            </div>
        {:else}
            <ul class="divide-y divide-black/[0.04]">
                {#each snapshots as snapshot (snapshot.id)}
                    <li class="flex items-start gap-3 px-5 py-3.5 hover:bg-black/[0.02] transition-colors">
                        <!-- Left accent -->
                        <div class="mt-0.5 w-0.5 self-stretch rounded-full flex-shrink-0
                                    {snapshot.label ? 'bg-blue-400' : 'bg-black/10'}">
                        </div>

                        <!-- Content -->
                        <div class="flex-1 min-w-0">
                            <!-- Label row -->
                            <div class="flex items-center gap-1.5 mb-0.5">
                                {#if editingLabelId === snapshot.id}
                                    <input
                                        type="text"
                                        bind:value={editingLabelText}
                                        autofocus
                                        onblur={() => commitLabelEdit(snapshot)}
                                        onkeydown={(e) => {
                                            if (e.key === "Enter") commitLabelEdit(snapshot);
                                            if (e.key === "Escape") editingLabelId = null;
                                        }}
                                        class="text-sm font-medium text-blue-600 bg-blue-50
                                               border border-blue-300 rounded px-1.5 py-0.5
                                               focus:outline-none w-full max-w-[240px]"
                                    />
                                {:else if snapshot.label}
                                    <span
                                        class="text-sm font-medium text-blue-600 cursor-pointer
                                               hover:underline"
                                        onclick={() => {
                                            editingLabelId = snapshot.id;
                                            editingLabelText = snapshot.label ?? "";
                                        }}
                                        title="Click to rename"
                                    >{snapshot.label}</span>
                                    <button
                                        onclick={() => {
                                            editingLabelId = snapshot.id;
                                            editingLabelText = snapshot.label ?? "";
                                        }}
                                        class="text-black/25 hover:text-black/50 transition-colors"
                                    >
                                        <Pencil size={11} />
                                    </button>
                                {:else}
                                    <span class="text-xs bg-black/5 text-black/40 px-2 py-0.5
                                                 rounded-full">Auto-saved</span>
                                    <button
                                        onclick={() => {
                                            editingLabelId = snapshot.id;
                                            editingLabelText = "";
                                        }}
                                        class="text-black/25 hover:text-black/50 transition-colors"
                                        title="Add label"
                                    >
                                        <Pencil size={11} />
                                    </button>
                                {/if}
                            </div>
                            <p class="text-xs text-black/40">{formatDate(snapshot.createdAt)}</p>
                        </div>

                        <!-- Restore button -->
                        <button
                            onclick={() => handleRestore(snapshot)}
                            class="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full
                                   text-xs font-medium transition-colors
                                   {confirmingRestoreId === snapshot.id
                                       ? 'bg-red-100 text-red-700 hover:bg-red-200'
                                       : 'bg-black/5 text-black/50 hover:bg-black/10'}"
                        >
                            <RotateCcw size={11} />
                            {confirmingRestoreId === snapshot.id ? "Confirm?" : "Restore"}
                        </button>
                    </li>
                {/each}
            </ul>
        {/if}
    </div>
</dialog>
