<script lang="ts">
    import { onMount } from "svelte";
    import Editor from "$lib/editor/Editor.svelte";
    import AiSidebar from "$lib/ai/AISidebar.svelte";
    import Tutorial from "$lib/tutorial/Tutorial.svelte";
    import { tutorialActive, activeModal, editorView } from "$lib/stores";
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

{#if $activeModal?.type === "diff"}
    <DiffModal ops={$activeModal.ops} />
{/if}

{#if $activeModal?.type === "revision" && $editorView}
    <RevisionModal revisionId={$activeModal.revisionId} view={$editorView} />
{/if}

<style>
    :global(html) {
        background-color: #e5e7eb; /* gray-200 */
    }
</style>
