<script lang="ts">
    import { SendHorizonalIcon, SparklesIcon, Trash2 } from "lucide-svelte";
    import {
        type Thread as ThreadType,
        type Annotation,
        createNewRevision,
        setActiveRevisionVersion,
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
</script>

<div
    class="group relative bg-white rounded-lg p-2.5 transition-all duration-300 ease-out {isActive
        ? 'shadow-xl ring-2 ring-purple-500 scale-[1.02]'
        : 'shadow-sm hover:shadow-md ring-1 ring-gray-200 hover:ring-gray-300'}"
    role="button"
    tabindex="0"
    onclick={() => {
        // Focus the annotation in the editor
        if ($editorView && revision.selection) {
            $editorView.dispatch({
                selection: revision.selection,
                scrollIntoView: true,
            });
        }
    }}
    onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if ($editorView && revision.selection) {
                $editorView.dispatch({
                    selection: revision.selection,
                    scrollIntoView: true,
                });
            }
        }
    }}
>
    <!-- Connection line indicator -->
    <div class="absolute -left-4 top-1/2 -translate-y-1/2 w-3 h-0.5 bg-gradient-to-r {isActive 
        ? 'from-purple-500 to-transparent opacity-100' 
        : 'from-gray-300 to-transparent opacity-0 group-hover:opacity-100'} transition-opacity duration-200"></div>
    
    <!-- Annotation type badge -->
    <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
            Revision
        </span>
        <span class="text-xs text-gray-400">
            Line {Math.max(1, $editorView?.state.doc.lineAt(revision.selection.main.from).number || 1)}
        </span>
    </div>

    <div class="space-y-2 my-2">
        <div class="flex items-center justify-between">
            <h3 class="text-sm font-medium text-gray-700">Revisions</h3>
            <button
                class="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 hover:border-blue-300 transition-colors"
                onclick={() => {
                    $editorView.dispatch(
                        createNewRevision($editorView.state, revision.id),
                    );
                }}
            >
                <SparklesIcon size={12} />
                New revision
            </button>
        </div>

        <div class="flex flex-wrap gap-2">
            {#each revision.versions as version, i}
                {@const isActive = i == revision.currentlySelected}
                <button
                    class="px-3 py-2 text-sm font-medium rounded-md border transition-colors {isActive
                        ? 'bg-blue-500 text-white border-blue-500 shadow-sm'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 hover:border-gray-400'}"
                    disabled={isActive}
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
                    {version}
                </button>
            {/each}
        </div>
    </div>
    <Thread {thread} {updateThread} />
    <div class="flex justify-end pt-3 border-t border-gray-200">
        <button
            class="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors group"
            onclick={() => remove()}
            title="Delete revision"
        >
            <Trash2
                size={16}
                class="group-hover:scale-105 transition-transform"
            />
        </button>
    </div>
</div>
