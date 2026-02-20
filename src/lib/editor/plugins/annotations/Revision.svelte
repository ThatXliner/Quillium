<script lang="ts">
    import { PlusIcon, Trash2 } from "lucide-svelte";
    import {
        type Thread as ThreadType,
        type Annotation,
        createNewRevision,
        setActiveRevisionVersion,
        updateRevisionVersionText,
    } from ".";
    import Thread from "./Thread.svelte";
    import { editorView } from "$lib/stores";

    const {
        revision,
        isActive,
        remove,
        updateThread,
    }: {
        revision: Annotation<"revision">;
        isActive: boolean;
        remove: () => void;
        updateThread: (thread: ThreadType) => void;
    } = $props();
    const thread = $derived(revision.thread);
    let draft = $state("");
    const activeText = $derived.by(
        () => revision.versions[revision.currentlySelected] ?? "",
    );
    const hasUnsavedChanges = $derived(draft !== activeText);

    $effect(() => {
        draft = activeText;
    });

    function saveCurrentVersion() {
        if (!$editorView || !hasUnsavedChanges) return;
        $editorView.dispatch(
            updateRevisionVersionText(
                $editorView.state,
                revision.id,
                revision.currentlySelected,
                draft,
            ),
        );
    }
</script>

<div
    class="backdrop-blur-md border overflow-hidden transition-all duration-200
        {isActive
            ? 'bg-gray-200/80 border-white/50 shadow-xl rounded-[14px]'
            : 'bg-gray-300/70 border-white/30 shadow-lg rounded-[12px] opacity-90 hover:opacity-100'}"
>
    <div class="p-3 space-y-3">
        <h3 class="text-xs font-semibold text-black/60 uppercase tracking-wider">Revisions</h3>

        <div class="flex flex-wrap gap-1.5">
            {#each revision.versions as _, i}
                {@const versionActive = i == revision.currentlySelected}
                <button
                    class="px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all
                        {versionActive
                            ? 'bg-purple-500/80 text-white border-purple-400/50 shadow-sm'
                            : 'bg-white/40 inset-shadow-sm inset-shadow-white text-black/70 border-white/30 hover:bg-white/60'}"
                    disabled={versionActive}
                    onclick={() => {
                        $editorView.dispatch(
                            setActiveRevisionVersion(
                                $editorView.state,
                                revision.id,
                                i,
                            ),
                        );
                    }}
                >
                    V{i + 1}
                </button>
            {/each}
        </div>

        <p class="text-[11px] text-black/50 leading-relaxed">
            Revision text is edited here. Inline document editing inside revision ranges is locked.
        </p>

        <textarea
            class="w-full min-h-28 rounded-lg border border-white/30 bg-white/45 px-2.5 py-2 text-xs text-black/80 resize-y focus:outline-none focus:ring-1 focus:ring-purple-400/60"
            bind:value={draft}
            onkeydown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    saveCurrentVersion();
                }
            }}
        ></textarea>

        <button
            class="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-lg border transition-colors
                {hasUnsavedChanges
                    ? 'text-purple-700/90 bg-white/45 hover:bg-white/60 border-white/35'
                    : 'text-black/35 bg-white/25 border-white/25'}"
            disabled={!hasUnsavedChanges}
            onclick={saveCurrentVersion}
        >
            <span>Save Version</span>
        </button>

        <button
            class="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium text-purple-700/70 bg-white/30 hover:bg-white/50 rounded-lg border border-white/30 transition-colors"
            onclick={() => {
                $editorView.dispatch(
                    createNewRevision($editorView.state, revision.id),
                );
            }}
            title="Generate new revision"
        >
            <PlusIcon size={11} />
            <span>New Revision</span>
        </button>
    </div>

    <div class="w-full h-px bg-black/10"></div>

    <div class="p-3">
        <Thread {thread} {updateThread} />
    </div>

    <div class="flex justify-end px-2 pb-2">
        <button
            class="p-1.5 rounded-lg text-black/30 hover:text-red-500/70 hover:bg-white/40 transition-colors"
            onclick={() => remove()}
            title="Delete revision"
        >
            <Trash2 size={13} />
        </button>
    </div>
</div>
