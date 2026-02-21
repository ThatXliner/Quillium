<script lang="ts">
    import { onMount } from "svelte";
    import Editor from "$lib/editor/Editor.svelte";
    import AiSidebar from "$lib/ai/AISidebar.svelte";
    import Tutorial from "$lib/tutorial/Tutorial.svelte";
    import { tutorialActive, modalStack, editorView } from "$lib/stores";
    import DiffModal from "$lib/editor/plugins/annotations/DiffModal.svelte";
    import RevisionModal from "$lib/editor/plugins/annotations/RevisionModal.svelte";

    onMount(() => {
        if (!localStorage.getItem("quillium_tutorial_seen")) {
            $tutorialActive = true;
        }
    });
</script>

<AiSidebar />

<div class="h-screen w-full">
    <Editor />
</div>

{#if $tutorialActive}
    <Tutorial onComplete={() => {}} />
{/if}

{#each $modalStack as entry, i (entry)}
    {#if entry.type === "diff"}
        <DiffModal ops={entry.ops} suggestionId={entry.suggestionId} parentView={entry.parentView} stackIndex={i} />
    {:else if entry.type === "revision"}
        <RevisionModal revisionId={entry.revisionId} view={entry.parentView} stackIndex={i} />
    {/if}
{/each}

<style>
    :global(html) {
        background-color: #e5e7eb; /* gray-200 */
    }
</style>
