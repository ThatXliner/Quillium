<script lang="ts">
    import { activeAnnotation, annotations, editorView } from "$lib/stores";
    import { tick } from "svelte";
    import { updateThread, removeAnnotation } from "./annotationField";
    import { canCreateNewComment } from "./utils";
    import { isAnnotationOfType } from "./models";

    let commentText = $state("");
    let textarea = $state<HTMLTextAreaElement | undefined>();

    annotations.subscribe((a) => {
        if (!a) return;
        if (!canCreateNewComment(a)) {
            tick().then(() => textarea?.focus());
        }
    });

    const selectedText = $derived(
        $activeAnnotation && $editorView
            ? $editorView.state.sliceDoc(
                  $activeAnnotation.selection.main.from,
                  $activeAnnotation.selection.main.to,
              )
            : "",
    );

    function addComment() {
        if (!$activeAnnotation || !isAnnotationOfType($activeAnnotation, "comment")) return;
        $editorView.dispatch(
            $editorView.state.update({
                effects: [
                    updateThread.of({
                        annotationId: $activeAnnotation.id,
                        newThread: [
                            ...$activeAnnotation.thread,
                            { message: commentText, author: "User", time: Date.now() },
                        ],
                    }),
                ],
            }),
        );
        commentText = "";
    }

    function cancelComment() {
        if (!$activeAnnotation || !isAnnotationOfType($activeAnnotation, "comment")) return;
        $editorView.dispatch(
            $editorView.state.update({
                effects: [removeAnnotation.of($activeAnnotation)],
            }),
        );
        commentText = "";
    }
</script>

<div class="bg-white rounded-lg shadow-md ring-1 ring-black/5 overflow-hidden">
    <!-- Quoted text chip -->
    {#if selectedText}
        <div class="px-3 pt-3">
            <div class="text-xs text-gray-500 border-l-2 border-yellow-400 pl-2 truncate italic">
                {selectedText.slice(0, 80)}{selectedText.length > 80 ? "…" : ""}
            </div>
        </div>
    {/if}

    <!-- Input -->
    <div class="flex gap-2.5 px-3 py-3">
        <div class="shrink-0 w-7 h-7 rounded-full bg-gray-300 flex items-center justify-center text-white text-xs font-semibold">
            U
        </div>
        <textarea
            tabindex="0"
            bind:this={textarea}
            bind:value={commentText}
            onkeydown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && commentText) {
                    addComment();
                    // @ts-ignore
                    e.target.blur();
                }
            }}
            placeholder="Add a comment…"
            class="flex-1 text-xs text-gray-700 placeholder:text-gray-400 bg-transparent resize-none focus:outline-none leading-relaxed"
            rows="2"
        ></textarea>
    </div>

    <!-- Actions -->
    <div class="flex items-center justify-end gap-2 px-3 pb-2.5 border-t border-gray-100 pt-2">
        <button
            onclick={cancelComment}
            class="text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
            Cancel
        </button>
        <button
            disabled={!commentText}
            onclick={addComment}
            class="px-3 py-1 bg-blue-500 text-white text-xs font-medium rounded-full hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
            Comment
        </button>
    </div>
</div>
