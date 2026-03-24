<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { ArrowLeft, BookmarkPlus, Clock, Pencil, ChevronRight, RotateCcw } from "lucide-svelte";
    import { get } from "svelte/store";
    import { EditorView } from "@codemirror/view";
    import { EditorState } from "@codemirror/state";
    import {
        currentDraftId,
        editorView,
        lastPersistedEventId,
        lastSavedAt,
    } from "$lib/stores";
    import {
        listSnapshots,
        labelSnapshot,
        restoreToSnapshot,
        createNamedSnapshot,
        loadSnapshotState,
    } from "$lib/db";
    import { savedFields, getExtensions } from "$lib/editor/extensions";
    import { goToEditor } from "$lib/navigation";
    import Kbd from "$lib/ui/Kbd.svelte";
    import type { SnapshotMeta } from "$lib/db/types";

    // ── State ───────────────────────────────────────────────────────
    let snapshots = $state<SnapshotMeta[]>([]);
    let loading = $state(true);
    let selectedSnapshot = $state<SnapshotMeta | null>(null);
    let previewLoading = $state(false);
    let confirmingRestoreId = $state<number | null>(null);
    let editingLabelId = $state<number | null>(null);
    let editingLabelText = $state("");
    let checkpointLabel = $state("");
    let savingCheckpoint = $state(false);

    // Loaded state JSON for the selected snapshot — set async, consumed by $effect
    let previewStateJson = $state<string | null>(null);
    let previewEl = $state<HTMLDivElement | undefined>();
    let previewView: EditorView | undefined;

    // Mount/remount the CodeMirror preview whenever the target element or
    // the loaded state JSON changes. This avoids any tick() timing dependency —
    // Svelte will re-run this effect as soon as previewEl is bound.
    $effect(() => {
        if (!previewEl || previewLoading) return;

        previewView?.destroy();

        const extensions = [
            ...getExtensions({ persist: false, history: false }),
            EditorState.readOnly.of(true),
        ];

        let state: EditorState;
        const json = previewStateJson;
        if (json && json !== "{}") {
            try {
                state = EditorState.fromJSON(JSON.parse(json), { extensions }, savedFields);
            } catch {
                state = EditorState.create({ extensions });
            }
        } else {
            state = EditorState.create({ extensions });
        }

        previewView = new EditorView({ state, parent: previewEl });

        return () => { previewView?.destroy(); };
    });

    // ── Lifecycle ───────────────────────────────────────────────────
    onMount(async () => {
        await loadSnapshots();
        if (snapshots.length > 0) {
            await selectSnapshot(snapshots[0]);
        }
    });

    onDestroy(() => {
        previewView?.destroy();
    });

    // ── Data ────────────────────────────────────────────────────────
    async function loadSnapshots() {
        loading = true;
        const draftId = get(currentDraftId);
        if (!draftId) { loading = false; return; }
        snapshots = await listSnapshots(draftId);
        loading = false;
    }

    async function selectSnapshot(snapshot: SnapshotMeta) {
        selectedSnapshot = snapshot;
        confirmingRestoreId = null;
        previewLoading = true;
        previewStateJson = null;

        const stateJson = await loadSnapshotState(snapshot.id);

        previewStateJson = stateJson;
        previewLoading = false;
        // $effect re-runs automatically once previewEl is in the DOM and
        // previewStateJson/previewLoading have settled — no tick() needed.
    }

    async function handleRestore() {
        if (!selectedSnapshot) return;
        if (confirmingRestoreId !== selectedSnapshot.id) {
            confirmingRestoreId = selectedSnapshot.id;
            return;
        }
        const draftId = get(currentDraftId);
        if (!draftId) return;
        await restoreToSnapshot(draftId, selectedSnapshot.id);
        goToEditor();
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

    async function commitLabelEdit(snapshot: SnapshotMeta) {
        if (editingLabelText.trim()) {
            await labelSnapshot(snapshot.id, editingLabelText.trim());
            await loadSnapshots();
            if (selectedSnapshot?.id === snapshot.id) {
                selectedSnapshot = { ...selectedSnapshot, label: editingLabelText.trim() };
            }
        }
        editingLabelId = null;
    }

    // ── Date grouping ───────────────────────────────────────────────
    type Group = { heading: string; items: SnapshotMeta[] };

    function groupByDate(snaps: SnapshotMeta[]): Group[] {
        const groups: Group[] = [];
        let lastHeading = "";
        for (const snap of snaps) {
            const heading = headingForDate(snap.createdAt);
            if (heading !== lastHeading) {
                groups.push({ heading, items: [] });
                lastHeading = heading;
            }
            groups[groups.length - 1].items.push(snap);
        }
        return groups;
    }

    function headingForDate(ms: number): string {
        const d = new Date(ms);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
        if (diffDays === 0) return "Today";
        if (diffDays === 1) return "Yesterday";
        if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
        if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear())
            return "This month";
        return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }

    function formatTime(ms: number): string {
        const d = new Date(ms);
        return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
            + ", "
            + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    }

    function formatTimeShort(ms: number): string {
        return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    }

    const groups = $derived(groupByDate(snapshots));

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") goToEditor();
    }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="h-screen w-full flex flex-col bg-[#f5f5f0]">
    <!-- Top bar -->
    <div class="flex items-center gap-4 px-5 py-3 bg-white border-b border-black/[0.08] shadow-sm flex-shrink-0">
        <button
            onclick={goToEditor}
            class="flex items-center gap-2 text-sm text-black/60 hover:text-black/90
                   transition-colors px-2 py-1 rounded-md hover:bg-black/5"
        >
            <ArrowLeft size={16} />
            Back
            <Kbd keys={["Esc"]} />
        </button>
        <div class="w-px h-5 bg-black/15"></div>
        <div class="flex-1 flex items-center gap-2">
            <Clock size={15} class="text-black/40" />
            <span class="text-sm font-medium text-black/70">Version History</span>
            {#if selectedSnapshot}
                <ChevronRight size={14} class="text-black/30" />
                <span class="text-sm text-black/50">
                    {selectedSnapshot.label ?? formatTime(selectedSnapshot.createdAt)}
                </span>
            {/if}
        </div>
        <!-- Save named checkpoint -->
        <div class="flex items-center gap-2">
            {#if $lastSavedAt}
                <span class="text-xs text-black/35">
                    Last saved {formatTimeShort($lastSavedAt)}
                </span>
            {/if}
            <input
                type="text"
                bind:value={checkpointLabel}
                placeholder="Name this version…"
                onkeydown={(e) => e.key === "Enter" && saveCheckpoint()}
                class="text-sm px-3 py-1.5 rounded-lg border border-black/[0.12] bg-white
                       placeholder:text-black/30 focus:outline-none focus:ring-2
                       focus:ring-blue-400/40 w-48"
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
        {#if selectedSnapshot}
            <div class="w-px h-5 bg-black/15"></div>
            <button
                onclick={handleRestore}
                class="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium
                       transition-colors
                       {confirmingRestoreId === selectedSnapshot.id
                           ? 'bg-red-500 text-white hover:bg-red-600'
                           : 'bg-black/[0.06] text-black/70 hover:bg-black/[0.10]'}"
            >
                <RotateCcw size={13} />
                {confirmingRestoreId === selectedSnapshot.id ? "Confirm restore?" : "Restore this version"}
            </button>
        {/if}
    </div>

    <!-- Body -->
    <div class="flex flex-1 overflow-hidden">

        <!-- Document preview -->
        <div class="flex-1 overflow-y-auto py-10 px-8 flex justify-center">
            {#if previewLoading}
                <div class="flex items-center justify-center w-full text-black/30 text-sm">
                    Loading…
                </div>
            {:else if !selectedSnapshot}
                <div class="flex flex-col items-center justify-center w-full gap-3 text-center">
                    <Clock size={36} class="text-black/15" />
                    <p class="text-sm text-black/40">Select a version to preview it</p>
                </div>
            {:else}
                <div
                    class="version-preview w-[816px] min-h-full bg-white rounded-lg shadow-xl
                           py-3 px-1 pointer-events-none select-none"
                    bind:this={previewEl}
                ></div>
            {/if}
        </div>

        <!-- Timeline panel -->
        <div class="w-72 bg-white border-l border-black/[0.08] flex flex-col overflow-hidden
                    shadow-[-4px_0_12px_-4px_rgba(0,0,0,0.06)]">
            <div class="px-4 py-3 border-b border-black/[0.06]">
                <h2 class="text-sm font-semibold text-black/70">Versions</h2>
            </div>

            <div class="flex-1 overflow-y-auto">
                {#if loading}
                    <div class="flex items-center justify-center py-16 text-black/30 text-sm">
                        Loading…
                    </div>
                {:else if snapshots.length === 0}
                    <div class="flex flex-col items-center justify-center py-16 gap-2 px-6 text-center">
                        <Clock size={28} class="text-black/15" />
                        <p class="text-sm text-black/45">No versions yet.</p>
                        <p class="text-xs text-black/30 leading-relaxed">
                            Versions are saved automatically every 50 edits or 2 minutes.
                        </p>
                    </div>
                {:else}
                    {#each groups as group}
                        <div class="px-4 pt-4 pb-1">
                            <span class="text-[11px] font-semibold text-black/35 uppercase tracking-wide">
                                {group.heading}
                            </span>
                        </div>
                        {#each group.items as snapshot (snapshot.id)}
                            {@const isSelected = selectedSnapshot?.id === snapshot.id}
                            <!-- svelte-ignore a11y_interactive_supports_focus -->
                            <div
                                role="option"
                                aria-selected={isSelected}
                                onclick={() => selectSnapshot(snapshot)}
                                class="w-full text-left px-4 py-2.5 flex items-start gap-3
                                       cursor-pointer transition-colors
                                       {isSelected
                                           ? 'bg-blue-50 border-r-2 border-blue-500'
                                           : 'hover:bg-black/[0.025] border-r-2 border-transparent'}"
                            >
                                <div class="mt-1.5 w-2 h-2 rounded-full flex-shrink-0
                                            {snapshot.label ? 'bg-blue-500' : 'bg-black/20'}">
                                </div>
                                <div class="flex-1 min-w-0">
                                    {#if editingLabelId === snapshot.id}
                                        <input
                                            type="text"
                                            bind:value={editingLabelText}
                                            autofocus
                                            onclick={(e) => e.stopPropagation()}
                                            onblur={() => commitLabelEdit(snapshot)}
                                            onkeydown={(e) => {
                                                e.stopPropagation();
                                                if (e.key === "Enter") commitLabelEdit(snapshot);
                                                if (e.key === "Escape") editingLabelId = null;
                                            }}
                                            class="text-sm font-medium text-blue-600 bg-blue-50
                                                   border border-blue-300 rounded px-1.5 py-0.5
                                                   focus:outline-none w-full"
                                        />
                                    {:else if snapshot.label}
                                        <div class="flex items-center gap-1">
                                            <span class="text-sm font-medium text-blue-600 truncate">
                                                {snapshot.label}
                                            </span>
                                            <button
                                                onclick={(e) => {
                                                    e.stopPropagation();
                                                    editingLabelId = snapshot.id;
                                                    editingLabelText = snapshot.label ?? "";
                                                }}
                                                class="text-black/20 hover:text-black/50
                                                       transition-colors flex-shrink-0"
                                            >
                                                <Pencil size={10} />
                                            </button>
                                        </div>
                                    {:else}
                                        <div class="flex items-center gap-1">
                                            <span class="text-xs text-black/50">
                                                {formatTimeShort(snapshot.createdAt)}
                                            </span>
                                            <button
                                                onclick={(e) => {
                                                    e.stopPropagation();
                                                    editingLabelId = snapshot.id;
                                                    editingLabelText = "";
                                                }}
                                                title="Add label"
                                                class="text-black/20 hover:text-black/50
                                                       transition-colors flex-shrink-0"
                                            >
                                                <Pencil size={10} />
                                            </button>
                                        </div>
                                    {/if}
                                    <p class="text-[11px] text-black/35 mt-0.5">Auto-saved</p>
                                </div>
                            </div>
                        {/each}
                    {/each}
                {/if}
            </div>
        </div>
    </div>
</div>

<style>
    :global(.version-preview .cm-editor) {
        pointer-events: none;
    }
    :global(.version-preview .cm-cursor) {
        display: none !important;
    }
</style>
