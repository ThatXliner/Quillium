<script lang="ts">
import type { EditorView } from "@codemirror/view";
import { tick } from "svelte";
import { updateThread, removeAnnotation } from "./annotationField";
import { canCreateNewComment } from "./utils";
import {
	isAnnotationOfType,
	type Annotations,
	type GenericAnnotation,
} from "./models";
import posthog from "posthog-js";

const {
	view,
	annotationsData,
	activeAnnotationData,
}: {
	view: EditorView;
	annotationsData: Annotations;
	activeAnnotationData?: GenericAnnotation;
} = $props();

let commentText = $state("");
let textarea = $state<HTMLTextAreaElement | undefined>();

$effect(() => {
	if (!canCreateNewComment(annotationsData)) {
		tick().then(() => textarea?.focus());
	}
});

const selectedText = $derived(
	activeAnnotationData
		? view.state.sliceDoc(
				activeAnnotationData.selection.main.from,
				activeAnnotationData.selection.main.to,
			)
		: "",
);

function addComment() {
	if (
		!activeAnnotationData ||
		!isAnnotationOfType(activeAnnotationData, "comment")
	)
		return;
	posthog.capture("comment_created", {
		has_selection: !!selectedText,
		comment_length: commentText.length,
	});
	view.dispatch(
		view.state.update({
			effects: [
				updateThread.of({
					annotationId: activeAnnotationData.id,
					newThread: [
						...activeAnnotationData.thread,
						{
							message: commentText,
							author: "User",
							time: Date.now(),
						},
					],
				}),
			],
		}),
	);
	commentText = "";
}

function cancelComment() {
	if (
		!activeAnnotationData ||
		!isAnnotationOfType(activeAnnotationData, "comment")
	)
		return;
	view.dispatch(
		view.state.update({
			effects: [removeAnnotation.of(activeAnnotationData)],
		}),
	);
	commentText = "";
}
</script>

<div class="backdrop-blur-md bg-gray-200/80 border border-white/50 shadow-xl rounded-[14px] overflow-hidden">
    {#if selectedText}
        <div class="px-3 pt-3">
            <div class="text-xs text-black/50 border-l-2 border-yellow-400/80 pl-2 truncate italic">
                {selectedText.slice(0, 80)}{selectedText.length > 80 ? "…" : ""}
            </div>
        </div>
    {/if}

    <div class="flex gap-2.5 px-3 py-3">
        <div class="shrink-0 w-7 h-7 rounded-full bg-white/50 inset-shadow-sm inset-shadow-white shadow-sm flex items-center justify-center text-black/60 text-xs font-semibold">
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
            class="flex-1 text-xs text-black/70 placeholder:text-black/30 bg-transparent resize-none focus:outline-none leading-relaxed"
            rows="2"
        ></textarea>
    </div>

    <div class="flex items-center justify-end gap-2 px-3 pb-2.5 border-t border-black/10 pt-2">
        <button
            onclick={cancelComment}
            class="text-xs text-black/40 hover:text-black/60 transition-colors"
        >
            Cancel
        </button>
        <button
            disabled={!commentText}
            onclick={addComment}
            class="px-3 py-1 bg-blue-500/80 text-white text-xs font-medium rounded-full hover:bg-blue-600/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
            Comment
        </button>
    </div>
</div>
