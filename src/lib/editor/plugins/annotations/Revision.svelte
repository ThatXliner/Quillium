<script lang="ts">
    import { SendHorizonalIcon, SparklesIcon, Trash2 } from "lucide-svelte";
    import {
        type Thread,
        type Annotation,
        createNewRevision,
        setActiveRevisionVersion,
    } from ".";
    import CommentThread from "./CommentThread.svelte";
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
        updateThread: (thread: Thread) => void;
    } = $props();
    const thread = $derived(revision.thread);
</script>

<div
    class="bg-gray-50 rounded-lg p-3 my-2 shadow-sm ring-2 {isActive
        ? 'ring-blue-500 ring-4'
        : 'ring-gray-500'}"
>
    <div class="text-sm text-gray-700"></div>

    <div class="space-y-4 my-4">
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
    <CommentThread {thread} {updateThread} />
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
