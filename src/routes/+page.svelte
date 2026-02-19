<script>
    import Editor from "$lib/editor/Editor.svelte";
    import AiSidebar from "$lib/ai/AISidebar.svelte";
</script>

<AiSidebar />

<div class="h-screen w-full">
    <Editor />
</div>

<style>
    :global(html) {
        background-color: #e5e7eb; /* gray-200 */
    }
</style>
