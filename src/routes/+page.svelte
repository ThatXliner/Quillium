<script lang="ts">
    import { onMount } from "svelte";
    import Editor from "$lib/editor/Editor.svelte";
    import AiSidebar from "$lib/ai/AISidebar.svelte";
    import Tutorial from "$lib/tutorial/Tutorial.svelte";
    import { tutorialActive } from "$lib/stores";

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

<style>
    :global(html) {
        background-color: #e5e7eb; /* gray-200 */
    }
</style>
