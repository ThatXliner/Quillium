<script>
    import Annotations from "$lib/editor/plugins/annotations/Annotations.svelte";
    import Editor from "$lib/editor/Editor.svelte";
    import AiSidebar from "$lib/ai/AISidebar.svelte";
</script>

<div class="flex">
    <AiSidebar />
    <Editor />
    <Annotations />
</div>

<style>
    :global(html) {
        background-color: lightgray;
    }
</style>
