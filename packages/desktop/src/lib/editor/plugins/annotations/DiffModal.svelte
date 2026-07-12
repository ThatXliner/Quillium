<script lang="ts">
import posthog from "$lib/posthog";
import { annotations as annotationsStore, modalAnnotationStores, modalStack } from "$lib/stores";
import type { EditorView } from "@codemirror/view";
import {
    AnnotationModalFrame,
    AnnotationModalHeader,
    SuggestionModalContent,
} from "@quillium/share";
/**
 * DiffModal.svelte — Full-screen modal showing a token-level
 * diff between the original document text and a chosen AI
 * suggestion replacement.
 *
 * Props:
 *   - suggestionId: number — ID of the suggestion annotation
 *   - parentView: EditorView — the CodeMirror editor that
 *     owns the suggestion (used to read annotation state)
 *   - stackIndex: number — this modal's position in the
 *     global modalStack (used for breadcrumb rendering)
 *
 * Events emitted: none
 * Stores:
 *   - modalStack (read/write): breadcrumb trail + pop on close
 *
 * Parent: rendered by the modal layer in +page.svelte
 * Children: none
 *
 * Layout: left pane = diff view, right sidebar = replacement
 * list with optional rationale text.
 */
import { ChevronRight, GitBranchIcon, SparklesIcon, Trash2 } from "lucide-svelte";
import {
    type Annotation,
    type Thread as ThreadType,
    annotationField,
    applySuggestion,
    branchSuggestion,
    isAnnotationOfType,
    removeAnnotation,
    updateThread,
} from ".";
import Thread from "./Thread.svelte";

const {
    suggestionId,
    parentView,
    stackIndex,
}: { suggestionId: number; parentView: EditorView; stackIndex: number } = $props();

// Breadcrumb trail sliced up to and including this modal level
const crumbs = $derived($modalStack.slice(0, stackIndex + 1));

const isTop = $derived(stackIndex === $modalStack.length - 1);

let dialogEl = $state<HTMLDialogElement>();

// Read the suggestion from the correct reactive annotation source —
// parentView.state.field(...) is a plain (non-reactive) read, so derive
// from the synced stores instead (main editor → annotationsStore, nested
// levels → modalAnnotationStores), falling back to a direct state read.
// This keeps thread replies and other mutations visible while the modal
// is open.
const suggestion = $derived.by((): Annotation<"suggestion"> | undefined => {
    const ann =
        (stackIndex === 0 ? $annotationsStore : $modalAnnotationStores[stackIndex - 1])?.[
            suggestionId
        ] ?? parentView.state.field(annotationField)[suggestionId];
    // Ids are sequential integers, so a remote collab sync can reassign
    // this id to a different annotation type while the modal is open.
    return ann && isAnnotationOfType(ann, "suggestion") ? ann : undefined;
});

let selectedIndex = $state(0);

// User replies: skip the first message when it's the AI's overall comment
// (mirrors the inline Suggestion card).
const userThread = $derived(
    suggestion
        ? suggestion.thread[0]?.author === "AI"
            ? suggestion.thread.slice(1)
            : suggestion.thread
        : [],
);

function handleUpdateThread(newThread: ThreadType) {
    if (!suggestion) return;
    parentView.dispatch({
        effects: updateThread.of({ annotationId: suggestionId, newThread }),
    });
}

function handleUpdateUserThread(newThread: ThreadType) {
    if (!suggestion) return;
    handleUpdateThread(
        suggestion.thread[0]?.author === "AI" ? [suggestion.thread[0], ...newThread] : newThread,
    );
}

/** Delete the suggestion (parity with the inline card's trash icon). */
function deleteSuggestion() {
    if (!suggestion) return;
    posthog.capture("annotation_deleted", {
        type: "suggestion",
        replacement_count: suggestion.replacements.length,
        from_modal: true,
    });
    parentView.dispatch({ effects: removeAnnotation.of(suggestion) });
    close();
}

/** Apply the selected replacement (parity with the inline Apply button). */
function applySelected(index = selectedIndex) {
    if (!suggestion) return;
    posthog.capture("suggestion_applied", {
        replacement_index: index,
        replacement_count: suggestion.replacements.length,
        from_modal: true,
    });
    parentView.dispatch(applySuggestion(parentView.state, suggestionId, index));
    close();
}

/** Convert to a revision (parity with the inline Branch button). */
function branch() {
    if (!suggestion) return;
    posthog.capture("suggestion_branched", {
        replacement_count: suggestion.replacements.length,
        from_modal: true,
    });
    parentView.dispatch(branchSuggestion(parentView.state, suggestionId));
    close();
}

const originalText = $derived(
    suggestion
        ? parentView.state.sliceDoc(suggestion.selection.main.from, suggestion.selection.main.to)
        : "",
);

function close() {
    modalStack.pop();
}

// Open the <dialog> element as a modal once it is bound.
$effect(() => {
    if (!dialogEl) return;
    if (isTop && !dialogEl.open) {
        dialogEl.showModal();
    } else if (!isTop && dialogEl.open) {
        dialogEl.close();
    }
});
</script>

{#snippet suggestionHeaderLeading()}
    <SparklesIcon size={13} class="text-green-500/70 shrink-0" />
    <nav class="flex items-center gap-1 min-w-0">
        {#each crumbs as crumb, ci}
            {#if ci < crumbs.length - 1}
                <button
                    class="text-[10px] text-green-500/60 hover:text-green-700/80 transition-colors truncate max-w-[120px] shrink-0"
                    onclick={() => modalStack.popTo(ci)}
                >{crumb.label}</button>
                <ChevronRight size={10} class="text-green-300/60 shrink-0" />
            {:else}
                <span
                    class="text-[10px] font-semibold text-green-700/70 uppercase tracking-wider truncate"
                    >{crumb.label}</span
                >
            {/if}
        {/each}
    </nav>
{/snippet}

{#snippet suggestionHeaderActions()}
    <button
        class="p-1 rounded-md text-green-400/50 hover:text-red-500/60 hover:bg-green-50/80 transition-colors"
        onclick={deleteSuggestion}
        title="Delete suggestion"
        aria-label="Delete suggestion"
    >
        <Trash2 size={16} />
    </button>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<dialog
    bind:this={dialogEl}
    class="diff-modal"
    onclick={(e) => { if (e.target === dialogEl) close(); }}
    oncancel={(e) => { e.preventDefault(); close(); }}
>
    <AnnotationModalFrame variant="suggestion">
        <AnnotationModalHeader
            accent="suggestion"
            leading={suggestionHeaderLeading}
            actions={suggestionHeaderActions}
            onClose={close}
            closeLabel="Close suggestion"
        />

        {#if suggestion}
            {#snippet threadContent()}
                <Thread
                    thread={userThread}
                    updateThread={handleUpdateUserThread}
                    annotationId={suggestionId}
                    view={parentView}
                />
            {/snippet}

            {#snippet actions(index: number)}
                <div class="flex items-center gap-1.5">
                    <button
                        aria-label="Branch instead"
                        title="Convert to revision with original and suggestion as versions"
                        class="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-purple-600/70
                            bg-white/40 hover:bg-white/60 rounded-md ring-1 ring-green-200/50 transition-colors"
                        onclick={branch}
                    >
                        <GitBranchIcon size={11} />
                        <span>Branch</span>
                    </button>
                    <button
                        class="flex-1 px-2 py-1 text-[11px] font-medium rounded-md ring-1 transition-colors
                            bg-green-500/80 text-white ring-green-400/40 hover:bg-green-600/80"
                        onclick={() => applySelected(index)}
                    >
                        Apply
                    </button>
                </div>
            {/snippet}

            <SuggestionModalContent
                selectionKey={suggestionId}
                {originalText}
                replacements={suggestion.replacements}
                messages={suggestion.thread}
                onSelectionChange={(index) => (selectedIndex = index)}
                {threadContent}
                {actions}
            />
        {/if}
    </AnnotationModalFrame>
</dialog>

<style>
    .diff-modal {
        border: none;
        padding: 0;
        background: transparent;
        width: 100vw;
        height: 100vh;
        max-width: 100vw;
        max-height: 100vh;
    }

    .diff-modal[open] {
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .diff-modal::backdrop {
        background: rgba(0, 0, 0, 0.3);
        backdrop-filter: blur(4px);
    }

</style>
